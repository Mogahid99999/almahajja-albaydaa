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
// kind `lecture_raw` (V23 §5.3): the admin's ORIGINAL file for server-side
// compression — opaque key `incoming/<uuid>.<ext>`, ≤ 2 GB with the declared
// size bound into the signature (ContentLength), 2 h TTL. The media worker
// transcodes it to the normal lecture key (`_shared/lectureKey.ts`, the same
// naming this function uses) and deletes the original.
//
// Deploy: `npx supabase functions deploy r2-upload-url --project-ref <ref>`
//         (bundles ../_shared/*), or multipart POST
//         /v1/projects/{ref}/functions/deploy?slug=r2-upload-url with the
//         _shared files included (metadata verify_jwt=true).
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

import { sanitize, uniqueLectureKey } from "../_shared/lectureKey.ts";
import { checkRawUpload, RAW_URL_TTL_SECONDS, rawIncomingKey } from "../_shared/rawUpload.ts";

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

const KEY_PREFIX = {
  lecture: "lectures",
  attachment: "attachments",
  broadcast: "broadcasts",
  // جواب صوتي — the sheikh's WhatsApp-style voice answer (mono low-bitrate m4a).
  answer: "answers",
} as const;

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
  // بروادكاست images only — the التذكيرات النافعة admin image picker.
  broadcast: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  // Recorded voice answers — same audio types as a lecture, so a mono
  // m4a (audio/mp4) is accepted.
  answer: [
    "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav",
    "audio/webm", "audio/flac",
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

// A ranged GetObjectCommand (1 byte) rather than HeadObjectCommand — R2
// returned a hanging/failed response for HeadObjectCommand in practice, while
// GetObjectCommand (already used by r2-read-url) is proven reliable here.
async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, Range: "bytes=0-0" }));
    return true;
  } catch {
    return false;
  }
}

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

  let body: {
    kind?: string;
    fileName?: string;
    contentType?: string;
    /** Lecture only: the section title, so audio lands in a matching R2 folder. */
    folder?: string;
    /** Lecture only: the admin-entered lesson title — used verbatim (sanitized) as the file name. */
    displayName?: string;
    /**
     * Broadcast only: an existing reminder-image key. The upload goes to the
     * fixed companion key `<variantOf>.push.jpg` — the letterboxed 2:1 copy
     * notify-on-publish sends as the push BigPicture (Android crops the
     * original to a wide strip, cutting tall posters).
     */
    variantOf?: string;
    /** lecture_raw only: the original's byte length — bound into the signature. */
    size?: number;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const { kind, fileName, contentType, folder, displayName, variantOf, size } = body;
  if (
    kind !== "lecture" && kind !== "attachment" && kind !== "broadcast" && kind !== "answer" &&
    kind !== "lecture_raw"
  ) {
    return json({ error: "invalid kind" }, 400);
  }

  // Content uploads (lecture/lecture_raw/attachment/broadcast) require a content
  // manager (admin/publisher). A voice answer, by contrast, is authored by a MODERATOR
  // — the sheikh (a moderator but not a content manager) must be able to record
  // and send it — so `answer` uploads gate on is_moderator() instead.
  if (kind === "answer") {
    const { data: isMod } = await callerClient.rpc("is_moderator");
    if (!isMod) return json({ error: "forbidden" }, 403);
  } else {
    const { data: isManager } = await callerClient.rpc("is_content_manager");
    if (!isManager) return json({ error: "forbidden" }, 403);
  }

  // The admin's ORIGINAL file for server-side compression (V23 §5.3). Opaque
  // `incoming/<uuid>.<ext>` key; the declared size is bound into the signed
  // PutObjectCommand (ContentLength → signed `content-length` header), so R2
  // rejects a PUT whose body differs from what was checked here.
  if (kind === "lecture_raw") {
    if (variantOf !== undefined) return json({ error: "invalid variant" }, 400);
    const check = checkRawUpload({ fileName, contentType, size });
    if (!check.ok) return json({ error: check.error }, check.error === "file too large" ? 413 : 400);
    const rawKey = rawIncomingKey(crypto.randomUUID(), check.ext);
    const rawUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: rawKey,
        ContentType: check.contentType,
        ContentLength: check.size,
      }),
      { expiresIn: RAW_URL_TTL_SECONDS },
    );
    return json({ uploadUrl: rawUrl, key: rawKey, expiresIn: RAW_URL_TTL_SECONDS });
  }

  if (!fileName || !contentType) {
    return json({ error: "fileName and contentType required" }, 400);
  }
  if (!ALLOWED_CONTENT_TYPES[kind].includes(contentType)) {
    return json({ error: `content type not allowed for ${kind}` }, 400);
  }

  if (variantOf !== undefined) {
    // Only the push companion of an existing flat broadcasts/ key, JPEG only —
    // never an arbitrary path (sanitize() strips "/" from generated names).
    if (
      kind !== "broadcast" ||
      typeof variantOf !== "string" ||
      !/^broadcasts\/[^/]+$/.test(variantOf) ||
      variantOf.endsWith(".push.jpg") ||
      contentType !== "image/jpeg"
    ) {
      return json({ error: "invalid variant" }, 400);
    }
    const variantKey = `${variantOf}.push.jpg`;
    const variantUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: variantKey, ContentType: contentType }),
      { expiresIn: 600 },
    );
    return json({ uploadUrl: variantUrl, key: variantKey });
  }

  const ext = (fileName.split(".").pop() || "bin").toLowerCase();
  const key = kind === "lecture"
    ? await uniqueLectureKey(folder, displayName, ext, objectExists)
    : `${KEY_PREFIX[kind]}/${Date.now()}-${sanitize(fileName.replace(/\.[^.]*$/, "")) || "file"}.${ext}`;

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
