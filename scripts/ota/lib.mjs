// Shared by scripts/ota/publish.mjs and activate.mjs (and their tests): builds
// expo-updates protocol-v1 manifests from an `expo export` folder and signs
// them. Signing happens HERE, on the developer machine — the server only
// stores the signed bytes (see ota-server/server.mjs).
import { createHash, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export const KEY_ID = 'main';
export const ALG = 'rsa-v1_5-sha256';

/** Files worth serving pre-gzipped (already-compressed formats are skipped). */
const GZIP_EXTS = new Set(['hbc', 'js', 'bundle', 'json', 'svg', 'ttf', 'otf', 'txt']);

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The value of an `expo-signature` part header for exactly these bytes. */
export function signatureHeader(bytes, privateKeyPem) {
  const sig = sign('sha256', bytes, privateKeyPem).toString('base64');
  return `sig="${sig}", keyid="${KEY_ID}", alg="${ALG}"`;
}

function describe(distDir, relPath, ext, baseUrl) {
  const bytes = readFileSync(path.join(distDir, relPath));
  const hex = createHash('sha256').update(bytes).digest('hex');
  const e = ext.replace(/^\./, '').toLowerCase();
  const name = `${hex}.${e}`;
  const file = { name, bytes };
  if (GZIP_EXTS.has(e)) {
    const gz = gzipSync(bytes, { level: 9 });
    if (gz.length < bytes.length * 0.9) file.gz = gz;
  }
  return {
    file,
    asset: {
      hash: base64url(createHash('sha256').update(bytes).digest()),
      // MD5 hex = Metro's packagerHash, the key the store build registers its
      // embedded assets under (EmbeddedUpdate.kt): phones then reuse the
      // images/fonts they already have and download only what changed.
      key: createHash('md5').update(bytes).digest('hex'),
      url: `${baseUrl}/assets/${name}`,
      ext: e,
    },
  };
}

/**
 * One platform's manifest from `expo export` output.
 * @returns {{ manifest: object, manifestBytes: Buffer, files: {name:string, bytes:Buffer, gz?:Buffer}[] }}
 */
export function buildManifest({ distDir, metadata, platform, runtimeVersion, expoConfig, baseUrl, commit, createdAt }) {
  const meta = metadata.fileMetadata?.[platform];
  if (!meta?.bundle) throw new Error(`no ${platform} bundle in metadata.json`);
  const files = [];
  const launch = describe(distDir, meta.bundle, path.extname(meta.bundle) || '.hbc', baseUrl);
  files.push(launch.file);
  const assets = (meta.assets ?? []).map((a) => {
    const d = describe(distDir, a.path, a.ext, baseUrl);
    files.push(d.file);
    return {
      hash: d.asset.hash,
      key: d.asset.key,
      contentType: MIME[d.asset.ext] ?? 'application/octet-stream',
      fileExtension: `.${d.asset.ext}`,
      url: d.asset.url,
    };
  });
  const manifest = {
    id: randomUUID(),
    createdAt: createdAt ?? new Date().toISOString(),
    runtimeVersion,
    launchAsset: {
      hash: launch.asset.hash,
      key: launch.asset.key,
      contentType: 'application/javascript',
      url: launch.asset.url,
    },
    assets,
    metadata: commit ? { commit } : {},
    // Constants.expoConfig inside an update comes from extra.expoClient: the
    // app reads its version (UpdateGate, feedback) and the EAS projectId (push
    // token) from it, so it MUST be the full public app config.
    extra: {
      expoClient: expoConfig,
      ...(expoConfig?.extra?.eas?.projectId ? { eas: { projectId: expoConfig.extra.eas.projectId } } : {}),
    },
  };
  return { manifest, manifestBytes: Buffer.from(JSON.stringify(manifest)), files };
}

/** A signed «roll back to the bundle inside the store build» directive. */
export function rollbackDirective(privateKeyPem, commitTime = new Date().toISOString()) {
  const bytes = Buffer.from(JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime } }));
  return { bytes, signature: signatureHeader(bytes, privateKeyPem) };
}
