// =============================================================================
// notify-on-publish — Expo Push delivery for the الإشعارات feature.
//
// Architecture (see ./README.md): the DATABASE does the fan-out. Triggers in
// migration 0006 insert one `public.notifications` row per follower (honouring
// each follower's prefs). A statement-level trigger on `notifications` INSERT
// (migration 0122) then calls THIS function ONCE per ≤500 new rows, passing
// their ids; the function looks up those recipients' device tokens and POSTs
// them to the Expo Push API (which forwards to FCM on Android). The in-app
// inbox already works without this — only the device push depends on it.
//
// Why a batch: 0009 called this function once per ROW, so publishing a lecture
// to ~10 k students queued ~10 k HTTP requests inside the INSERT statement,
// which took 27 s and blew the 8 s statement_timeout — the publish failed with
// a 500 and no lecture was saved. See 0122 for the measurements. Everything
// here is therefore written to cost one round trip per BATCH, never per row:
// one token lookup, one badge-count RPC, one Expo POST per 100 messages.
//
// Accepted payloads:
//   {"type":"BATCH","ids":["<uuid>", …]}   ← the trigger (0122)
//   {"record": {<notifications row>}}      ← legacy Database Webhook envelope
//   {<notifications row>}                  ← bare row, for manual testing
//
// Deploy:  supabase functions deploy notify-on-publish
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =============================================================================
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo rejects more than 100 messages in one request. */
const EXPO_CHUNK = 100;
/** Recipients per `in(...)` lookup — keeps the PostgREST query string sane. */
const LOOKUP_CHUNK = 200;

// R2 (Cloudflare) — only used to attach a rich image to a beneficial-reminder
// push (row.data.imagePath, see migration 0064_broadcasts_image_link.sql).
// Falls back to no image if these secrets aren't set (older deploys).
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT");
const R2_BUCKET = Deno.env.get("R2_BUCKET");
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY");
const r2 = R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

type NotificationRow = {
  id?: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
};

type WebhookPayload =
  & { type?: string; ids?: string[]; record?: NotificationRow }
  & Partial<NotificationRow>;

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string;
  channelId: string;
  priority: string;
  richContent?: { image: string };
  badge?: number;
};

