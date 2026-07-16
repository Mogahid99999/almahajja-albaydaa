/// <reference types="node" />
/**
 * Loads `.env.staging.local` for the contract suite and enforces the audit's
 * hard rule (PLAN_AUDIT §Phase 2 risks): live verification runs against
 * STAGING ONLY — never the production project.
 *
 * The root tsconfig pins `types: ["jest"]`, which excludes @types/node, so the
 * node module imports below need this explicit reference to typecheck (the node
 * runtime is provided by jest.contract.config.js's node testEnvironment).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const PRODUCTION_REF = 'prpyxnxgkpspjoxvcaro';

let raw = '';
try {
  // cwd is the repo root under jest; avoids __dirname (@types/node not loaded).
  raw = readFileSync(join(process.cwd(), '.env.staging.local'), 'utf8');
} catch {
  throw new Error(
    'Contract tests need .env.staging.local (staging Supabase URL/keys). See audit/FINDINGS.md staging-readiness note.',
  );
}

for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[`STAGING_${m[1]}`] = m[2];
}

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL ?? '';
if (!url || url.includes(PRODUCTION_REF)) {
  throw new Error(`Refusing to run contract tests: URL is missing or points at production (${url}).`);
}
