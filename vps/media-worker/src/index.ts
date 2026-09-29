// Entry point: validate env → wire real deps → HTTP server + claim loop +
// background tasks (orphan sweep, live-raw retention, recording guard).
// SIGTERM/SIGINT: stop claiming, kill ffmpeg, leave the job for re-claim, exit.

import { WebhookReceiver } from 'livekit-server-sdk';
import { ConfigError, loadConfig } from './config.js';
import { createSupabaseDb } from './db.js';
import { EgressTmpDir } from './egressRecovery.js';
import { EgressTracker } from './egressTracker.js';
import { HostAbsenceWatch } from './hostWatch.js';
import { runJob } from './jobRunner.js';
import { createLiveControl } from './liveControl.js';
import { createLiveKitProbe, UNCONFIGURED_PROBE } from './livekitProbe.js';
import { consoleLogger as log, errorMessage } from './log.js';
import { createFfmpegTools } from './media.js';
import { OrphanSweeper, sweepIncomingOrphans } from './orphanSweep.js';
import { RawRetention, sweepLiveRaws } from './rawRetention.js';
import { RecordingGuard } from './recordingGuard.js';
import { handleRecordingDownload } from './recordingDownload.js';
import { inspectRecordingsDir, RecordingsDir } from './recordings.js';
import { createHttpServer } from './server.js';
import { createR2Storage } from './storage.js';
import { handleWebhook } from './webhooks.js';
import { Worker } from './worker.js';

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    // Names only — ConfigError never contains values.
    console.error(err instanceof ConfigError ? err.message : `config error: ${errorMessage(err)}`);
    process.exit(1);
  }

  // The recordings mount is part of the deployment contract: refuse to start
  // without it (a live raw we cannot see is a raw we cannot protect).
  const dirState = await inspectRecordingsDir(cfg.recordingsDir);
  if (!dirState.exists) {
    console.error('RECORDINGS_DIR is not a readable directory (check the volume mount)');
    process.exit(1);
  }
  if (!dirState.writable) {
    log('warn', 'recordings.not_writable', { note: 'retention cannot delete local raws until fixed' });
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
  const recordings = new RecordingsDir(cfg.recordingsDir);
  const liveControl = createLiveControl(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
  const hostWatch = new HostAbsenceWatch(liveControl, { log });

  // 0146: egress crash recovery. The egress tmp dir (both envs' in-progress
  // files) is part of the deployment contract, but a missing mount must not
  // stop lecture transcodes — it is logged loudly instead (and on every
  // recovery attempt that needs it).
  const egressTmp = new EgressTmpDir(cfg.egressTmpDir, cfg.workerEnv);
  if (!(await egressTmp.available())) {
    log('error', 'egress_tmp.unavailable', { note: 'EGRESS_TMP_DIR is not mounted: crashed-egress partials cannot be recovered' });
  }
  if (!cfg.livekitApiUrl) {
    log('warn', 'livekit_api.unconfigured', { note: 'LIVEKIT_API_URL unset: egress liveness from webhooks + tmp files only' });
  }
  const guard = new RecordingGuard(
    {
      env: cfg.workerEnv,
      db,
      probe: cfg.livekitApiUrl
        ? createLiveKitProbe(cfg.livekitApiUrl, cfg.livekitApiKey, cfg.livekitApiSecret)
        : UNCONFIGURED_PROBE,
      control: liveControl,
      recordings,
      tmp: egressTmp,
      egress,
      log,
    },
  );

  const worker = new Worker({
    db,
    egress,
    log,
    runJob: (job, signal) =>
      runJob(
        job,
        { db, storage, media, recordings, tmpDir: cfg.tmpDir, liveLoudnorm: cfg.liveLoudnorm, log },
        signal,
      ),
  });

  const sweeper = new OrphanSweeper((signal) => sweepIncomingOrphans({ storage, db, signal }), { log });
  const retention = new RawRetention((signal) => sweepLiveRaws({ db, storage, recordings, log, signal }), { log });

  const verifier = new WebhookReceiver(cfg.livekitWebhookKey, cfg.livekitWebhookSecret);
  const server = createHttpServer({
    health: () => ({ ok: worker.healthy, env: cfg.workerEnv, busy: worker.busy, egressActive: worker.egressActive }),
    onWebhook: (raw, auth) =>
      handleWebhook(
        { verifier, env: cfg.workerEnv, egress, db, recordings, hostWatch, guard, kick: () => worker.kick(), log },
        raw,
        auth,
      ),
    onRecording: (req, res, sessionId) => handleRecordingDownload(req, res, sessionId, { db, recordings, storage, log }),
  });

  server.listen(cfg.port, () => {
    log('info', 'worker.started', { env: cfg.workerEnv, port: cfg.port, loudnorm: cfg.liveLoudnorm });
    worker.start();
    sweeper.start();
    retention.start();
    guard.start();
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
    hostWatch.stop();
    Promise.all([worker.stop(), sweeper.stop(), retention.stop(), guard.stop()])
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

main().catch((err: unknown) => {
  console.error(`fatal: ${errorMessage(err)}`);
  process.exit(1);
});
