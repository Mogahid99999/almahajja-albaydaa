// =============================================================================
// r2-read-url — mint a presigned R2 GET URL, gated the same way the removed
// Supabase Storage RLS policies (0040_storage_draft_scope.sql) were: a caller
// may read an object only if they're a content manager (admin/publisher) or
// the owning lecture/attachment is published. can_read_storage_object (SQL,
// migration 0063_r2_storage_read_gate.sql) is the single source of truth for
// that predicate — this function just calls it and, if true, signs a GET.
//
// The client (src/api/storage.ts → getReadUrl) calls this via
// supabase.functions.invoke. verify_jwt=true.
//
// Deploy: multipart POST /v1/projects/{ref}/functions/deploy?slug=r2-read-url
//         (metadata verify_jwt=true) — mirrors admin-users.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

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

  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const key = body.key;
  if (!key) return json({ error: "key required" }, 400);

  const { data: allowed, error: rpcErr } = await callerClient.rpc(
    "can_read_storage_object",
    { p_key: key },
  );
  if (rpcErr) return json({ error: rpcErr.message }, 500);
  if (!allowed) return json({ error: "forbidden" }, 403);

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { expiresIn: 3600 },
  );

  return json({ url });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
