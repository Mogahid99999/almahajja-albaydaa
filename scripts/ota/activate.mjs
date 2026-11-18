#!/usr/bin/env node
// Make an uploaded update live, roll back, or show what is live.
//
//   node scripts/ota/activate.mjs --status
//   node scripts/ota/activate.mjs --platform android --id <uuid>   # go live
//   node scripts/ota/activate.mjs --platform android --rollback    # back to the store build's bundle
//   node scripts/ota/activate.mjs --platform android --none        # stop offering anything
//
// Runtime defaults to app.json's version; --runtime <v> for another store version.
// Phones pick the change up on their next launch and apply it on the one after.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { rollbackDirective } from './lib.mjs';
import { makeTarget } from './target.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const runtime = opt('runtime', JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo.version);
const target = makeTarget(opt('local'));

if (flag('status')) {
  for (const p of ['android', 'ios']) {
    const live = target.readFile(`channels/${runtime}/${p}.json`);
    const uploaded = target.list(`updates/${runtime}/${p}`);
    console.log(`${p} ${runtime}: live=${live ? live.trim() : 'nothing (store bundle)'} · uploaded: ${uploaded.length}`);
    for (const id of uploaded) {
      const m = target.readFile(`updates/${runtime}/${p}/${id}/manifest.json`);
      const j = m ? JSON.parse(m) : {};
      console.log(`   ${id}  ${j.createdAt ?? '?'}  commit ${j.metadata?.commit ?? '?'}`);
    }
  }
  process.exit(0);
}

const platform = opt('platform');
if (!['android', 'ios'].includes(platform)) fail('--platform android|ios required');
const channel = `channels/${runtime}/${platform}.json`;

if (flag('rollback')) {
  const keyPath = opt('key', process.env.OTA_PRIVATE_KEY ?? path.join(ROOT, '..', 'ota-keys', 'private-key.pem'));
  const { bytes, signature } = rollbackDirective(readFileSync(keyPath, 'utf8'));
  const name = `rollback-${Date.now()}`;
  target.writeFile(`directives/${runtime}/${platform}/${name}.json`, bytes);
  target.writeFile(`directives/${runtime}/${platform}/${name}.sig`, signature);
  target.writeFile(channel, JSON.stringify({ type: 'rollback', directive: name }));
  console.log(`${platform} ${runtime}: rolling back to the store build's bundle`);
} else if (flag('none')) {
  target.writeFile(channel, JSON.stringify({ type: 'none' }));
  console.log(`${platform} ${runtime}: nothing offered (phones keep what they have)`);
} else {
  const id = (opt('id') ?? '').toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(id)) fail('--id <uuid> required');
  if (!target.readFile(`updates/${runtime}/${platform}/${id}/manifest.json`))
    fail(`update ${id} is not uploaded for ${platform} ${runtime}`);
  target.writeFile(channel, JSON.stringify({ type: 'update', id }));
  console.log(`${platform} ${runtime}: ${id} is live`);
}
