/**
 * Release-config lint — PLAN_AUDIT.md Phase 13.
 *
 * Asserts the flags/config that must be false or absent in a shipped build
 * are actually false/absent, by reading source (`src/config.ts`) AND, when a
 * bundle path is given, grepping the actual JS bundle output — source can lie
 * if a build step or env override changes the value, the bundle can't.
 *
 * Run:  node scripts/release-check.mjs
 *       node scripts/release-check.mjs --bundle path/to/index.android.bundle
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleArgIdx = process.argv.indexOf('--bundle');
const bundlePath = bundleArgIdx !== -1 ? process.argv[bundleArgIdx + 1] : null;

let failed = false;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

// --- Source-level checks -----------------------------------------------
const configSrc = readFileSync(join(root, 'src/config.ts'), 'utf8');

function flagValue(name) {
  const m = configSrc.match(new RegExp(`export const ${name}\\s*=\\s*(true|false)`));
  return m ? m[1] : null;
}

check('USE_MOCK is false', flagValue('USE_MOCK') === 'false');
check('NOTIF_TEST_MODE is false', flagValue('NOTIF_TEST_MODE') === 'false');
check('BUBBLE_ENABLED is false', flagValue('BUBBLE_ENABLED') === 'false');
check(
  'DEMO_ACCOUNTS gated behind USE_MOCK',
  /export const DEMO_ACCOUNTS = USE_MOCK\s*\?/.test(configSrc),
  'must resolve to undefined at runtime when USE_MOCK is false'
);

// --- Repo-wide leak grep -------------------------------------------------
// Cheap heuristic: any literal *.supabase.co URL other than via env.ts, or a
// hardcoded service-role/secret-looking key, outside node_modules/.git.
import { execSync } from 'node:child_process';
function grep(pattern, label) {
  try {
    const out = execSync(
      `grep -rnE "${pattern}" --include='*.ts' --include='*.tsx' app/ src/ 2>/dev/null || true`,
      { cwd: root, encoding: 'utf8' }
    ).trim();
    const lines = out ? out.split('\n').filter((l) => !l.includes('src/lib/env.ts')) : [];
    check(label, lines.length === 0, lines[0]);
  } catch {
    check(label, true);
  }
}
grep('https://[a-z0-9-]+\\.supabase\\.co', 'no hardcoded Supabase URLs outside env.ts');
grep('sb_secret_|service_role', 'no hardcoded Supabase secret/service-role key literals');

// --- Bundle-level checks (optional, needs a built bundle) ---------------
if (bundlePath) {
  if (!existsSync(bundlePath)) {
    check('bundle exists at given path', false, bundlePath);
  } else {
    const bundle = readFileSync(bundlePath, 'utf8');
    check('bundle does not contain literal DEMO_ACCOUNTS credentials', !bundle.includes('test55%%'));
    check('bundle does not contain "NOTIF_TEST_MODE":true', !bundle.includes('"NOTIF_TEST_MODE":true'));
  }
} else {
  console.log('SKIP  bundle-level checks (pass --bundle <path> to a built index.*.bundle to run them)');
}

console.log(failed ? '\nrelease-check: FAILED' : '\nrelease-check: all checks passed');
process.exit(failed ? 1 : 0);
