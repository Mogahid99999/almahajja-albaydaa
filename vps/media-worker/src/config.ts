// Startup configuration. Every value comes from the environment; validation
// collects ALL problems and reports variable NAMES only — never values, since
// most of them are secrets.

import { recordingsDirMatchesEnv } from './recordings.js';

export type WorkerEnv = 'stg' | 'prd';

export interface Config {
  workerEnv: WorkerEnv;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  r2Endpoint: string;
  r2Bucket: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  livekitWebhookKey: string;
  livekitWebhookSecret: string;
  port: number;
  liveLoudnorm: boolean;
  /** Scratch space for input/output files (one sub-directory per job). */
  tmpDir: string;
  /** This env's local live raws (`/recordings/<env>`), mounted from the VPS. */
  recordingsDir: string;
  /**
   * The egress container's IN-PROGRESS files (`/home/egress/tmp`, mounted
   * read-write): `<EG_id>/<room>-<time>.ogg`. Shared by BOTH envs — the worker
   * only ever touches files named after one of its own env's rooms.
   */
  egressTmpDir: string;
  /** LiveKit server API (internal URL) for ListEgress / ListParticipants; null = webhooks + file checks only. */
  livekitApiUrl: string | null;
  /** API pair for livekitApiUrl (defaults to the webhook pair — `almahajja_int`, internal only). */
  livekitApiKey: string;
  livekitApiSecret: string;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const REQUIRED = [
  'WORKER_ENV',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'LIVEKIT_WEBHOOK_KEY',
  'LIVEKIT_WEBHOOK_SECRET',
  'RECORDINGS_DIR',
] as const;

function isHttpUrl(value: string, httpsOnly: boolean): boolean {
  try {
    const u = new URL(value);
    return httpsOnly ? u.protocol === 'https:' : u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Non-secret identifiers each WORKER_ENV must match (see the mismatch check in loadConfig). */
export const ENV_PAIRS = {
  stg: { supabaseRef: 'xjtpwcwotuflomqigzfa', bucket: 'almahajja-media-staging' },
  prd: { supabaseRef: 'prpyxnxgkpspjoxvcaro', bucket: 'almahajja-media' },
} as const;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  defaultTmpDir = '/tmp/media-worker',
): Config {
  const problems: string[] = [];
  const get = (name: string): string => (env[name] ?? '').trim();

  for (const name of REQUIRED) {
    if (!get(name)) problems.push(`${name} is required`);
  }

  const workerEnv = get('WORKER_ENV');
  if (workerEnv && workerEnv !== 'stg' && workerEnv !== 'prd') {
    problems.push('WORKER_ENV must be "stg" or "prd"');
  }
  if (get('SUPABASE_URL') && !isHttpUrl(get('SUPABASE_URL'), false)) {
    problems.push('SUPABASE_URL must be an http(s) URL');
  }
  const recordingsDir = get('RECORDINGS_DIR');
  if (recordingsDir) {
    if (!recordingsDir.startsWith('/') || recordingsDir.split('/').includes('..')) {
      problems.push('RECORDINGS_DIR must be an absolute path without ".."');
    } else if ((workerEnv === 'stg' || workerEnv === 'prd') && !recordingsDirMatchesEnv(recordingsDir, workerEnv)) {
      problems.push('RECORDINGS_DIR must be this env\'s folder (/recordings/<WORKER_ENV>)');
    }
  }
  const egressTmpDir = (get('EGRESS_TMP_DIR') || '/egress-tmp').replace(/\/+$/, '');
  if (!egressTmpDir.startsWith('/') || egressTmpDir.split('/').includes('..')) {
    problems.push('EGRESS_TMP_DIR must be an absolute path without ".."');
  } else if (
    recordingsDir &&
    (egressTmpDir === recordingsDir.replace(/\/+$/, '') || egressTmpDir.startsWith(`${recordingsDir.replace(/\/+$/, '')}/`))
  ) {
    problems.push('EGRESS_TMP_DIR must not be inside RECORDINGS_DIR');
  }
  const livekitApiUrl = get('LIVEKIT_API_URL');
  if (livekitApiUrl && !isHttpUrl(livekitApiUrl, false)) {
    problems.push('LIVEKIT_API_URL must be an http(s) URL');
  }
  if (!!get('LIVEKIT_API_KEY') !== !!get('LIVEKIT_API_SECRET')) {
    problems.push('LIVEKIT_API_KEY and LIVEKIT_API_SECRET go together');
  }
  if (get('R2_ENDPOINT') && !isHttpUrl(get('R2_ENDPOINT'), true)) {
    problems.push('R2_ENDPOINT must be an https URL');
  }
  // Each environment is pinned to its own database AND bucket. A mismatch is
  // dangerous, not just broken: the orphan sweep would treat every original in
  // the other environment's bucket as unreferenced and delete it.
  const pair = workerEnv === 'stg' || workerEnv === 'prd' ? ENV_PAIRS[workerEnv] : null;
  if (pair && get('SUPABASE_URL') && !get('SUPABASE_URL').startsWith(`https://${pair.supabaseRef}.supabase.co`)) {
    problems.push(`SUPABASE_URL is not the ${workerEnv} project`);
  }
  if (pair && get('R2_BUCKET') && get('R2_BUCKET') !== pair.bucket) {
    problems.push(`R2_BUCKET is not the ${workerEnv} bucket`);
  }

  let port = 8080;
  const rawPort = get('PORT');
  if (rawPort) {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push('PORT must be an integer 1..65535');
    }
  }

  const rawLoudnorm = get('LIVE_LOUDNORM') || '0';
  if (rawLoudnorm !== '0' && rawLoudnorm !== '1') {
    problems.push('LIVE_LOUDNORM must be 0 or 1');
  }

  if (problems.length) throw new ConfigError(problems);

  return {
    workerEnv: workerEnv as WorkerEnv,
    supabaseUrl: get('SUPABASE_URL'),
    supabaseServiceRoleKey: get('SUPABASE_SERVICE_ROLE_KEY'),
    r2Endpoint: get('R2_ENDPOINT'),
    r2Bucket: get('R2_BUCKET'),
    r2AccessKeyId: get('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: get('R2_SECRET_ACCESS_KEY'),
    livekitWebhookKey: get('LIVEKIT_WEBHOOK_KEY'),
    livekitWebhookSecret: get('LIVEKIT_WEBHOOK_SECRET'),
    port,
    liveLoudnorm: rawLoudnorm === '1',
    tmpDir: get('TMP_DIR') || defaultTmpDir,
    recordingsDir: recordingsDir.replace(/\/+$/, ''),
    egressTmpDir,
    livekitApiUrl: livekitApiUrl ? livekitApiUrl.replace(/\/+$/, '') : null,
    livekitApiKey: get('LIVEKIT_API_KEY') || get('LIVEKIT_WEBHOOK_KEY'),
    livekitApiSecret: get('LIVEKIT_API_SECRET') || get('LIVEKIT_WEBHOOK_SECRET'),
  };
}
