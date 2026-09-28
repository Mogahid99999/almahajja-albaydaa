// Entry point: validate env → wire real deps → HTTP server + claim loop.
// SIGTERM/SIGINT: stop claiming, kill ffmpeg, leave the job for re-claim, exit.

import { WebhookReceiver } from 'livekit-server-sdk';
import { ConfigError, loadConfig } from './config.js';
import { createSupabaseDb } from './db.js';
import { EgressTracker } from './egressTracker.js';
import { runJob } from './jobRunner.js';
import { consoleLogger as log, errorMessage } from './log.js';
import { createFfmpegTools } from './media.js';
import { OrphanSweeper, sweepIncomingOrphans } from './orphanSweep.js';
import { createHttpServer } from './server.js';
import { createR2Storage } from './storage.js';
import { handleWebhook } from './webhooks.js';
import { Worker } from './worker.js';

function main(): void {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    // Names only — ConfigError never contains values.
    console.error(err instanceof ConfigError ? err.message : `config error: ${errorMessage(err)}`);
    process.exit(1);
  }

  const db = createSupabaseDb(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  const storage = createR2Storage({
    endpoint: cfg.r2Endpoint,
    bucket: cfg.r2Bucket,
    accessKeyId: cfg.r2AccessKeyId,
    secretAccessKey: cfg.r2SecretAccessKey,
  });
  const media = createFfmpegTools();
  const egress = new EgressTracker();

  const worker = new Worker({
    db,
    egress,
    log,
    runJob: (job, signal) =>
      runJob(job, { db, storage, media, tmpDir: cfg.tmpDir, liveLoudnorm: cfg.liveLoudnorm, log }, signal),
  });

  const sweeper = new OrphanSweeper((signal) => sweepIncomingOrphans({ storage, db, signal }), { log });

  const verifier = new WebhookReceiver(cfg.livekitWebhookKey, cfg.livekitWebhookSecret);
  const server = createHttpServer({
    health: () => ({ ok: worker.healthy, env: cfg.workerEnv, busy: worker.busy, egressActive: worker.egressActive }),
    onWebhook: (raw, auth) =>
      handleWebhook({ verifier, env: cfg.workerEnv, egress, db, kick: () => worker.kick(), log }, raw, auth),
  });

  server.listen(cfg.port, () => {
    log('info', 'worker.started', { env: cfg.workerEnv, port: cfg.port, loudnorm: cfg.liveLoudnorm });
    worker.start();
    sweeper.start();
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'worker.stopping', { signal });
    const force = setTimeout(() => {
      log('error', 'worker.force_exit');
      process.exit(1);
    }, 20_000);
    force.unref();
    Promise.all([worker.stop(), sweeper.stop()])
      .catch((err: unknown) => log('error', 'worker.stop_error', { error: errorMessage(err, 200) }))
      .finally(() => {
        server.close(() => {
          log('info', 'worker.stopped');
          process.exit(0);
        });
        server.closeAllConnections?.();
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log('error', 'unhandled_rejection', { error: errorMessage(err, 300) }));
}

main();
