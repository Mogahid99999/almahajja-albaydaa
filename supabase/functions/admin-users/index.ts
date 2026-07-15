// =============================================================================
// admin-users — privileged user-management actions for the admin panel.
//
// The client (src/api/adminUsers.ts) calls this via supabase.functions.invoke.
// verify_jwt=true, so Supabase validates the caller's token at the gateway;
// this function then confirms the caller is an ADMIN (profiles.role='admin')
// before using the SERVICE ROLE to mutate auth.users. The service-role key is
// injected by Supabase (SUPABASE_SERVICE_ROLE_KEY) and NEVER ships in the app.
//
// Actions (POST body { action, userId, ... }):
//   ban          → ban the user (100y)          unban → lift the ban
//   setPassword  → set a new password (no old)   updateEmail → change email
//   updateProfile→ set display_name              setRole → student|publisher|admin|sheikh
//   updateGender → set profiles.gender (male|female)
//   updatePhone  → set phone, ALWAYS phone_confirm:true (no SMS/OTP ever sent —
//                  admin edits are instant, mirrors updateEmail's email_confirm)
//   deleteUser   → permanently delete the account (cascades all personal rows)
//
// A caller may not ban, delete, or change the role of THEIR OWN account
// (anti-lockout).
//
// Deploy: multipart POST /v1/projects/{ref}/functions/deploy?slug=admin-users
//         (metadata verify_jwt=true) — mirrors notify-on-publish.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BAN_FOREVER = "876000h"; // ~100 years
const VALID_ROLES = ["student", "publisher", "admin", "sheikh"];

const DEFAULT_COUNTRY_CODE = "249";

/**
 * Mirrors src/api/auth.ts's normalizePhone — reshapes into valid E.164 (phone
 * is never OTP-verified). `countryCode` comes from the admin panel's country
 * picker (src/components/ui/PhoneInput.tsx); falls back to Sudan only when a
 * caller doesn't send one.
 */
