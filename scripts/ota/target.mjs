// Where OTA files go: the VPS over ssh (default) or a local folder (--local <dir>,
// used for tests and a local dry run). Only scripts/ota/* write there.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const SSH_HOST = process.env.OTA_SSH_HOST ?? 'root@161.97.135.4';
const SSH_KEY = process.env.OTA_SSH_KEY ?? path.join(homedir(), '.ssh', 'lims_vps_ed25519');
const REMOTE_DIR = process.env.OTA_REMOTE_DIR ?? '/opt/almahajja-admin/ota-data';

const SAFE = /^[0-9A-Za-z._/-]+$/;
function safe(rel) {
  if (!SAFE.test(rel) || rel.split('/').includes('..')) throw new Error(`unsafe path ${rel}`);
  return rel;
}

function ssh(script, input) {
  return execFileSync('ssh', ['-i', SSH_KEY, '-o', 'BatchMode=yes', SSH_HOST, script], {
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function makeTarget(localDir) {
  if (localDir) {
    const root = path.resolve(localDir);
    return {
      describe: () => root,
      /** Copy a staged tree in; existing files are kept (assets are content-addressed). */
      uploadTree(stageDir) {
        const walk = (rel) => {
          for (const e of readdirSync(path.join(stageDir, rel), { withFileTypes: true })) {
            const r = path.join(rel, e.name);
            if (e.isDirectory()) walk(r);
            else {
              mkdirSync(path.dirname(path.join(root, r)), { recursive: true });
              writeFileSync(path.join(root, r), readFileSync(path.join(stageDir, r)));
            }
          }
        };
        walk('');
      },
      /** Atomic write (temp + rename) so the server never reads half a file. */
      writeFile(rel, content) {
        const f = path.join(root, safe(rel));
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(`${f}.tmp`, content);
        renameSync(`${f}.tmp`, f);
      },
      readFile(rel) {
        const f = path.join(root, safe(rel));
        return existsSync(f) ? readFileSync(f, 'utf8') : null;
      },
      list(rel) {
        const d = path.join(root, safe(rel));
        return existsSync(d) ? readdirSync(d) : [];
      },
    };
  }
  return {
    describe: () => `${SSH_HOST}:${REMOTE_DIR}`,
    uploadTree(stageDir) {
      const tar = execFileSync('tar', ['-C', stageDir, '-cf', '-', '.'], { maxBuffer: 512 * 1024 * 1024 });
      ssh(`mkdir -p ${REMOTE_DIR} && tar -C ${REMOTE_DIR} --no-same-owner -xf -`, tar);
    },
    writeFile(rel, content) {
      const f = `${REMOTE_DIR}/${safe(rel)}`;
      ssh(`mkdir -p "$(dirname ${f})" && cat > ${f}.tmp && mv ${f}.tmp ${f}`, content);
    },
    readFile(rel) {
      const out = ssh(`cat ${REMOTE_DIR}/${safe(rel)} 2>/dev/null || true`).toString();
      return out || null;
    },
    list(rel) {
      return ssh(`ls -1 ${REMOTE_DIR}/${safe(rel)} 2>/dev/null || true`).toString().split('\n').filter(Boolean);
    },
  };
}
