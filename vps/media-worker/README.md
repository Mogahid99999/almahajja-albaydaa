# almahajja-media-worker

Server-side media worker for المَحجّة البَيْضَاء (PLAN_LIVE_V23 §6). One container
per environment (`stg`, `prd`) on the VPS network `almahajja_net`; no public port
(`/recordings` gets a tunnel hostname in P6).

**Owner rule: a live recording must never be lost.** Amended 2026-09-28: the LOCAL raw is
deleted automatically as soon as its R2 upload is confirmed (same size, by ranged
GetObject); the R2 backup `live-raw/<basename>` is kept forever (never deleted by the worker).

## Jobs

- Claims `media_jobs` from Supabase (`claim_media_job(p_kinds)`, service role) every 5 s
  and right after a LiveKit webhook. **One job at a time.**
- ffprobe → `nice -n 10 ffmpeg … -vn -codec:a libmp3lame -q:a 9 -ac 1 -ar 22050` (the
  speech profile used since V13) → progress via `touch_media_job` (≤ 1 write/s + a 30 s
  heartbeat; server-side `now()`) → MP3 uploaded with a multipart `Upload` → completion RPC.
- **lecture_transcode**: downloads the `incoming/…` original; output key =
  `uniqueLectureKey(sectionTitle, lectureTitle, 'mp3')` — the exact key an in-browser
  upload gets (`src/shared/lectureKey.ts`, a generated copy of
  `supabase/functions/_shared/lectureKey.ts`). `complete_lecture_transcode` (may also
  publish when the job has `publish_on_done`), then the original is deleted. Inputs
  outside `incoming/` are never deleted.
- **live_recording** (P2): `input_key` is the LOCAL raw `/recordings/<env>/<room>-<time>.ogg`,
  read **in place** (never downloaded) and only if it resolves to a regular file inside
  `RECORDINGS_DIR` (`..`, other-env and symlink escapes refused).
  1. ffprobe + ffmpeg (`-af loudnorm=I=-18:TP=-2` when `LIVE_LOUDNORM=1`)
  2. name via `live_job_naming(p_job)` → `uniqueLectureKey(section_title, title, 'mp3')`
  3. upload the MP3
  4. back the raw up to R2 `live-raw/<basename>` (skipped when an object of the same
     size is already there; re-uploaded when the size differs)
  5. `create_live_lecture(p_job, p_output_key, p_duration_sec, p_size_bytes, p_raw_backup_key)`
  6. right after `create_live_lecture` succeeds: verify the R2 backup's size equals the
     local file's and that the MP3 key exists in R2 → delete the local raw +
     `mark_live_raw_deleted(p_session)` (session = the job's `live_session_id`). Any
     doubt → keep the file and log `raw.keep reason=…` (the sweep retries). A delete or
     mark failure never fails the job. On a job failure the raw stays (`fail_media_job`).
- Any error → `fail_media_job(job, message)` → `retry` | `failed` (terminal; RPC notifies
  staff) | `ignored` (job was no longer running; logged). Temp files are always removed.
- `touch_media_job` → `false`: the job is no longer ours → abort cleanly (no fail, no
  commit; an uploaded-but-uncommitted MP3 is removed; a raw backup is kept).
- SIGTERM → ffmpeg is killed, the job is left `running` for re-claim (> 2 min stale heartbeat).
- Watchdog: a job running > 3 h is aborted and failed (the heartbeat would otherwise keep
  a wedged job alive forever). R2 sockets idle > 120 s and PostgREST calls > 30 s error out.
- **live_recording in parts** (0146 `live_recording_parts`, one row per egress): when a
  session has parts, every part with a file (`complete` / `recovered`, seq order) is read
  in place and joined by ffmpeg's `concat` filter (a crashed egress's partial `.ogg` has no
  EOS page — ffmpeg decodes it to its last complete page; a part ffprobe cannot even open
  is skipped only when ≤ 256 KB, otherwise ffmpeg gets it and fails loudly). EACH part is
  backed up to `live-raw/<its basename>` and stamped (`mark_live_part_backed_up`) before
  `create_live_lecture` (which records the first part's key on the session); each local
  raw is then released on its own verified backup (`mark_live_part_raw_deleted`, which
  stamps the session with the last part). A job never runs while a part is still
  `recording`/`dead`. One part = the single-input ffmpeg call exactly as before.
- While a LiveKit egress is recording for this env, only `live_recording` jobs are claimed
  (`{p_kinds:['live_recording']}`); lecture transcodes wait (max 3 h per egress). Otherwise
  `{}` = all kinds.

## Background tasks (one log line of counts per run)

- **Orphan sweep** of R2 `incoming/` (~2 min after start, then every 6 h): objects older
  than 48 h are deleted only when **no job references them** or **every referencing job
  is `done`**; kept if any is queued/running/failed. A lookup error aborts before deleting.
- **Live-raw retention** — safety net for the job's own deletion (once ~15 s after start,
  then every 30 min): for each `live_raws_due_for_deletion()` row (listed as soon as the
  lecture exists), the local raw is deleted **only** after a ranged GetObject proves the
  R2 backup exists with exactly the local file's size; then `mark_live_raw_deleted`.
  Anything else is kept and logged. If the local file is already gone but the backup
  exists, the row is just stamped. Paths outside `RECORDINGS_DIR` are refused.
  Sessions with parts are listed part by part (`live_part_raws_due_for_deletion()`, only
  once EVERY part of the session has its backup recorded) and stamped per part.
