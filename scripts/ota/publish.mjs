#!/usr/bin/env node
// Publish an over-the-air update (does NOT make it live — see activate.mjs).
//
//   node scripts/ota/publish.mjs                 # android + ios, to the VPS
//   node scripts/ota/publish.mjs --platform android
//   node scripts/ota/publish.mjs --local <dir>   # dry run into a folder
//
// Refuses unless:
//   - the working tree is clean (every update is a commit);
//   - nothing native changed since the store build (tag store-<version>, or
//     --base <ref>): package.json / lock, patches/, plugins/, app.json, certs/.
//     A native change needs a store build with a new version, never an update;
//   - .env's EXPO_PUBLIC_* equal EAS production's (the update embeds them).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildManifest, signatureHeader } from './lib.mjs';
import { makeTarget } from './target.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const run = (cmd, a, o = {}) =>
  // Only npx needs a shell on Windows; git must not get one (cmd eats the ^ in ref^{commit}).
  execFileSync(cmd, a, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32' && cmd === 'npx',
    maxBuffer: 256 * 1024 * 1024,
    ...o,
  });
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const app = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
if (app.runtimeVersion?.policy !== 'appVersion') fail('app.json runtimeVersion.policy must be "appVersion"');
const runtimeVersion = app.version;
const platforms = (opt('platform', 'all') === 'all' ? ['android', 'ios'] : [opt('platform')]).filter(Boolean);
const baseUrl = opt('base-url', 'https://updates.almahajja.app');
const keyPath = opt('key', process.env.OTA_PRIVATE_KEY ?? path.join(ROOT, '..', 'ota-keys', 'private-key.pem'));
const local = opt('local');

// 1. Clean tree
// .claude/ and supabase/ (CLI temp, migrations) never reach the app bundle.
const dirty = run('git', ['status', '--porcelain', '--untracked-files=no', '--', '.', ':!.claude', ':!supabase']).trim();
if (!flag('allow-dirty') && dirty)
  fail('uncommitted changes — commit first (or --allow-dirty for a local dry run)');
const commit = run('git', ['rev-parse', '--short', 'HEAD']).trim();

// 2. Native layer unchanged since the store build
const base = opt('base', `store-${runtimeVersion}`);
try {
  run('git', ['rev-parse', '--verify', `${base}^{commit}`], { stdio: 'pipe' });
} catch {
  fail(`no git ref "${base}" — tag the store build commit (git tag store-${runtimeVersion} <commit>) or pass --base`);
}
const nativePaths = ['package.json', 'package-lock.json', 'patches', 'plugins', 'app.json', 'certs'];
const nativeDiff = run('git', ['diff', '--name-only', base, '--', ...nativePaths]).trim();
if (nativeDiff && !flag('allow-native-diff'))
  fail(`native files changed since ${base} — this needs a store build, not an update:\n${nativeDiff}`);

// 3. Embedded env equals EAS production
if (!flag('skip-env-check')) {
  const parse = (s) =>
    Object.fromEntries(
      s
        .split(/\r?\n/)
        .filter((l) => /^EXPO_PUBLIC_\w+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
    );
  const eas = parse(run('npx', ['eas-cli', 'env:list', 'production'], { stdio: ['ignore', 'pipe', 'ignore'] }));
  const loc = parse(readFileSync(path.join(ROOT, '.env'), 'utf8'));
  const keys = new Set([...Object.keys(eas), ...Object.keys(loc)]);
  if (!keys.size) fail('could not read EAS production env');
  const bad = [...keys].filter((k) => eas[k] !== loc[k]);
  if (bad.length) fail(`.env differs from EAS production for: ${bad.join(', ')}`);
}

const privateKey = readFileSync(keyPath, 'utf8');

// 4. Export
const work = mkdtempSync(path.join(tmpdir(), 'ota-'));
const dist = path.join(work, 'dist');
console.log(`exporting ${platforms.join(' + ')} (runtime ${runtimeVersion}, commit ${commit}) …`);
run('npx', ['expo', 'export', ...platforms.flatMap((p) => ['--platform', p]), '--output-dir', dist], {
  stdio: 'inherit',
});
const metadata = JSON.parse(readFileSync(path.join(dist, 'metadata.json'), 'utf8'));
const expoConfig = JSON.parse(run('npx', ['expo', 'config', '--json', '--type', 'public'], { stdio: ['ignore', 'pipe', 'ignore'] }));
if (expoConfig.version !== runtimeVersion) fail('expo config version differs from app.json');

// 5. Stage: manifests (signed) + content-addressed assets
const stage = path.join(work, 'stage');
const ids = {};
for (const platform of platforms) {
  const { manifest, manifestBytes, files } = buildManifest({
    distDir: dist,
    metadata,
    platform,
    runtimeVersion,
    expoConfig,
    baseUrl,
    commit,
  });
  const dir = path.join(stage, 'updates', runtimeVersion, platform, manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), manifestBytes);
  writeFileSync(path.join(dir, 'signature.txt'), signatureHeader(manifestBytes, privateKey));
  mkdirSync(path.join(stage, 'assets'), { recursive: true });
  let bytes = 0;
  for (const f of files) {
    writeFileSync(path.join(stage, 'assets', f.name), f.bytes);
    if (f.gz) writeFileSync(path.join(stage, 'assets', `${f.name}.gz`), f.gz);
    bytes += f.bytes.length;
  }
  ids[platform] = manifest.id;
  console.log(`${platform}: ${manifest.id} — ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
}

// 6. Upload (adds files only; nothing goes live)
const target = makeTarget(local);
console.log(`uploading to ${target.describe()} …`);
target.uploadTree(stage);
rmSync(work, { recursive: true, force: true });

console.log('\nUploaded, NOT live. To make it live:');
for (const [p, id] of Object.entries(ids))
  console.log(`  node scripts/ota/activate.mjs --platform ${p} --id ${id}${local ? ` --local ${local}` : ''}`);
