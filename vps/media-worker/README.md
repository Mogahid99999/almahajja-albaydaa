# almahajja-media-worker

Server-side media worker for المَحجّة البَيْضَاء (PLAN_LIVE_V23 §6). One container
per environment (`stg`, `prd`) on the VPS network `almahajja_net`; no public port.

- Claims `media_jobs` from Supabase (`claim_media_job(p_kinds)`, service role) every 5 s
  and right after a LiveKit webhook. **One job at a time.**
- Streams the input from R2 to a temp file, `ffprobe`s the duration, transcodes with
  `nice -n 10 ffmpeg … -vn -codec:a libmp3lame -q:a 9 -ac 1 -ar 22050` (the speech
  profile used since V13), writes progress via `touch_media_job` (≤ 1 write/s + a 30 s
  heartbeat; server-side `now()`), uploads the MP3 with a multipart `Upload`, then calls
  the completion RPC (which may also publish the lecture when the job has
  `publish_on_done`).
- **lecture_transcode**: output key = `uniqueLectureKey(sectionTitle, lectureTitle, 'mp3')`
  — the exact key an in-browser upload gets (`src/shared/lectureKey.ts`, a generated copy
  of `supabase/functions/_shared/lectureKey.ts`). After `complete_lecture_transcode` the
  `incoming/…` original is deleted. Inputs outside `incoming/` are never deleted.
- **live_recording** *(P2 — RPC pending)*: MP3 to `lectures/_live/<raw name>.mp3`, then
  `create_live_lecture(...)`. The `live-raw/` original is kept (D5 retention).
- Any error → `fail_media_job(job, message)` → `retry` | `failed` (terminal; RPC notifies
  staff) | `ignored` (job was no longer running; logged). The input is never deleted on
  failure. Temp files are always removed.
- If `touch_media_job` returns `false` the job is no longer ours: the run aborts cleanly
  (no fail RPC, no commit; an already-uploaded, uncommitted MP3 is removed).
- SIGTERM → ffmpeg is killed, the job is left `running`; `claim_media_job()` re-claims it
  once its heartbeat is > 2 min old.
- Watchdog: a job running > 3 h is aborted and failed (the heartbeat would otherwise keep
  a wedged job alive forever). R2 sockets idle > 120 s and PostgREST calls > 30 s error out.
- While a LiveKit egress is recording for this env, only `live_recording` jobs are claimed
  (`{p_kinds:['live_recording']}`); lecture transcodes wait (max 3 h per egress, so a lost
  `egress_ended` can't block them forever). Otherwise `{}` = all kinds.
- **Orphan sweep** of `incoming/`: once ~2 min after start, then every 6 h. Lists objects
  older than 48 h (ListObjectsV2, paginated), looks each batch of keys up in
  `media_jobs.input_key` and deletes an object only when **no job references it**
  (abandoned upload) or **every referencing job is `done`** (the MP3 already exists).
  If any referencing job is queued, running or failed (failed jobs keep their original
  for a retry) it is kept; a lookup error aborts before deleting. Logs counts only
  (`sweep.done scanned= old= referenced= deleted= done_only= …`).

## HTTP (internal)

| Route | |
|---|---|
| `GET /health` | `200 {ok, env, busy, egressActive}` (503 when shutting down / loop stalled) — Docker `HEALTHCHECK` |
| `POST /lk` | LiveKit webhooks, verified with `WebhookReceiver` (JWT + sha256 of the raw body) → 401 on bad signature. Rooms not prefixed `${WORKER_ENV}_` are ignored. |

Handled events: `egress_started` / `egress_updated` / `egress_ended` (deferral +
`enqueue_live_recording(room, egress_id, raw_key)` — *P2, RPC pending*), `room_finished`
(clears deferral). `room_started`, `participant_*`, `track_*` are logged only (P2).

`egress_ended` is enqueued only when `status` is `EGRESS_COMPLETE` or
`EGRESS_LIMIT_REACHED` (a partial recording is still a lesson) **and** an output key ends
in `.ogg` (`fileResults[].filename` is the R2 key, e.g.
`live-raw/stg_p0_rec-2026-09-28T164931.ogg` — confirmed on the live server). Manifests
(`live-raw/<egressId>.json`) are ignored. `EGRESS_FAILED` / `ABORTED` are logged only;
the raw file is kept.

## Environment

| Var | |
|---|---|
| `WORKER_ENV` | `stg` \| `prd` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | project for this env |
| `R2_ENDPOINT` (https), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | |
| `LIVEKIT_WEBHOOK_KEY`, `LIVEKIT_WEBHOOK_SECRET` | the webhook signing pair — key id `almahajja_int`, the same for both workers (LiveKit signs all webhooks with one key) |
| `PORT` | default `8080` |
| `LIVE_LOUDNORM` | `0` (default) / `1` — `loudnorm=I=-18:TP=-2` on live recordings only |
| `TMP_DIR` | default `/tmp/media-worker` |

Startup validates everything and exits 1 listing the variable **names** that are wrong.

## Develop

```sh
npm install
npm test              # vitest, fully offline (fakes for Supabase/R2/ffmpeg)
npm run typecheck
npm run sync-shared   # after editing supabase/functions/_shared/lectureKey.ts
```

Never edit `src/shared/lectureKey.ts`; `test/lectureKey.test.ts` fails if it drifts.

## Docker

```sh
docker build -t almahajja-media-worker:dev vps/media-worker
# offline smoke test of the real ffmpeg path (no Supabase/R2):
docker run --rm --network none --entrypoint sh almahajja-media-worker:dev -c \
  'ffmpeg -v error -f lavfi -i sine=frequency=440:duration=30 -ac 2 -ar 48000 /tmp/tone.wav &&
   node dist/cli/transcode-local.js /tmp/tone.wav /tmp/out.mp3 &&
   ffprobe -v error -show_entries stream=codec_name,channels,sample_rate -of default=nw=1 /tmp/out.mp3'
```

Runs as the non-root `node` user; logs one line per event/job to stdout
(`docker logs almahajja-media-worker`).

## Known limitations

- Egress state is in memory: after a restart mid-session, deferral re-arms on the next
  `egress_updated`/`egress_started` only.
- If `complete_lecture_transcode` fails after the upload, the uploaded MP3 is left in R2
  (deleting it is unsafe when the commit's response was merely lost); the retry uses the
  next free ` (n)` name.
