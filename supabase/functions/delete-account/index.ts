// =============================================================================
// delete-account — in-app account deletion (App Store Guideline 5.1.1(v)).
//
// The client (src/api/auth.ts → deleteAccount) calls this via
// supabase.functions.invoke. verify_jwt=true, so Supabase validates the
// caller's token at the gateway; the function then deletes the CALLER'S OWN
// auth.users row with the SERVICE ROLE. Every user-owned table references
// auth.users(id) with `on delete cascade` (progress, notes, notifications,
// prefs, push tokens, quiz attempts, buddy rows, benefits — see
// supabase/migrations), and authored public content (questions asked under a
// name, reports) is `on delete set null`, so one delete removes the account
// and all personal rows in a single transaction.
//
// Admin accounts may NOT self-delete here (anti-lockout, mirrors admin-users);
// they are managed from the web dashboard instead.
//
// Deploy: supabase functions deploy delete-account   (verify_jwt=true default)
//         — or the multipart POST used for admin-users / notify-on-publish.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  // 1) Identify the caller from their JWT — the ONLY account this can delete.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller?.user) return json({ error: "invalid session" }, 401);

  // 2) Anti-lockout: admins are deleted from the dashboard, never in-app.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: prof } = await admin
    .from("profiles")
    .select("role")
    .eq("id", caller.user.id)
    .single();
  if (prof?.role === "admin") {
    return json({ error: "admin accounts cannot self-delete" }, 403);
  }

  // 3) Delete the auth user — cascades remove all personal rows (see header).
  const { error: delErr } = await admin.auth.admin.deleteUser(caller.user.id);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ ok: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