Deno.serve(async (req) => {
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- Resolve the rows this invocation delivers ----------------------------
  // A batch carries ids only (the trigger must not ship 500 full rows through
  // pg_net), so re-read them here. A legacy/manual call carries the row itself.
  let rows: NotificationRow[];
  if (Array.isArray(payload.ids) && payload.ids.length) {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, user_id, type, title, body, data")
      .in("id", payload.ids);
    if (error) return json({ error: error.message }, 500);
    rows = data ?? [];
  } else {
    const row: NotificationRow | undefined = payload.record ??
      (payload.user_id ? (payload as NotificationRow) : undefined);
    if (!row?.user_id) return json({ error: "no notification row" }, 400);
    rows = [row];
  }
  if (!rows.length) return json({ skipped: "no rows" }, 200);

  // Item 6: email an admin when content is reported. Best-effort and per row
  // (a report fans out to every admin, a handful at most), own try/catch —
  // must never block the push send below.
  for (const row of rows) {
    if (row.type === "content_reported") await emailAdminOnReport(supabase, row);
  }

  // --- Device tokens, one lookup per LOOKUP_CHUNK recipients ----------------
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const tokensByUser = new Map<string, string[]>();
  for (let i = 0; i < userIds.length; i += LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from("push_tokens")
      .select("user_id, token")
      .in("user_id", userIds.slice(i, i + LOOKUP_CHUNK));
    if (error) return json({ error: error.message }, 500);
    for (const t of data ?? []) {
      const list = tokensByUser.get(t.user_id);
      if (list) list.push(t.token);
      else tokensByUser.set(t.user_id, [t.token]);
    }
  }
  if (!tokensByUser.size) return json({ rows: rows.length, skipped: "no device tokens" }, 200);

  // --- Launcher badge (Issue 8) --------------------------------------------
  // A "new lesson" push carries the recipient's unread new_lecture count, so
  // the app icon shows how many new lessons await. The rows are already
  // inserted (the trigger fires post-INSERT), so the count includes them. One
  // RPC for the whole batch (0122) rather than a COUNT per recipient. Other
  // notification types omit `badge`, leaving the existing count untouched.
  const badgeByUser = new Map<string, number>();
  const badgeUsers = [
    ...new Set(
      rows.filter((r) => r.type === "new_lecture" && tokensByUser.has(r.user_id))
        .map((r) => r.user_id),
    ),
  ];
  if (badgeUsers.length) {
    const { data, error } = await supabase.rpc("push_unread_new_lecture_counts", {
      p_user_ids: badgeUsers,
    });
    if (error) console.log("badge counts failed (non-blocking):", error.message);
    for (const c of (data ?? []) as Array<{ user_id: string; unread: number }>) {
      badgeByUser.set(c.user_id, c.unread);
    }
  }

  // --- Beneficial-reminder image (0064) ------------------------------------
  // Mint a presigned R2 GET for row.data.imagePath and attach it as
  // richContent.image — Expo Push forwards this to FCM as a BigPictureStyle
  // image on Android (and an iOS attachment when a Notification Service
  // Extension is present). Signed once per distinct path: a broadcast batch
  // shares one image across all its rows. Best-effort — a signing failure must
  // never block the push itself.
  const richByPath = new Map<string, { image: string } | undefined>();
  for (const row of rows) {
    const imagePath = (row.data as Record<string, unknown> | null)?.imagePath;
    if (!r2 || typeof imagePath !== "string" || !imagePath) continue;
    if (richByPath.has(imagePath)) continue;
    try {
      const image = await getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: imagePath }),
        { expiresIn: 3600 },
      );
      richByPath.set(imagePath, { image });
    } catch (e) {
      console.log("reminder image presign failed (non-blocking):", e);
      richByPath.set(imagePath, undefined);
    }
  }

  // --- Build the messages ---------------------------------------------------
  // Gently audible (the §14 silent choice was reversed — user-approved). Route
  // to the SAME 'default-v2' channel the local notifications use (importance
  // HIGH + default system sound, no vibration) so a new-content push reaches
  // every install — guest or registered — audibly and consistently. The old
  // 'default' channel id no longer exists on fresh installs (only 'default-v2'
  // is created), so FCM would otherwise fall back to its silent channel.
  const messages: ExpoMessage[] = [];
  for (const row of rows) {
    const tokens = tokensByUser.get(row.user_id);
    if (!tokens?.length) continue;
    const imagePath = (row.data as Record<string, unknown> | null)?.imagePath;
    const richContent = typeof imagePath === "string" ? richByPath.get(imagePath) : undefined;
    const badge = badgeByUser.get(row.user_id);
    for (const token of tokens) {
      messages.push({
        to: token,
        title: row.title,
        body: row.body,
        data: row.data ?? {},
        sound: "default",
        channelId: "default-v2",
        priority: "high",
        ...(richContent ? { richContent } : {}),
        ...(row.type === "new_lecture" && badge !== undefined ? { badge } : {}),
      });
    }
  }
  if (!messages.length) return json({ rows: rows.length, skipped: "no device tokens" }, 200);

  // --- Send, EXPO_CHUNK messages at a time ---------------------------------
  const dead: string[] = [];
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        failed += chunk.length;
        console.log(`expo chunk failed (${res.status}):`, JSON.stringify(result)?.slice(0, 300));
        continue;
      }
      sent += chunk.length;
      // Best-effort cleanup: drop tokens Expo reports as unregistered, so a
      // reinstalled / signed-out device stops receiving (and erroring) forever.
      const tickets = (result?.data ?? []) as Array<
        { status?: string; details?: { error?: string } }
      >;
      tickets.forEach((ticket, j) => {
        if (ticket?.details?.error === "DeviceNotRegistered" && chunk[j]) dead.push(chunk[j].to);
      });
    } catch (e) {
      // One bad chunk must not abandon the rest of the batch.
      failed += chunk.length;
      console.log("expo chunk threw (non-blocking):", e);
    }
  }

  if (dead.length) {
    const unique = [...new Set(dead)];
    for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
      await supabase.from("push_tokens").delete().in("token", unique.slice(i, i + LOOKUP_CHUNK));
    }
  }

  return json({ rows: rows.length, sent, failed, pruned: dead.length }, 200);
});

/**
 * De-duped admin email for a content report. report_content (0051) inserts one
 * notification row PER admin, so this runs once per admin for a single report —
 * only the row belonging to the lexicographically-first admin sends the mail.
 * No-ops (logs) if RESEND_API_KEY is unset or admin_notify_email is empty.
 */
async function emailAdminOnReport(supabase: SupabaseClient, row: NotificationRow) {
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.log("content_reported: RESEND_API_KEY unset, skipping email");
      return;
    }
    const { data: cfg } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "admin_notify_email")
      .maybeSingle();
    const to = cfg?.value?.trim();
    if (!to) {
      console.log("content_reported: admin_notify_email unset, skipping email");
      return;
    }
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .order("id", { ascending: true })
      .limit(1);
    const firstAdminId = admins?.[0]?.id;
    if (!firstAdminId || firstAdminId !== row.user_id) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "المَحجّة البَيْضَاء <notifications@resend.dev>",
        to: [to],
        subject: row.title,
        html: `<div dir="rtl" style="font-family: sans-serif; text-align: right;">
                  <p>${row.body}</p>
                  <p>يمكن مراجعة البلاغ من لوحة الإدارة، صفحة «البلاغات».</p>
                </div>`,
      }),
    });
  } catch (e) {
    console.log("content_reported email failed (non-blocking):", e);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
