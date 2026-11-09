// =============================================================================
// certificate-files: short-lived signed URLs for a certificate's PDF and image, and its share wording.
// verify_jwt=true. Only the owner or content staff, only a valid certificate
// (certificate_files_for, 0170). Files are on the VPS; links expire in minutes.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FILES_BASE = Deno.env.get("CERT_FILES_BASE")!.replace(/\/$/, "");
const FILES_SECRET = Deno.env.get("CERT_FILES_SECRET")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const EXPIRES_SECONDS = 300;

// Same string as vps/certs/src/storage.mjs.
async function signedLink(key: string, name = ""): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + EXPIRES_SECONDS);
  const hmac = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(FILES_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const raw = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(`${key}\n${exp}\n${name}`));
  const sig = [...new Uint8Array(raw)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const query = new URLSearchParams({ exp, sig, ...(name ? { name } : {}) });
  return `${FILES_BASE}/files/${key}?${query}`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "invalid session" }, 401);

  let id = "";
  try {
    id = String((await req.json()).id ?? "");
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!id) return json({ error: "id required" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await service.rpc("certificate_files_for", {
    p_id: id,
    p_user: who.user.id,
  });
  if (error) return json({ error: "unavailable" }, 500);
  if (!data) return json({ error: "forbidden" }, 403); // same answer for "not yours" and "no such id"

  return json({
    pdf_url: await signedLink(data.pdf_key, `certificate-${id.trim().toUpperCase()}.pdf`),
    preview_url: await signedLink(data.preview_key),
    share_text: data.title && data.verification_url
      ? `الحمد لله، أتممت دراسة «${data.title}» عبر تطبيق المَحجّة البَيْضَاء، وحصلت على شهادة إتمام.\n\nللتحقق من الشهادة:\n${data.verification_url}`
      : null,
    expires_in: EXPIRES_SECONDS,
  });
});