- **Recording guard** (0146; every 20 s, and 3–15 s after a relevant webhook; logs only
  runs that did something): an egress that dies mid-session must not lose the rest of the
  session nor its partial file. For every `recording` part of `live_recording_watch()`:
  dead = `egress_ended` FAILED/ABORTED, LiveKit ListEgress FAILED/ABORTED or unknown
  (> 2 min old), session ended ≥ 10 min ago, or (live) its recorder participant (identity
  = egress id) has been missing from the room / the room gone for ≥ 15 s — only once it was
  seen listed, and only while the tmp file is quiet ≥ 45 s — or, without LiveKit evidence,
  a tmp file idle ≥ 10 min. A recorder still in the room is never killed by silence.
  ListEgress COMPLETE = a lost clean-end webhook → replayed (`enqueue_live_recording`).
  Dead → `register_live_recording_part(dead)` → if still live, live-control
  `resume_recording` (new egress, same settings; 60 s backoff, stops after 3 `lost` parts
  in a row, cap 50) → recover: the egress's own output in `RECORDINGS_DIR`, else its
  partial in `EGRESS_TMP_DIR/<EG_id>/` (only `<own-env room>-….ogg`; copied as
  `<name>-recovered[-n].ogg`, fsynced, verified unchanged + same size, then the source
  removed), else one unreferenced final file of that room when unambiguous → `recovered`;
  nothing → `lost` (the RPC then fails the session with an Arabic error on the admin page
  + staff inbox notice). An `ended` session still without a job 10 min after its end and
  with nothing open → `settle_live_recording` (never silently `ended`).

## HTTP (internal)

| Route | |
|---|---|
| `GET /health` | `200 {ok, env, busy, egressActive}` (503 when shutting down / loop stalled) — Docker `HEALTHCHECK` |
| `POST /lk` | LiveKit webhooks, verified with `WebhookReceiver` (JWT + sha256 of the raw body) → 401 on bad signature. Rooms not prefixed `${WORKER_ENV}_` are ignored. |
| `GET /recordings/:sessionId` | Staff download of a session's raw. `Authorization: Bearer <user JWT>` → `auth.getUser` + `profiles.role ∈ {admin, publisher}` (401 / 403; auth runs before any lookup). One lookup reads `live_sessions.raw_path` + `raw_backup_key`. Local file present (must resolve inside `RECORDINGS_DIR`) → streamed with `Content-Disposition: attachment`, `Content-Length`, single `Range` (206/416), `HEAD`. Local file gone but backup set (`live-raw/…` only) → **302** to a 10-minute presigned R2 GET with `response-content-disposition=attachment`. Otherwise 404 (paths never echoed). CORS preflight for the admin web. |

### Webhooks

