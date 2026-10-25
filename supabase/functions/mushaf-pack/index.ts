// =============================================================================
// mushaf-pack — the Madinah print pack (per-page mushaf fonts) for first-use
// download. Public, non-personal content: any signed-in caller (guests have an
// anonymous session) may read it; nothing outside `mushaf/<version>/` can be
// signed (path whitelist in _shared/mushafPack.ts).
//
//   { action: "manifest" }                     → { manifest }
//     reads mushaf/current.json { version } → mushaf/<version>/manifest.json
//   { action: "sign", version, paths: [≤50] }  → { urls: { [path]: presigned GET (1 h) } }
//
// The client (src/mushaf/pack.ts) downloads, gunzips and MD5-verifies each file.
// verify_jwt=true. Deploy like r2-read-url (multipart functions/deploy).
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

import { isValidVersion, MUSHAF_PREFIX, packKey, parsePackRequest } from "../_shared/mushafPack.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const s3 = new S3Client({
  region: "auto",
  endpoint: Deno.env.get("R2_ENDPOINT")!,
  credentials: {
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  },
});

async function readJson(key: string): Promise<unknown> {
  const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return JSON.parse(await res.Body!.transformToString());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "invalid session" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const parsed = parsePackRequest(body);
  if (typeof parsed === "string") return json({ error: parsed }, 400);

  try {
    if (parsed.action === "manifest") {
      const current = (await readJson(`${MUSHAF_PREFIX}current.json`)) as { version?: unknown };
      if (!isValidVersion(current?.version)) return json({ error: "no pack" }, 404);
      const manifest = await readJson(packKey(current.version, "manifest.json"));
      return json({ manifest }, 200, { "Cache-Control": "private, max-age=300" });
    }
    const urls: Record<string, string> = {};
    await Promise.all(
      parsed.paths.map(async (p) => {
        urls[p] = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: R2_BUCKET, Key: packKey(parsed.version, p) }),
          { expiresIn: 3600 },
        );
      }),
    );
    return json({ urls });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "r2 error" }, 502);
  }
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}
