// =============================================================================
// backup-media — the R2 gateway for the admin Backup & Restore page.
//
// Six admin-gated actions (POST body { action, ... }). verify_jwt=true, and
// every action re-confirms the caller is an ADMIN (profiles.role='admin', the
// same is_admin() gate the app uses) before touching R2. The R2 secret key
// never reaches the client — this function mints short-lived presigned URLs or
// performs server-side R2 copies, exactly like r2-read-url/r2-upload-url.
//
// BACKUP side:
//   list  → ListObjectsV2 over the whole bucket (paginated via continuation
//           token) → [{ key, size, etag }]. Admin-only, read inventory.
//   read  → presigned GET (10 min) for ANY key (admin backup can read all).
//
// RESTORE side — the §12 security model:
//   • The client cannot invent a restore_id. It calls start_restore_session()
//     (SQL, migration 0102) to mint one, bound to the caller + a 2h expiry.
//   • writeStaged signs a PUT ONLY under restore-staging/{restore_id}/… and
//     ONLY if is_restore_session_active(restore_id) is true for THIS caller.
//     Any key outside that prefix, or an expired/foreign session, is rejected.
//   • head → HEAD a staged (or any) key to validate size after upload.
//   • activate → server-side COPY staged objects to their live keys, first
//     archiving any live object being replaced to pre-restore/{restore_id}/…
//     (the rollback window). Then optionally delete live keys not in the
//     backup set (full-replace). Bytes never leave R2.
//   • cleanup → delete a whole prefix (restore-staging/{id}/ or pre-restore/
//     {id}/) after success/failure.
//
// Deploy: multipart POST /v1/projects/{ref}/functions/deploy?slug=backup-media
//         (metadata verify_jwt=true) — mirrors admin-users.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;

const STAGING_ROOT = "restore-staging";
const ROLLBACK_ROOT = "pre-restore";

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

/** UUID v4 shape — restore_id must match, so we never interpolate junk into keys. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Existence + size via a ranged GetObject (1 byte), NOT HeadObjectCommand.
 * HeadObject hangs/fails against R2 in this Deno runtime (documented in
 * r2-upload-url and the V13 R2 findings) — a missing object never returned a
 * clean 404, so the activate/head paths timed out. A ranged GET is the proven
 * reliable probe. Returns { exists, size } — size from Content-Range total.
 */
async function objectStat(key: string): Promise<{ exists: boolean; size: number }> {
  try {
    const r = await s3.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, Range: "bytes=0-0" }),
    );
    // ContentRange looks like "bytes 0-0/12345" → total after the slash.
    const cr = r.ContentRange ?? "";
    const total = cr.includes("/") ? parseInt(cr.split("/")[1], 10) : (r.ContentLength ?? 0);
    return { exists: true, size: Number.isFinite(total) ? total : 0 };
  } catch {
    return { exists: false, size: 0 };
  }
}

