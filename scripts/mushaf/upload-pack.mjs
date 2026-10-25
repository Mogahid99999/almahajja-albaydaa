/**
 * Upload a built Madinah print pack to R2, then (and only then) point
 * mushaf/current.json at it.
 *
 *   node scripts/mushaf/upload-pack.mjs <envFile> <packDir>/<version>
 *
 * <envFile> supplies R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * (.env.staging.local for staging, .env for production).
 *
 * Order matters for clients mid-download: every file of the new version is
 * uploaded (and re-read to compare sizes) BEFORE current.json changes, and an
 * older version's objects are never deleted here — devices keep their verified
 * pack until the new one has fully downloaded and verified.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const [envFile, dir] = process.argv.slice(2);
if (!envFile || !dir) {
  console.error('usage: upload-pack.mjs <envFile> <packDir>/<version>');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});
const Bucket = env.R2_BUCKET;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const prefix = `mushaf/${manifest.version}/`;

let next = 0;
let uploaded = 0;
async function worker() {
  while (next < manifest.files.length) {
    const f = manifest.files[next++];
    const Key = prefix + f.path;
    try {
      // Skip what is already there with the right size (re-runs resume).
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
      if (head.ContentLength === f.size) { uploaded++; continue; }
    } catch { /* not there yet */ }
    const Body = fs.readFileSync(path.join(dir, f.path));
    if (Body.length !== f.size) throw new Error('local size mismatch ' + f.path);
    // Stored as plain gzip bytes (NO Content-Encoding) so no HTTP stack unpacks
    // them on the way: the app gunzips and verifies them itself.
    await s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType: 'application/gzip', CacheControl: 'public, max-age=31536000, immutable' }));
    const check = await s3.send(new HeadObjectCommand({ Bucket, Key }));
    if (check.ContentLength !== f.size) throw new Error('remote size mismatch ' + f.path);
    if (++uploaded % 50 === 0) console.log(`${uploaded}/${manifest.files.length}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
await s3.send(new PutObjectCommand({ Bucket, Key: prefix + 'manifest.json', Body: JSON.stringify(manifest), ContentType: 'application/json' }));
const back = await s3.send(new GetObjectCommand({ Bucket, Key: prefix + 'manifest.json' }));
if (JSON.parse(await back.Body.transformToString()).version !== manifest.version) throw new Error('manifest readback');
await s3.send(new PutObjectCommand({ Bucket, Key: 'mushaf/current.json', Body: JSON.stringify({ version: manifest.version }), ContentType: 'application/json', CacheControl: 'no-cache' }));
console.log(JSON.stringify({ version: manifest.version, files: manifest.files.length, totalSize: manifest.totalSize, current: 'updated' }));
