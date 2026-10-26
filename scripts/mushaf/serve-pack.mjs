/**
 * DEV ONLY — serves a built pack tree (<workDir>/pack, from build-mushaf-pack.mjs)
 * the way the production server must: gzip bytes as-is, no Content-Encoding.
 * For testing the real download path on a phone over USB:
 *
 *   node scripts/mushaf/serve-pack.mjs <workDir>/pack [--port 8090]
 *   adb reverse tcp:8090 tcp:8090
 *   EXPO_PUBLIC_MUSHAF_PACK_URL=http://localhost:8090   (dev builds accept http)
 *
 * Fault injection while it runs (from another shell):
 *   curl localhost:8090/__ctl?down=1          every file request fails (connection reset)
 *   curl localhost:8090/__ctl?down=0          back up
 *   curl localhost:8090/__ctl?corrupt=p010.ttf.gz   next request for it gets a flipped byte
 *   curl localhost:8090/__ctl?delay=300       ms added per file (to watch progress / interrupt)
 *   curl localhost:8090/__ctl                 counters
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? '');
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) : 8090;
if (!fs.existsSync(path.join(root, 'current.json'))) {
  console.error('usage: serve-pack.mjs <workDir>/pack [--port 8090]  (needs current.json)');
  process.exit(1);
}

const ctl = { down: false, delay: 0, corrupt: new Set(), served: 0, failed: 0, bytes: 0 };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__ctl') {
      if (url.searchParams.has('down')) ctl.down = url.searchParams.get('down') === '1';
      if (url.searchParams.has('delay')) ctl.delay = Number(url.searchParams.get('delay')) || 0;
      if (url.searchParams.has('corrupt')) ctl.corrupt.add(url.searchParams.get('corrupt'));
      res.end(JSON.stringify({ ...ctl, corrupt: [...ctl.corrupt] }));
      return;
    }
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const isPackFile = file.endsWith('.gz');
    if (isPackFile && ctl.down) {
      ctl.failed++;
      req.socket.destroy();
      return;
    }
    if (isPackFile && ctl.delay) await new Promise((r) => setTimeout(r, ctl.delay));
    let body = fs.readFileSync(file);
    const name = path.basename(file);
    if (ctl.corrupt.delete(name)) {
      body = Buffer.from(body);
      body[body.length - 9] ^= 0xff;
    }
    res.writeHead(200, {
      'Content-Type': isPackFile ? 'application/gzip' : 'application/json',
      'Content-Length': body.length,
      'Cache-Control': name === 'current.json' ? 'no-cache, no-transform' : 'public, max-age=31536000, immutable, no-transform',
    });
    res.end(body);
    if (isPackFile) {
      ctl.served++;
      ctl.bytes += body.length;
    }
  })
  .listen(port, () => console.log(`mushaf pack: http://localhost:${port}  (${root})`));
