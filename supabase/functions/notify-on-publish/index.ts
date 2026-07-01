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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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
