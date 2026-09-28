import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const valid = {
  WORKER_ENV: 'stg',
  SUPABASE_URL: 'https://xjtpwcwotuflomqigzfa.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sr-SECRET-VALUE',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_BUCKET: 'almahajja-media-staging',
  R2_ACCESS_KEY_ID: 'AKID-SECRET-VALUE',
  R2_SECRET_ACCESS_KEY: 'R2-SECRET-VALUE',
  LIVEKIT_WEBHOOK_KEY: 'APIkey',
  LIVEKIT_WEBHOOK_SECRET: 'LK-SECRET-VALUE',
};

describe('loadConfig', () => {
  it('applies defaults (PORT 8080, loudnorm off)', () => {
    const c = loadConfig(valid);
    expect(c).toMatchObject({ workerEnv: 'stg', port: 8080, liveLoudnorm: false });
  });

  it('reads PORT, LIVE_LOUDNORM and TMP_DIR', () => {
    const c = loadConfig({ ...valid, PORT: '9000', LIVE_LOUDNORM: '1', TMP_DIR: '/work' });
    expect(c).toMatchObject({ port: 9000, liveLoudnorm: true, tmpDir: '/work' });
  });

  it('lists every problem by NAME and never echoes values', () => {
    let err: unknown;
    try {
      loadConfig({ ...valid, WORKER_ENV: 'prod', SUPABASE_SERVICE_ROLE_KEY: '', R2_ENDPOINT: 'R2-SECRET-VALUE', PORT: 'x', LIVE_LOUDNORM: 'yes' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as Error).message;
    expect(msg).toContain('SUPABASE_SERVICE_ROLE_KEY is required');
    expect(msg).toContain('WORKER_ENV must be "stg" or "prd"');
    expect(msg).toContain('R2_ENDPOINT must be an https URL');
    expect(msg).toContain('PORT must be');
    expect(msg).toContain('LIVE_LOUDNORM must be 0 or 1');
    expect(msg).not.toMatch(/SECRET-VALUE|prod"/);
  });

  it('refuses a database or bucket from the other environment (the sweep would delete its originals)', () => {
    expect(() => loadConfig({ ...valid, R2_BUCKET: 'almahajja-media' })).toThrow('R2_BUCKET is not the stg bucket');
    expect(() => loadConfig({ ...valid, SUPABASE_URL: 'https://prpyxnxgkpspjoxvcaro.supabase.co' })).toThrow(
      'SUPABASE_URL is not the stg project',
    );
    expect(() => loadConfig({ ...valid, WORKER_ENV: 'prd' })).toThrow(/SUPABASE_URL is not the prd project/);
    expect(
      loadConfig({ ...valid, WORKER_ENV: 'prd', SUPABASE_URL: 'https://prpyxnxgkpspjoxvcaro.supabase.co', R2_BUCKET: 'almahajja-media' })
        .workerEnv,
    ).toBe('prd');
  });
});
