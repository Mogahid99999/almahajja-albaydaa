// Startup configuration. Every value comes from the environment; validation
// collects ALL problems and reports variable NAMES only — never values, since
// most of them are secrets.

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
  };
}
