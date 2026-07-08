// =============================================================================
// notify-on-publish — Expo Push delivery for the الإشعارات feature.
//
// Architecture (see ./README.md): the DATABASE does the fan-out. Triggers in
// migration 0006 insert one `public.notifications` row per follower (honouring
// each follower's prefs). A Supabase Database Webhook on `notifications` INSERT
// then calls THIS function with the new row; the function is a dumb worker that
// looks up the recipient's device tokens and POSTs them to the Expo Push API
// (which forwards to FCM on Android). The in-app inbox already works without
// this — only the device push depends on it.
//
// Deploy:  supabase functions deploy notify-on-publish
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
};

// Database Webhook payload shape: { type: 'INSERT', record: {...}, ... }
type WebhookPayload = { record?: NotificationRow } & Partial<NotificationRow>;

Deno.serve(async (req) => {
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  // Accept either the webhook envelope or a bare notification row (manual test).
  const row: NotificationRow | undefined = payload.record ??
    (payload.user_id ? (payload as NotificationRow) : undefined);
  if (!row?.user_id) return json({ error: "no notification row" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tokens, error } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", row.user_id);
  if (error) return json({ error: error.message }, 500);
  if (!tokens?.length) return json({ skipped: "no device tokens" }, 200);

  // Launcher badge (Issue 8): a "new lesson" push carries the recipient's unread
  // new_lecture count, so the app icon shows how many new lessons await. The row
  // is already inserted (webhook fires post-INSERT), so this count includes it.
  // Other notification types omit `badge`, leaving the existing count untouched.
  let badge: number | undefined;
  if (row.type === "new_lecture") {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", row.user_id)
      .eq("type", "new_lecture")
      .is("read_at", null);
    if (typeof count === "number") badge = count;
  }

  // Item 6: email an admin when content is reported. Best-effort, own
  // try/catch — must never block the push send below. No-ops (logs) if
  // RESEND_API_KEY is unset or admin_notify_email is empty.
  if (row.type === "content_reported") {
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) {
        console.log("content_reported: RESEND_API_KEY unset, skipping email");
      } else {
        const { data: cfg } = await supabase
          .from("app_config")
          .select("value")
          .eq("key", "admin_notify_email")
          .maybeSingle();
        const to = cfg?.value?.trim();
        if (!to) {
          console.log("content_reported: admin_notify_email unset, skipping email");
        } else {
          // De-dupe: report_content (0051) inserts one notification row PER
          // admin, so the webhook fires once per admin for one report. Only
          // send the email once per report — when this row belongs to the
          // lexicographically-first admin id — rather than once per admin.
          const { data: admins } = await supabase
            .from("profiles")
            .select("id")
            .eq("role", "admin")
            .order("id", { ascending: true })
            .limit(1);
          const firstAdminId = admins?.[0]?.id;
          if (firstAdminId && firstAdminId === row.user_id) {
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
          }
        }
      }
    } catch (e) {
      console.log("content_reported email failed (non-blocking):", e);
    }
  }

  // Beneficial-reminder image (0064): mint a presigned R2 GET for
  // row.data.imagePath and attach it as richContent.image — Expo Push forwards
  // this to FCM as a BigPictureStyle image on Android (and an iOS attachment
  // when a Notification Service Extension is present). Best-effort: a signing
  // failure must never block the push itself.
  let richContent: { image: string } | undefined;
  const imagePath = (row.data as Record<string, unknown> | null)?.imagePath;
  if (r2 && typeof imagePath === "string" && imagePath) {
    try {
      const image = await getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: imagePath }),
        { expiresIn: 3600 },
      );
      richContent = { image };
    } catch (e) {
      console.log("reminder image presign failed (non-blocking):", e);
    }
  }

  // Gently audible (the §14 silent choice was reversed — user-approved). Route to
  // the SAME 'default-v2' channel the local notifications use (importance HIGH +
  // default system sound, no vibration) so a new-content push reaches every
  // install — guest or registered — audibly and consistently. The old 'default'
  // channel id no longer exists on fresh installs (only 'default-v2' is created),
  // so FCM would otherwise fall back to its silent fcm_fallback channel.
  const messages = tokens.map((t) => ({
    to: t.token,
    title: row.title,
    body: row.body,
    data: row.data ?? {},
    sound: "default",
    channelId: "default-v2",
    priority: "high",
    ...(richContent ? { richContent } : {}),
    ...(badge !== undefined ? { badge } : {}),
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });
  const result = await res.json().catch(() => null);

  // Best-effort cleanup: drop tokens Expo reports as unregistered, so a
  // reinstalled / signed-out device stops receiving (and erroring) forever.
  const tickets = (result?.data ?? []) as Array<
    { status?: string; details?: { error?: string } }
  >;
  const dead = tickets
    .map((ticket, i) =>
      ticket?.details?.error === "DeviceNotRegistered" ? messages[i].to : null
    )
    .filter((tok): tok is string => tok !== null);
  if (dead.length) {
    await supabase.from("push_tokens").delete().in("token", dead);
  }

  return json({ sent: messages.length, expo: result }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