- `egress_started` / `egress_updated` / `egress_ended` drive the transcode deferral.
- `egress_ended` with `EGRESS_COMPLETE` or `EGRESS_LIMIT_REACHED` (a partial recording is
  still a lesson) and an `.ogg` output (`fileResults[].filename` = local path; `.json`
  manifests ignored) → `enqueue_live_recording(p_room_name, p_egress_id, p_raw_path)` —
  **only** if the file exists under `RECORDINGS_DIR` (missing → 500 so LiveKit may
  redeliver; outside → refused). `EGRESS_FAILED` / `ABORTED` are logged only.
- `room_started`, `room_finished`, `participant_joined/left`, `track_published/unpublished`
  → `live_room_event(p_room_name, p_event, p_identity, p_num_participants)` →
  `{session_id, status, is_host, host_present}`.
- **D4**: host leaves a `live` session and no host device remains → 10-minute timer per
  session (cancelled when `host_present` turns true or the session is no longer live); on
  expiry `POST ${SUPABASE_URL}/functions/v1/live-control` (service-role bearer)
  `{action:'auto_end', sessionId, reason:'host_absent'}`. `room_finished` for a session
  still `live` → the same with `reason:'room_finished'`. Timers are in memory.

## Environment

| Var | |
|---|---|
| `WORKER_ENV` | `stg` \| `prd` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | project for this env (pinned per env — see `ENV_PAIRS` in `src/config.ts`) |
| `R2_ENDPOINT` (https), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | bucket pinned per env |
| `LIVEKIT_WEBHOOK_KEY`, `LIVEKIT_WEBHOOK_SECRET` | the webhook signing pair — key id `almahajja_int`, the same for both workers |
| `RECORDINGS_DIR` | this env's live raws, `/recordings/stg` or `/recordings/prd` (must be named after `WORKER_ENV`); the mount must exist at startup, and be writable by uid 1000 (the worker deletes confirmed raws) |
| `PORT` | default `8080` |
| `LIVE_LOUDNORM` | `0` (default) / `1` — `loudnorm=I=-18:TP=-2` on live recordings only |
| `TMP_DIR` | default `/tmp/media-worker` |
| `EGRESS_TMP_DIR` | default `/egress-tmp`: the egress container's `/home/egress/tmp` (in-progress files of BOTH envs), mounted read-write; only files named after this env's rooms are ever touched. Missing → logged (`egress_tmp.unavailable`), partials cannot be recovered |
| `LIVEKIT_API_URL` | optional, internal (e.g. `http://almahajja-livekit:7880`): ListEgress / ListParticipants / ListRooms for the recording guard. Unset → webhooks + tmp-file checks only (slower detection) |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | optional pair for `LIVEKIT_API_URL`; default = the webhook pair (`almahajja_int`, internal only) |

Startup validates everything and exits 1 listing the variable **names** that are wrong,
and exits 1 when `RECORDINGS_DIR` is not a readable directory.

## Develop

```sh
npm install
npm test              # vitest, fully offline (fakes for Supabase/R2/ffmpeg; real temp dirs)
npm run typecheck
npm run sync-shared   # after editing supabase/functions/_shared/lectureKey.ts
docker build --target test vps/media-worker   # the suite on Linux (file-symlink cases too)
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

Runs as the non-root `node` user (uid 1000); logs one line per event/job to stdout
(`docker logs almahajja-media-worker`).

## Known limitations

- Egress and D4 timer state is in memory: after a restart mid-session, deferral re-arms on
  the next `egress_updated`/`egress_started`, and the host-absence timer on the next
  room event (or `room_finished`).
- If `complete_lecture_transcode` / `create_live_lecture` fails after the upload, the
  uploaded MP3 is left in R2 (deleting it is unsafe when the commit's response was merely
  lost); the retry uses the next free ` (n)` name.
- A SIGTERM during an in-flight Supabase call waits for it (≤ 30 s) before exiting.
- Recording guard: the audio between an egress crash and the new egress (≈ 40–80 s with the
  LiveKit API, up to ~10 min without it) is not recorded; a `recovered` copy superseded by
  a late clean end stays on disk unreferenced (logged). Staff download
  (`GET /recordings/:sessionId`) serves the session's FIRST part only.
