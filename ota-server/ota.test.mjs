// node --test ota-server/ — the OTA server + publish lib, end to end on real files.
//
// Invariants:
//  - every manifest/directive signature verifies against certs/certificate.pem
//    exactly as expo-updates does on Android (SHA256withRSA over the part bytes,
//    base64 `sig` in the expo-signature dictionary, keyid "main");
//  - the manifest carries the full app config in extra.expoClient (version +
//    EAS projectId — push tokens depend on it);
//  - nothing live → 204; already on the live update → 204; rollback → signed
//    rollBackToEmbedded directive; assets served byte-exact (hash matches),
//    gzip when asked, immutable caching; bad input refused, no path escapes.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, verify, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { buildManifest, rollbackDirective, signatureHeader } from '../scripts/ota/lib.mjs';
import { makeTarget } from '../scripts/ota/target.mjs';
import { createOtaServer } from './server.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const realKey = path.join(ROOT, '..', 'ota-keys', 'private-key.pem');
const cert = path.join(ROOT, 'certs', 'certificate.pem');

// The real key pair when present (proves key ↔ shipped certificate); else a throwaway one.
let privateKey;
let publicKey;
if (existsSync(realKey) && existsSync(cert)) {
  privateKey = readFileSync(realKey, 'utf8');
  publicKey = new X509Certificate(readFileSync(cert)).publicKey;
} else {
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = kp.privateKey.export({ type: 'pkcs1', format: 'pem' });
  publicKey = kp.publicKey;
}

function verifyHeader(header, bytes) {
  const sig = /sig="([^"]+)"/.exec(header)?.[1];
  const keyid = /keyid="([^"]+)"/.exec(header)?.[1];
  assert.equal(keyid, 'main');
  assert.ok(sig, 'sig present');
  return verify('sha256', bytes, publicKey, Buffer.from(sig, 'base64'));
}

const data = mkdtempSync(path.join(tmpdir(), 'ota-data-'));
const dist = mkdtempSync(path.join(tmpdir(), 'ota-dist-'));
const RUNTIME = '1.1.8';
const bundle = Buffer.from('var x = "' + 'ب'.repeat(5000) + '";');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
mkdirSync(path.join(dist, '_expo/static/js/android'), { recursive: true });
mkdirSync(path.join(dist, 'assets'), { recursive: true });
writeFileSync(path.join(dist, '_expo/static/js/android/entry-abc.hbc'), bundle);
writeFileSync(path.join(dist, 'assets/f00'), png);
const metadata = {
  version: 0,
  bundler: 'metro',
  fileMetadata: { android: { bundle: '_expo/static/js/android/entry-abc.hbc', assets: [{ path: 'assets/f00', ext: 'png' }] } },
};
const expoConfig = { name: 'المحجة البيضاء', version: RUNTIME, extra: { eas: { projectId: 'bd220e01-test' } } };

let server;
let base;
let published;

function stageUpdate(createdAt) {
  const built = buildManifest({
    distDir: dist,
    metadata,
    platform: 'android',
    runtimeVersion: RUNTIME,
    expoConfig,
    baseUrl: base,
    commit: 'abc1234',
    createdAt,
  });
  const stage = mkdtempSync(path.join(tmpdir(), 'ota-stage-'));
  const dir = path.join(stage, 'updates', RUNTIME, 'android', built.manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), built.manifestBytes);
  writeFileSync(path.join(dir, 'signature.txt'), signatureHeader(built.manifestBytes, privateKey));
  mkdirSync(path.join(stage, 'assets'), { recursive: true });
  for (const f of built.files) {
    writeFileSync(path.join(stage, 'assets', f.name), f.bytes);
    if (f.gz) writeFileSync(path.join(stage, 'assets', `${f.name}.gz`), f.gz);
  }
  makeTarget(data).uploadTree(stage);
  return built;
}

const ask = (headers = {}, p = '/api/manifest') =>
  fetch(base + p, {
    headers: {
      'expo-protocol-version': '1',
      'expo-platform': 'android',
      'expo-runtime-version': RUNTIME,
      'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
      ...headers,
    },
  });

/** Split a multipart/mixed body into { name, headers, body } parts. */
async function parts(res) {
  const boundary = /boundary=([^;]+)/.exec(res.headers.get('content-type'))[1];
  const raw = Buffer.from(await res.arrayBuffer()).toString('latin1');
  return raw
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const c = chunk.replace(/^\r\n/, '').replace(/\r\n$/, '');
      const sep = c.indexOf('\r\n\r\n');
      const headers = Object.fromEntries(
        c
          .slice(0, sep)
          .split('\r\n')
          .map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]),
      );
      return { name: /name="([^"]+)"/.exec(headers['content-disposition'])[1], headers, body: Buffer.from(c.slice(sep + 4), 'latin1') };
    });
}

