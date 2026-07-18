// =============================================================================
// register-set-email — attach an email to the CALLER'S OWN account during
// self-registration, without Supabase sending a confirmation email.
//
// register() (src/api/auth.ts) used to call `supabase.auth.updateUser({
// email })` directly from the client. Because that account is no longer a
// fresh anonymous sign-up by the time this runs (phone+password were already
// linked a moment earlier), Supabase treats it as an EMAIL CHANGE and fires
// its "confirm email change" mailer (mailer_secure_email_change_enabled) —
// burning the free Resend quota on every registration even though nothing in
// the UI ever asks the user to enter that code.
//
// This function sets the email via the SERVICE ROLE with `email_confirm:
// true`, exactly like admin-users' `updateEmail` action, so it lands in
// auth.users.email (visible in the admin panel) immediately with no mailer
// call at all. verify_jwt=true, so Supabase validates the caller's token at
// the gateway; this function then restricts the write to the CALLER'S OWN
// account (mirrors delete-account) — it can never set anyone else's email.
//
// Deploy: multipart POST /v1/projects/{ref}/functions/deploy?slug=register-set-email
//         (metadata verify_jwt=true) — mirrors delete-account / admin-users.
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

  // 1) Identify the caller from their JWT — the ONLY account this can touch.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller?.user) return json({ error: "invalid session" }, 401);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) return json({ error: "invalid email" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.updateUserById(caller.user.id, {
    email,
    email_confirm: true,
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, email: data.user.email });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
