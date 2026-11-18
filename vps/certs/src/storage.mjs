// Certificate files live on this server's disk. A link is an HMAC over the file,
// its expiry and its download name; the Edge Function certificate-files signs the same string.
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const FILE_KEY_RE = /^certificates\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|jpg)$/;
const TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg' };
export const contentType = (key) => TYPES[key.split('.').pop()];

function resolve(root, key) {
  if (!FILE_KEY_RE.test(key)) throw new Error('bad file key');
  return path.join(root, key);
}

export async function saveFile(root, key, body) {
  const target = resolve(root, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  await fs.writeFile(partial, body);
  await fs.rename(partial, target);
}

export async function readStoredFile(root, key) {
  try {
    return await fs.readFile(resolve(root, key));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function removeFile(root, key) {
  await fs.rm(resolve(root, key), { force: true });
}

export const signature = (secret, key, exp, name = '') =>
  createHmac('sha256', secret).update(`${key}\n${exp}\n${name}`).digest('hex');

export function validLink(secret, key, exp, name, sig, nowSeconds = Date.now() / 1000) {
  if (!FILE_KEY_RE.test(key) || !/^\d{1,12}$/.test(exp) || Number(exp) < nowSeconds) return false;
  if (!/^[0-9a-f]{64}$/.test(sig ?? '')) return false;
  return timingSafeEqual(Buffer.from(signature(secret, key, exp, name), 'hex'), Buffer.from(sig, 'hex'));
}
