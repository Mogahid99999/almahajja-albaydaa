// =============================================================================
// r2-delete — delete an object from the R2 bucket, admin/publisher only.
//
// The client (src/api/storage.ts → deleteFromR2) calls this after removing
// the owning DB row (lecture/attachment) — best-effort cleanup, mirrors the
// old supabase.storage.from(bucket).remove([path]) calls. verify_jwt=true.
//
// Deploy: multipart POST /v1/projects/{ref}/functions/deploy?slug=r2-delete
//         (metadata verify_jwt=true) — mirrors admin-users.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DeleteObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller?.user) return json({ error: "invalid session" }, 401);

  const { data: isManager } = await callerClient.rpc("is_content_manager");
  if (!isManager) return json({ error: "forbidden" }, 403);

  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const key = body.key;
  if (!key) return json({ error: "key required" }, 400);

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  return json({ ok: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