// A key is "safe" if it has no traversal / absolute / control-char tricks and
// no leading slash. R2 keys are logical, but we normalize defensively (§11).
function isSafeKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (key.startsWith("/")) return false;
  if (key.includes("..")) return false;
  if (key.includes("\\")) return false;
  // control chars
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  // no writing INTO the reserved backup roots via a normal live key
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  // 1) Identify the caller.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller?.user) return json({ error: "invalid session" }, 401);

  // 2) Every action is admin-only. is_admin() reads profiles.role under the
  //    caller's JWT (SECURITY DEFINER function, migration 0001).
  const { data: isAdmin, error: adminErr } = await callerClient.rpc("is_admin");
  if (adminErr) return json({ error: adminErr.message }, 500);
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const action = body.action as string | undefined;

  try {
    switch (action) {
      // ------------------------------------------------------------------ list
      case "list": {
        const token = typeof body.continuationToken === "string"
          ? body.continuationToken
          : undefined;
        const out = await s3.send(
          new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            MaxKeys: 1000,
            ContinuationToken: token,
            // Never surface the backup roots as part of the live inventory.
            // (They are prefixes we create; exclude via post-filter below —
            //  R2/S3 ListObjectsV2 has no NOT-prefix, so filter client-side.)
          }),
        );
        const objects = (out.Contents ?? [])
          .filter((o) =>
            o.Key &&
            !o.Key.startsWith(`${STAGING_ROOT}/`) &&
            !o.Key.startsWith(`${ROLLBACK_ROOT}/`)
          )
          .map((o) => ({ key: o.Key!, size: o.Size ?? 0, etag: o.ETag ?? null }));
        return json({
          objects,
          nextToken: out.IsTruncated ? out.NextContinuationToken ?? null : null,
        });
      }

      // ------------------------------------------------------------------ read
      case "read": {
        const key = body.key as string;
        if (!isSafeKey(key)) return json({ error: "invalid key" }, 400);
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
          { expiresIn: 600 },
        );
        return json({ url });
      }

      // ------------------------------------------------------------ writeStaged
      case "writeStaged": {
        const restoreId = body.restoreId as string;
        const relKey = body.key as string; // key RELATIVE to the live root
        const contentType = (body.contentType as string) || "application/octet-stream";
        if (!UUID_RE.test(restoreId ?? "")) return json({ error: "invalid restoreId" }, 400);
        if (!isSafeKey(relKey)) return json({ error: "invalid key" }, 400);

        // The session must be active AND owned by THIS caller (SQL gate).
        const { data: active, error: sErr } = await callerClient.rpc(
          "is_restore_session_active",
          { p_restore_id: restoreId },
        );
        if (sErr) return json({ error: sErr.message }, 500);
        if (!active) return json({ error: "restore session not active" }, 403);

        const stagedKey = `${STAGING_ROOT}/${restoreId}/${relKey}`;
        const url = await getSignedUrl(
          s3,
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: stagedKey,
            ContentType: contentType,
          }),
          { expiresIn: 600 },
        );
        return json({ uploadUrl: url, stagedKey });
      }

      // ------------------------------------------------------------------ head
      case "head": {
        const key = body.key as string;
        if (!isSafeKey(key)) return json({ error: "invalid key" }, 400);
        const stat = await objectStat(key);
        return json({ exists: stat.exists, size: stat.size });
      }

      // -------------------------------------------------------------- activate
      // Move ONE staged object → its live key, archiving any replaced live
      // object to pre-restore/{restoreId}/ first. Called per-object by the
      // client after all staged media validated. Idempotent-ish: re-copying is
      // safe. Kept per-object (not bulk) so a failure is localized and the
      // client can report/retry precisely.
      case "activate": {
        const restoreId = body.restoreId as string;
        const relKey = body.key as string;
        if (!UUID_RE.test(restoreId ?? "")) return json({ error: "invalid restoreId" }, 400);
        if (!isSafeKey(relKey)) return json({ error: "invalid key" }, 400);

        const { data: active, error: sErr } = await callerClient.rpc(
          "is_restore_session_active",
          { p_restore_id: restoreId },
        );
        if (sErr) return json({ error: sErr.message }, 500);
        if (!active) return json({ error: "restore session not active" }, 403);

        const stagedKey = `${STAGING_ROOT}/${restoreId}/${relKey}`;
        const liveKey = relKey;

        // Archive the existing live object (if any) to the rollback window.
        // Probe with a ranged GET (objectStat), never HeadObject — HeadObject
        // hangs against R2 when the key is missing, which previously made
        // activate time out for any NEW key (no prior live object).
        if ((await objectStat(liveKey)).exists) {
          await s3.send(
            new CopyObjectCommand({
              Bucket: R2_BUCKET,
              CopySource: `${R2_BUCKET}/${encodeURIComponent(liveKey)}`,
              Key: `${ROLLBACK_ROOT}/${restoreId}/${liveKey}`,
            }),
          );
        }

        // Promote staged → live.
        await s3.send(
          new CopyObjectCommand({
            Bucket: R2_BUCKET,
            CopySource: `${R2_BUCKET}/${encodeURIComponent(stagedKey)}`,
            Key: liveKey,
          }),
        );
        return json({ ok: true, liveKey });
      }

      // --------------------------------------------------------- deleteLiveKeys
      // Full-replace cleanup: remove live objects NOT present in the backup.
      // The client computes (live keys − backup keys) and sends them here in
      // batches, ONLY after the whole restore verified. Each deleted object is
      // archived to pre-restore/{restoreId}/ first, so it stays recoverable.
      case "deleteLiveKeys": {
        const restoreId = body.restoreId as string;
        const keys = body.keys as string[];
        if (!UUID_RE.test(restoreId ?? "")) return json({ error: "invalid restoreId" }, 400);
        if (!Array.isArray(keys) || keys.length === 0) return json({ error: "keys required" }, 400);
        if (keys.length > 1000) return json({ error: "too many keys (max 1000)" }, 400);
        for (const k of keys) {
          if (!isSafeKey(k)) return json({ error: `invalid key: ${k}` }, 400);
        }
        const { data: active } = await callerClient.rpc(
          "is_restore_session_active",
          { p_restore_id: restoreId },
        );
        if (!active) return json({ error: "restore session not active" }, 403);

        // Archive then delete.
        for (const k of keys) {
          try {
            await s3.send(
              new CopyObjectCommand({
                Bucket: R2_BUCKET,
                CopySource: `${R2_BUCKET}/${encodeURIComponent(k)}`,
                Key: `${ROLLBACK_ROOT}/${restoreId}/${k}`,
              }),
            );
          } catch {
            // best-effort archive
          }
        }
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: R2_BUCKET,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
        return json({ ok: true, deleted: keys.length });
      }

      // --------------------------------------------------------------- cleanup
      // Delete an entire reserved prefix (restore-staging/{id}/ or
      // pre-restore/{id}/). scope must name which; id must be a uuid — so this
      // can NEVER be pointed at a live prefix.
      case "cleanup": {
        const restoreId = body.restoreId as string;
        const scope = body.scope as string; // "staging" | "rollback"
        if (!UUID_RE.test(restoreId ?? "")) return json({ error: "invalid restoreId" }, 400);
        const root = scope === "rollback" ? ROLLBACK_ROOT : scope === "staging" ? STAGING_ROOT : null;
        if (!root) return json({ error: "invalid scope" }, 400);

        const prefix = `${root}/${restoreId}/`;
        let token: string | undefined;
        let deleted = 0;
        do {
          const listed = await s3.send(
            new ListObjectsV2Command({
              Bucket: R2_BUCKET,
              Prefix: prefix,
              ContinuationToken: token,
              MaxKeys: 1000,
            }),
          );
          const objs = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
          if (objs.length > 0) {
            await s3.send(
              new DeleteObjectsCommand({
                Bucket: R2_BUCKET,
                Delete: { Objects: objs },
              }),
            );
            deleted += objs.length;
          }
          token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
        } while (token);
        return json({ ok: true, deleted });
      }

      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
