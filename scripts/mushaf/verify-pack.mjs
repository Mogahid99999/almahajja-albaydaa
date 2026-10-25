/**
 * End-to-end check of the published Madinah pack, exactly as the app does it:
 * an anonymous (guest) session → mushaf-pack «manifest» → «sign» in batches →
 * download every file → gunzip (CRC) → size + MD5 against the manifest.
 * Also checks the function refuses unsigned callers and paths outside the pack.
 *
 *   node scripts/mushaf/verify-pack.mjs <envFile> [--sample N]
 *
 * <envFile> supplies EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY.
 * --sample N checks only N files spread across the pack (default: all).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createClient } from '@supabase/supabase-js';

const [envFile, flag, n] = process.argv.slice(2);
if (!envFile) {
  console.error('usage: verify-pack.mjs <envFile> [--sample N]');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const fnUrl = `${url}/functions/v1/mushaf-pack`;
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };

// 1. Unauthenticated callers are refused.
const noAuth = await fetch(fnUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"manifest"}' });
if (noAuth.status !== 401) fail('no-auth call returned ' + noAuth.status);

const sb = createClient(url, anon, { auth: { persistSession: false } });
const { error: signErr } = await sb.auth.signInAnonymously();
if (signErr) fail('anonymous sign-in: ' + signErr.message);
const call = async (body) => {
  const { data, error } = await sb.functions.invoke('mushaf-pack', { body });
  if (error) throw error;
  return data;
};

// 2. Paths outside the pack are refused.
try {
  await call({ action: 'sign', version: 'x', paths: ['../lectures/a.m4a'] });
  fail('a path outside the pack was signed');
} catch { /* expected */ }

// 3. Manifest → sign → download → verify.
const { manifest } = await call({ action: 'manifest' });
let files = manifest.files;
if (flag === '--sample') {
  const k = Math.max(1, Number(n) || 10);
  files = files.filter((_, i) => i % Math.ceil(files.length / k) === 0);
}
let bytes = 0;
for (let i = 0; i < files.length; i += 40) {
  const batch = files.slice(i, i + 40);
  const { urls } = await call({ action: 'sign', version: manifest.version, paths: batch.map((f) => f.path) });
  await Promise.all(batch.map(async (f) => {
    const r = await fetch(urls[f.path]);
    if (!r.ok) fail(`${f.path}: HTTP ${r.status}`);
    if (r.headers.get('content-encoding')) fail(`${f.path}: unexpected Content-Encoding ${r.headers.get('content-encoding')}`);
    const gz = Buffer.from(await r.arrayBuffer());
    if (gz.length !== f.size) fail(`${f.path}: size ${gz.length} ≠ ${f.size}`);
    const raw = zlib.gunzipSync(gz);
    if (raw.length !== f.raw) fail(`${f.path}: raw size`);
    if (crypto.createHash('md5').update(raw).digest('hex') !== f.md5) fail(`${f.path}: md5`);
    bytes += gz.length;
  }));
}
await sb.auth.signOut();
console.log(JSON.stringify({ ok: true, version: manifest.version, checked: files.length, of: manifest.files.length, downloadedBytes: bytes, totalSize: manifest.totalSize }));