before(async () => {
  server = createOtaServer(data);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('nothing live yet → 204 with protocol headers', async () => {
  const r = await ask();
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('expo-protocol-version'), '1');
  assert.equal(r.headers.get('expo-sfv-version'), '0');
});

test('uploaded but not activated is still not served', async () => {
  published = stageUpdate();
  assert.equal((await ask()).status, 204);
});

test('activated → a signed manifest the app will accept, with the full app config', async () => {
  makeTarget(data).writeFile(`channels/${RUNTIME}/android.json`, JSON.stringify({ type: 'update', id: published.manifest.id }));
  const r = await ask();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^multipart\/mixed; boundary=/);
  assert.equal(r.headers.get('cache-control'), 'private, max-age=0');
  const [m] = await parts(r);
  assert.equal(m.name, 'manifest');
  assert.ok(verifyHeader(m.headers['expo-signature'], m.body), 'signature verifies against the shipped certificate');
  const manifest = JSON.parse(m.body.toString('utf8'));
  assert.equal(manifest.runtimeVersion, RUNTIME);
  assert.equal(manifest.extra.expoClient.version, RUNTIME);
  assert.equal(manifest.extra.expoClient.extra.eas.projectId, 'bd220e01-test');
  assert.equal(manifest.extra.eas.projectId, 'bd220e01-test');
  assert.equal(manifest.launchAsset.contentType, 'application/javascript');
  assert.equal(manifest.launchAsset.fileExtension, undefined);
  assert.equal(manifest.assets[0].fileExtension, '.png');
  // Same key as the store build's embedded copy → not downloaded again.
  assert.equal(manifest.assets[0].key, createHash('md5').update(png).digest('hex'));
  assert.equal(manifest.metadata.commit, 'abc1234');
});

test('a tampered manifest no longer verifies', () => {
  const header = signatureHeader(published.manifestBytes, privateKey);
  const tampered = Buffer.from(published.manifestBytes.toString().replace('abc1234', 'evil999'));
  assert.equal(verifyHeader(header, tampered), false);
});

test('a phone already on the live update gets 204', async () => {
  assert.equal((await ask({ 'expo-current-update-id': published.manifest.id })).status, 204);
});

test('assets are byte-exact (hash matches), gzip when asked, cached forever', async () => {
  const r = await ask({}, '/api/manifest');
  const manifest = JSON.parse((await parts(r))[0].body.toString('utf8'));
  for (const a of [manifest.launchAsset, ...manifest.assets]) {
    const plain = await fetch(a.url, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const bytes = Buffer.from(await plain.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('base64url');
    assert.equal(hash, a.hash);
  }
  // The bundle is large and text: served pre-gzipped when the phone accepts it.
  const { request } = await import('node:http');
  const gz = await new Promise((resolve) =>
    request(manifest.launchAsset.url, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c)).on('end', () => resolve({ res, body: Buffer.concat(chunks) }));
    }).end(),
  );
  assert.equal(gz.res.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(gz.body), bundle);
});

test('rollback → a signed rollBackToEmbedded directive; a phone on the store bundle gets 204', async () => {
  const { bytes, signature } = rollbackDirective(privateKey, '2026-11-18T10:00:00.000Z');
  const t = makeTarget(data);
  t.writeFile(`directives/${RUNTIME}/android/rb1.json`, bytes);
  t.writeFile(`directives/${RUNTIME}/android/rb1.sig`, signature);
  t.writeFile(`channels/${RUNTIME}/android.json`, JSON.stringify({ type: 'rollback', directive: 'rb1' }));

  const embedded = '00000000-0000-0000-0000-000000000001';
  const onUpdate = await ask({ 'expo-current-update-id': published.manifest.id, 'expo-embedded-update-id': embedded });
  assert.equal(onUpdate.status, 200);
  const [d] = await parts(onUpdate);
  assert.equal(d.name, 'directive');
  assert.ok(verifyHeader(d.headers['expo-signature'], d.body));
  assert.deepEqual(JSON.parse(d.body.toString()), {
    type: 'rollBackToEmbedded',
    parameters: { commitTime: '2026-11-18T10:00:00.000Z' },
  });

  const onStore = await ask({ 'expo-current-update-id': embedded, 'expo-embedded-update-id': embedded });
  assert.equal(onStore.status, 204);
});

test('another store version never receives this runtime’s update', async () => {
  makeTarget(data).writeFile(`channels/${RUNTIME}/android.json`, JSON.stringify({ type: 'update', id: published.manifest.id }));
  assert.equal((await ask({ 'expo-runtime-version': '1.1.7' })).status, 204);
  assert.equal((await ask({ 'expo-platform': 'ios' })).status, 204);
});

test('bad input is refused and paths cannot escape the data folder', async () => {
  assert.equal((await ask({ 'expo-platform': 'web' })).status, 400);
  assert.equal((await ask({ 'expo-runtime-version': '../../etc' })).status, 400);
  assert.equal((await ask({ 'expo-protocol-version': '0' })).status, 406);
  assert.equal((await fetch(`${base}/assets/..%2F..%2Fchannels`)).status, 404);
  assert.equal((await fetch(`${base}/assets/${'a'.repeat(64)}.png`)).status, 404);
  assert.equal((await fetch(`${base}/api/manifest`, { method: 'POST' })).status, 405);
  assert.throws(() => makeTarget(data).writeFile('../escape.json', '{}'), /unsafe/);
});
