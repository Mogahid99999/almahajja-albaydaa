// =============================================================================
// certificate-files: short-lived signed URLs for a certificate's PDF and preview.
// verify_jwt=true. Only the owner or content staff, only a valid certificate
// (certificate_files_for, 0170). The R2 keys never reach the client.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const EXPIRES_SECONDS = 300;

const s3 = new S3Client({
  region: "auto",
  endpoint: Deno.env.get("R2_ENDPOINT")!,
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
});

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

  const sign = (Key: string, disposition?: string) =>
    getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key, ResponseContentDisposition: disposition }),
      { expiresIn: EXPIRES_SECONDS },
    );
  return json({
    pdf_url: await sign(data.pdf_key, `attachment; filename="certificate-${id.toUpperCase()}.pdf"`),
    preview_url: await sign(data.preview_key),
    expires_in: EXPIRES_SECONDS,
  });
});
