/**
 * End-to-end check of a published Madinah pack, exactly as the app fetches it:
 * <base>/current.json → <base>/<version>/manifest.json → every file → gunzip
 * (CRC) → raw size + MD5 against the manifest. Also checks that no file is
 * served with a Content-Encoding (an HTTP stack would unpack it on the way and
 * the app's size check would fail), and that the base is HTTPS.
 *
 *   node scripts/mushaf/verify-pack.mjs <baseUrl> [--sample N] [--allow-http]
 *
 * --sample N   checks only N files spread across the pack (default: all)
 * --allow-http for the local dev server (serve-pack.mjs) only
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--'))?.replace(/\/+$/, '');
const sampleAt = args.indexOf('--sample');
const sample = sampleAt >= 0 ? Math.max(1, Number(args[sampleAt + 1]) || 10) : 0;
if (!base) {
  console.error('usage: verify-pack.mjs <baseUrl> [--sample N] [--allow-http]');
  process.exit(1);
}
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
if (!base.startsWith('https://') && !args.includes('--allow-http')) fail('the pack must be served over HTTPS');

const getJson = async (url) => {
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) fail(`${url}: HTTP ${r.status}`);
  return r.json();
};

const { version } = await getJson(`${base}/current.json`);
if (!/^[a-zA-Z0-9._-]{1,64}$/.test(version ?? '')) fail('current.json: bad version');
const manifest = await getJson(`${base}/${version}/manifest.json`);
if (manifest.version !== version) fail('manifest version ≠ current.json');

let files = manifest.files;
if (sample) files = files.filter((_, i) => i % Math.ceil(files.length / sample) === 0);
let bytes = 0;
for (let i = 0; i < files.length; i += 8) {
  await Promise.all(files.slice(i, i + 8).map(async (f) => {
    // Node's fetch does not unpack unless asked, so the header is visible as sent.
    const r = await fetch(`${base}/${version}/${f.path}`, { headers: { 'Accept-Encoding': 'identity' } });
    if (!r.ok) fail(`${f.path}: HTTP ${r.status}`);
    const enc = r.headers.get('content-encoding');
    if (enc && enc !== 'identity') fail(`${f.path}: served with Content-Encoding ${enc}`);
    const gz = Buffer.from(await r.arrayBuffer());
    if (gz.length !== f.size) fail(`${f.path}: size ${gz.length} ≠ ${f.size}`);
    const raw = zlib.gunzipSync(gz);
    if (raw.length !== f.raw) fail(`${f.path}: raw size`);
    if (crypto.createHash('md5').update(raw).digest('hex') !== f.md5) fail(`${f.path}: md5`);
    bytes += gz.length;
  }));
}
console.log(JSON.stringify({ ok: true, version, checked: files.length, of: manifest.files.length, downloadedBytes: bytes, totalSize: manifest.totalSize }));
