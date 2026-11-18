// المحجة البيضاء — over-the-air update server (expo-updates protocol v1).
//
// Read-only by design: it serves manifests that scripts/ota/publish.mjs built
// and SIGNED on the developer machine, plus content-addressed asset files. The
// private key never reaches this server, so whoever controls it still cannot
// push code the app would accept. Files arrive over ssh; there is no upload API.
//
// DATA_DIR layout (written only by the scripts in scripts/ota/):
//   assets/<sha256hex>.<ext>[.gz]                     immutable, shared by updates
//   updates/<runtime>/<platform>/<id>/manifest.json   exact signed bytes
//   updates/<runtime>/<platform>/<id>/signature.txt   expo-signature header value
//   directives/<runtime>/<platform>/<name>.json|.sig  signed rollBackToEmbedded
//   channels/<runtime>/<platform>.json                what is live:
//     {"type":"update","id":"<uuid>"} | {"type":"rollback","directive":"<name>"} | {"type":"none"}
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const PLATFORMS = new Set(['android', 'ios']);
const RUNTIME_RE = /^[0-9A-Za-z._-]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME_RE = /^[0-9A-Za-z_-]{1,64}$/;
const ASSET_RE = /^[0-9a-f]{64}(\.[0-9a-z]{1,10})?$/;

const MIME = {
  hbc: 'application/javascript',
  js: 'application/javascript',
  bundle: 'application/javascript',
  json: 'application/json',
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
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

export function mimeFor(fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

const PROTOCOL_HEADERS = {
  'expo-protocol-version': '1',
  'expo-sfv-version': '0',
  'cache-control': 'private, max-age=0',
};

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function multipart(partName, body, signature) {
  const boundary = `ota-${randomBytes(12).toString('hex')}`;
  const head =
    `--${boundary}\r\n` +
    `content-disposition: form-data; name="${partName}"\r\n` +
    'content-type: application/json; charset=utf-8\r\n' +
    (signature ? `expo-signature: ${signature}\r\n` : '') +
    '\r\n';
  return {
    contentType: `multipart/mixed; boundary=${boundary}`,
    body: Buffer.concat([Buffer.from(head), body, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  };
}

/** Decide the manifest-endpoint answer. Pure apart from reading DATA_DIR. */
export async function manifestResponse(dataDir, headers) {
  const h = (k) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  if (h('expo-protocol-version') !== '1') return { status: 406, log: 'protocol' };
  const platform = h('expo-platform');
  const runtime = h('expo-runtime-version');
  if (!PLATFORMS.has(platform ?? '')) return { status: 400, log: 'platform' };
  if (!RUNTIME_RE.test(runtime ?? '')) return { status: 400, log: 'runtime' };

  const channel = await readJson(path.join(dataDir, 'channels', runtime, `${platform}.json`));
  const current = (h('expo-current-update-id') ?? '').toLowerCase();
  const embedded = (h('expo-embedded-update-id') ?? '').toLowerCase();
  const tag = `${platform} ${runtime}`;

  if (channel?.type === 'update' && UUID_RE.test(channel.id ?? '')) {
    if (current === channel.id) return { status: 204, log: `${tag} up-to-date` };
    const dir = path.join(dataDir, 'updates', runtime, platform, channel.id);
    let manifest;
    let signature;
    try {
      manifest = await readFile(path.join(dir, 'manifest.json'));
      signature = (await readFile(path.join(dir, 'signature.txt'), 'utf8')).trim();
    } catch {
      return { status: 500, log: `${tag} missing ${channel.id}` };
    }
    const part = multipart('manifest', manifest, signature);
    return { status: 200, contentType: part.contentType, body: part.body, log: `${tag} serve ${channel.id}` };
  }

  if (channel?.type === 'rollback' && NAME_RE.test(channel.directive ?? '')) {
    // Already on the embedded bundle: nothing to roll back.
    if (!current || current === embedded) return { status: 204, log: `${tag} embedded` };
    const base = path.join(dataDir, 'directives', runtime, platform, channel.directive);
    let directive;
    let signature;
    try {
      directive = await readFile(`${base}.json`);
      signature = (await readFile(`${base}.sig`, 'utf8')).trim();
    } catch {
      return { status: 500, log: `${tag} missing directive` };
    }
    const part = multipart('directive', directive, signature);
    return { status: 200, contentType: part.contentType, body: part.body, log: `${tag} rollback` };
  }

  return { status: 204, log: `${tag} none` };
}

/** Resolve an asset request to a file on disk, or null. */
export async function assetFile(dataDir, name, acceptEncoding) {
  if (!ASSET_RE.test(name)) return null;
  const file = path.join(dataDir, 'assets', name);
  if (/\bgzip\b/.test(acceptEncoding ?? '')) {
    try {
      const s = await stat(`${file}.gz`);
      return { file: `${file}.gz`, size: s.size, gzip: true, type: mimeFor(name) };
    } catch {
      // no pre-compressed copy
    }
  }
  try {
    const s = await stat(file);
    return { file, size: s.size, gzip: false, type: mimeFor(name) };
  } catch {
    return null;
  }
}

export function createOtaServer(dataDir) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      if (url.pathname === '/api/manifest') {
        const r = await manifestResponse(dataDir, req.headers);
        console.log(`manifest ${r.status} ${r.log}`);
        if (r.status !== 200) {
          res.writeHead(r.status, PROTOCOL_HEADERS).end();
          return;
        }
        res.writeHead(200, { ...PROTOCOL_HEADERS, 'content-type': r.contentType, 'content-length': r.body.length });
        res.end(req.method === 'HEAD' ? undefined : r.body);
        return;
      }
      if (url.pathname.startsWith('/assets/')) {
        const a = await assetFile(dataDir, url.pathname.slice('/assets/'.length), req.headers['accept-encoding']);
        if (!a) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          'content-type': a.type,
          'content-length': a.size,
          'cache-control': 'public, max-age=31536000, immutable',
          vary: 'accept-encoding',
          ...(a.gzip ? { 'content-encoding': 'gzip' } : {}),
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(a.file).on('error', () => res.destroy()).pipe(res);
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      console.error('error', url.pathname, e?.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  const dataDir = process.env.DATA_DIR ?? '/data';
  const port = Number(process.env.PORT ?? 8080);
  createOtaServer(dataDir).listen(port, () => console.log(`ota listening :${port} data=${dataDir}`));
}
