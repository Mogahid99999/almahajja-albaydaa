// =============================================================================
// r2-upload-url — mint a presigned R2 PUT URL for admin/publisher uploads.
//
// The client (src/api/storage.ts → uploadToR2) calls this via
// supabase.functions.invoke, then PUTs the file bytes straight to R2 with the
// returned URL — the R2 secret key never reaches the client. verify_jwt=true,
// so Supabase validates the caller's token at the gateway; this function then
// confirms the caller is a content manager (is_content_manager() — the same
// admin/publisher gate every other content-write path uses, see
// supabase/migrations/0023_publisher_policies.sql) before minting a URL.
//
// R2 has no bucket-level MIME/size enforcement like the old Supabase buckets
// had (0040_storage_draft_scope.sql), so the content-type allow-list is
// re-checked here — the one gate standing between a caller and the bucket.
//
// Deploy: multipart POST /v1/projects/{ref}/functions/deploy?slug=r2-upload-url
//         (metadata verify_jwt=true) — mirrors admin-users.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
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

const KEY_PREFIX = { lecture: "lectures", attachment: "attachments" } as const;

// Mirrors the allow-lists 0040_storage_draft_scope.sql put on the old buckets.
const ALLOWED_CONTENT_TYPES: Record<keyof typeof KEY_PREFIX, string[]> = {
  lecture: [
    "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav",
    "audio/webm", "audio/flac",
  ],
  attachment: [
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/epub+zip", "text/plain",
  ],
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

  let body: { kind?: string; fileName?: string; contentType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const { kind, fileName, contentType } = body;
  if (kind !== "lecture" && kind !== "attachment") {
    return json({ error: "invalid kind" }, 400);
  }
  if (!fileName || !contentType) {
    return json({ error: "fileName and contentType required" }, 400);
  }
  if (!ALLOWED_CONTENT_TYPES[kind].includes(contentType)) {
    return json({ error: `content type not allowed for ${kind}` }, 400);
  }

  const ext = (fileName.split(".").pop() || "bin").toLowerCase();
  const safeBase = fileName
    .replace(/\.[^.]*$/, "")
    .replace(/[^\w-]/g, "_")
    .slice(0, 40);
  const key = `${KEY_PREFIX[kind]}/${Date.now()}-${safeBase || "file"}.${ext}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 600 },
  );

  return json({ uploadUrl, key });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
