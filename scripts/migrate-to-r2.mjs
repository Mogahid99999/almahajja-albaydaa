/**
 * One-off backfill: move existing lecture audio / attachment files out of the
 * private Supabase Storage buckets (`lectures`, `attachments`) into the
 * Cloudflare R2 bucket, and rewrite the owning DB row's path column to match.
 *
 * Idempotent — a row whose path already starts with `lectures/` or
 * `attachments/` is treated as already migrated and skipped. Does NOT delete
 * the Supabase Storage originals; they stay as a rollback safety net until the
 * R2 cutover is verified.
 *
 * Run:  node scripts/migrate-to-r2.mjs
 * Needs (from .env or shell env):
 *   EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY,
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency) — same pattern as scripts/seed-auth.mjs.
function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

const env = { ...loadEnv(), ...process.env };
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SECRET_KEY;
const R2_ENDPOINT = env.R2_ENDPOINT;
const R2_BUCKET = env.R2_BUCKET;
const R2_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY;
for (const [name, value] of Object.entries({
  EXPO_PUBLIC_SUPABASE_URL: URL,
  SUPABASE_SECRET_KEY: SERVICE_KEY,
  R2_ENDPOINT,
  R2_BUCKET,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
})) {
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
}

const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

/** One kind of thing to migrate: a table, its path column, and the Supabase bucket it lived in. */
const KINDS = [
  { table: 'lectures', column: 'audio_path', bucket: 'lectures', prefix: 'lectures' },
  { table: 'attachments', column: 'storage_path', bucket: 'attachments', prefix: 'attachments' },
];

async function migrateKind({ table, column, bucket, prefix }) {
  const res = await fetch(
    `${URL}/rest/v1/${table}?select=id,${column}&${column}=not.is.null`,
    { headers: svcHeaders },
  );
  if (!res.ok) throw new Error(`list ${table}: ${res.status} ${await res.text()}`);
  const rows = await res.json();

  let migrated = 0;
  let skipped = 0;
  const failed = [];

  for (const row of rows) {
    const path = row[column];
    if (path.startsWith(`${prefix}/`)) {
      skipped++;
      continue;
    }
    try {
      const objRes = await fetch(
        `${URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`,
        { headers: svcHeaders },
      );
      if (!objRes.ok) throw new Error(`download: ${objRes.status} ${await objRes.text()}`);
      const contentType = objRes.headers.get('content-type') ?? 'application/octet-stream';
      const bytes = new Uint8Array(await objRes.arrayBuffer());

      const key = `${prefix}/${path}`;
      await s3.send(
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: bytes, ContentType: contentType }),
      );

      const patchRes = await fetch(`${URL}/rest/v1/${table}?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...svcHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ [column]: key }),
      });
      if (!patchRes.ok) throw new Error(`patch row: ${patchRes.status} ${await patchRes.text()}`);

      migrated++;
      console.log(`  ✅ ${table}/${row.id}: ${path} → ${key}`);
    } catch (e) {
      failed.push({ id: row.id, path, error: e.message });
      console.log(`  ❌ ${table}/${row.id}: ${e.message}`);
    }
  }

  return { migrated, skipped, failed };
}

async function run() {
  const results = {};
  for (const kind of KINDS) {
    console.log(`\n=== ${kind.table} (${kind.bucket} bucket → ${kind.prefix}/) ===`);
    results[kind.table] = await migrateKind(kind);
  }

  console.log('\n--- summary ---');
  let totalFailed = 0;
  for (const [table, r] of Object.entries(results)) {
    console.log(`${table}: ${r.migrated} migrated, ${r.skipped} already done, ${r.failed.length} failed`);
    totalFailed += r.failed.length;
  }
  process.exit(totalFailed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('migrate-to-r2 crashed:', e);
  process.exit(1);
});