function normalizePhone(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return digits;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  if (local.startsWith(countryCode) || local.length > 9) return local;
  return countryCode + local;
}

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

  // 1) Identify the caller from their JWT.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller?.user) return json({ error: "invalid session" }, 401);

  // 2) Service-role client + confirm the caller is an admin.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: prof } = await admin
    .from("profiles")
    .select("role")
    .eq("id", caller.user.id)
    .single();
  if (prof?.role !== "admin") return json({ error: "forbidden" }, 403);

  // 3) Parse + validate the request.
  let body: {
    action?: string;
    userId?: string;
    password?: string;
    email?: string;
    phone?: string;
    countryCode?: string;
    displayName?: string;
    role?: string;
    gender?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const { action, userId } = body;

  // createUser is the one action that has no target userId yet.
  if (action === "createUser") {
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(body.phone ?? "", body.countryCode);
    // At least one identifier is required — mirrors self-registration, which
    // now requires a phone (email optional).
    if (email && !/.+@.+\..+/.test(email)) return json({ error: "invalid email" }, 400);
    if (!email && phone.length < 8) return json({ error: "email or phone required" }, 400);
    // Same minimum as self-registration (app/(auth)/register.tsx) and the
    // admin form's «٦ أحرف على الأقل» label — they previously disagreed (6 vs
    // 8), so valid submissions failed with an opaque "password too short".
    if (!body.password || body.password.length < 6) {
      return json({ error: "كلمة المرور قصيرة (٦ أحرف على الأقل)" }, 400);
    }
    const role = body.role && VALID_ROLES.includes(body.role) ? body.role : "student";
    const name = (body.displayName ?? "").trim();
    const gender = body.gender === "male" || body.gender === "female" ? body.gender : null;
    try {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        ...(email ? { email, email_confirm: true } : {}),
        ...(phone ? { phone, phone_confirm: true } : {}),
        password: body.password,
        user_metadata: { display_name: name, role, ...(gender ? { gender } : {}) },
        app_metadata: { role },
      });
      if (cErr) return json({ error: cErr.message }, 400);
      const uid = created.user?.id;
      // The on-signup trigger creates the profiles row (role student); align it.
      // profiles.gender is the authoritative copy (buddy pairing + gendered
      // sections read it), so it must be written here too, not just metadata.
      if (uid) {
        await admin
          .from("profiles")
          .update({ role, display_name: name, ...(gender ? { gender } : {}) })
          .eq("id", uid);
      }
      return json({ ok: true, userId: uid, role });
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  if (!action || !userId) return json({ error: "action and userId required" }, 400);

  const isSelf = userId === caller.user.id;

  try {
    switch (action) {
      case "ban": {
        if (isSelf) return json({ error: "cannot ban your own account" }, 400);
        await mustUpdate(admin, userId, { ban_duration: BAN_FOREVER });
        // Kill the banned user's ACTIVE sessions too — the ban alone only
        // blocks the next token refresh, so an open app could keep working for
        // up to an hour. GoTrue's admin logout endpoint revokes every refresh
        // token now; best-effort (the ban itself already succeeded).
        try {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`, {
            method: "POST",
            headers: {
              apikey: SERVICE_ROLE,
              Authorization: `Bearer ${SERVICE_ROLE}`,
            },
          });
        } catch {
          // non-fatal
        }
        return json({ ok: true, status: "banned" });
      }
      case "unban": {
        await mustUpdate(admin, userId, { ban_duration: "none" });
        return json({ ok: true, status: "active" });
      }
      case "setPassword": {
        // Same 6-char minimum as the admin UI (app/admin/user/[id].tsx) and
        // self-registration — was 8, silently rejecting valid 6–7 char inputs.
        if (!body.password || body.password.length < 6) {
          return json({ error: "كلمة المرور قصيرة (٦ أحرف على الأقل)" }, 400);
        }
        await mustUpdate(admin, userId, { password: body.password });
        return json({ ok: true });
      }
      case "updateEmail": {
        if (!body.email) return json({ error: "email required" }, 400);
        await mustUpdate(admin, userId, {
          email: body.email.trim().toLowerCase(),
          email_confirm: true,
        });
        return json({ ok: true });
      }
      case "updatePhone": {
        const phone = normalizePhone(body.phone ?? "", body.countryCode);
        if (phone.length < 8) return json({ error: "invalid phone" }, 400);
        // phone_confirm:true — admin edits never trigger an SMS/OTP (matches
        // updateEmail's email_confirm:true instant-apply).
        await mustUpdate(admin, userId, { phone, phone_confirm: true });
        return json({ ok: true });
      }
      case "updateProfile": {
        const name = (body.displayName ?? "").trim();
        await mustUpdate(admin, userId, { user_metadata: { display_name: name } });
        await admin.from("profiles").update({ display_name: name }).eq("id", userId);
        return json({ ok: true });
      }
      case "updateGender": {
        const gender = body.gender;
        if (gender !== "male" && gender !== "female") {
          return json({ error: "invalid gender" }, 400);
        }
        const { error: gErr } = await admin
          .from("profiles")
          .update({ gender })
          .eq("id", userId);
        if (gErr) return json({ error: gErr.message }, 500);
        return json({ ok: true, gender });
      }
      case "setRole": {
        if (isSelf) return json({ error: "cannot change your own role" }, 400);
        const role = body.role;
        if (!role || !VALID_ROLES.includes(role)) {
          return json({ error: "invalid role" }, 400);
        }
        await mustUpdate(admin, userId, {
          user_metadata: { role },
          app_metadata: { role },
        });
        const { error: pErr } = await admin
          .from("profiles")
          .update({ role })
          .eq("id", userId);
        if (pErr) return json({ error: pErr.message }, 500);
        return json({ ok: true, role });
      }
      case "deleteUser": {
        // Anti-lockout, mirrors ban/setRole. Cascades remove all personal rows
        // (progress, notes, notifications, prefs, push tokens, quiz attempts,
        // buddy rows, benefits — every user-owned table references auth.users
        // with `on delete cascade`; authored public content is `on delete set
        // null`), same guarantee as the self-serve delete-account function.
        if (isSelf) return json({ error: "cannot delete your own account" }, 400);
        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) return json({ error: delErr.message }, 500);
        return json({ ok: true });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function mustUpdate(
  admin: ReturnType<typeof createClient>,
  userId: string,
  attrs: Record<string, unknown>,
) {
  const { error } = await admin.auth.admin.updateUserById(userId, attrs);
  if (error) throw error;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
