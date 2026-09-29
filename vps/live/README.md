# `/opt/almahajja-live` — live audio infrastructure (V23)

LiveKit SFU + Egress (recording) + Redis, on the shared VPS `161.97.135.4`.
See `PLAN_LIVE_V23.md` §3. This folder is the source of truth for the non-secret files; the
VPS copy must match it.

## Isolation rules (the VPS is shared with LIMS and dafaalla.dev)
- Everything lives in `/opt/almahajja-live`, compose project `almahajja-live`, network
  `almahajja_net` (external, owned by `/opt/almahajja-admin`).
- Service names are project-unique (`almahajja-*`), never `web`/`api`/`redis`.
- Never touch `/opt/lims`, `lims-proxy-1`, `lims-certbot-1`, `cpanel_net`, `lims_lims`, or UFW.
- Before and after any change: `app.geo-lims.com`, `crm.dafaalla.dev`, `dafaalla.dev` → 200.

## Services
| Container | Image | Notes |
|---|---|---|
| `almahajja-livekit` | `livekit/livekit-server:v1.13.7` | signaling :7880 internal only; media ports published; 2 CPU / 1280 MB |
| `almahajja-lk-redis` | `redis:7.4.11-alpine` | LiveKit ⇄ Egress bus, no persistence |
| `almahajja-egress` | `livekit/egress:v1.14.1` | audio-only room-composite recordings → R2 `live-raw/`; 1 CPU |
| `almahajja-media-worker-stg` | P0: `node:22.23.3-alpine` webhook logger · P1+: `vps/media-worker` | staging worker |

## Network
| Host / port | How |
|---|---|
| `live.almahajja.app` | Cloudflare Tunnel `almahajja-admin` ingress → `http://almahajja-livekit:7880` (WebSocket signaling + Twirp API) |
| 7882/udp | single-port UDP mux for all media |
| 7881/tcp | ICE/TCP fallback for UDP-blocked networks |

Docker-published ports bypass UFW by design; do not edit UFW.

## Secrets (VPS only, mode 600, never committed)
| File | Contents |
|---|---|
| `secrets/livekit-keys.yaml` | `almahajja_prd: …`, `almahajja_stg: …`, `almahajja_int: …` (one per line) |
| `egress.yaml` | from `egress.example.yaml` + the `almahajja_int` secret; owned by uid 1001 (egress user) |

Key usage: `almahajja_prd` → production edge functions (rooms `prd_*`), `almahajja_stg` → staging
edge functions (rooms `stg_*`), `almahajja_int` → egress + webhook signing, never leaves the VPS.
Local copies: `LIVEKIT_*` in `.env` (prod + internal) and `.env.staging.local` (staging).

## No TURN (by design)
LiveKit's embedded TURN cannot relay to the SFU inside a Docker bridge network (the hairpin reaches
TURN from the bridge gateway, not from the permitted peer IP, and is dropped). ICE/TCP on 7881 is the
fallback for UDP-blocked networks. If a 443-only network ever matters, configure an external TURN
(e.g. Cloudflare TURN) under `rtc.turn_servers` — don't move LiveKit to host networking on this VPS.

## Live recordings are never lost (PLAN §1.1 #12)
Egress writes every raw recording to this disk first: `recordings/<env>/<room>-<time>.ogg`
(`recordings/` is `1001:1000`, mode `2775`, so files belong to egress and group 1000 = the worker's
`node` user). Each worker mounts only its own env folder at the same path (`RECORDINGS_DIR`). The worker
compresses the raw, uploads the MP3 and a raw backup (`live-raw/`) to R2, and deletes the local raw only
after the lecture is published + 7 days and the R2 backup is verified. Staff can download a raw through
the worker's `/recordings/:sessionId` endpoint (staff JWT). ~30 MB per hour at 64 kbps Opus.

## CPU / memory budget
Our containers run with `cpu_shares` below the default so LIMS wins under contention. During a live:
LiveKit ≤ 2 cores + Egress ≤ 1 core; the media worker defers transcodes while an egress is active,
so at least one core always stays free for LIMS.

## Deploy / update
```sh
tar -C vps/live -cf - docker-compose.yml livekit.yaml | ssh root@161.97.135.4 'tar -C /opt/almahajja-live -xf -'
ssh root@161.97.135.4 'cd /opt/almahajja-live && docker compose up -d'
```
Logs: `docker logs almahajja-livekit` (also `-egress`, `-media-worker-stg`).

## P7 (2026-09-29): recordings survive an egress crash

- Egress wipes its tmp dir (`/home/egress/tmp`) every time it starts. The dir is
  now on the host (`recordings/egress-tmp`, owner 1001:1000, 2775), and
  `almahajja-egress-guard` (alpine, `network_mode: none`) hard-links every
  in-progress `EG_*/…ogg` into `recordings/egress-guard/` every 2 s — the same
  inode keeps growing with the recording and survives the wipe. Links older than
  24 h are dropped. Script: `egress-guard.sh`.
- Both media workers mount `recordings/egress-guard` at `/egress-tmp`
  (`EGRESS_TMP_DIR`) and reach LiveKit at `LIVEKIT_API_URL`; their
  recordingGuard recovers the partial, calls live-control `resume_recording`
  and concatenates the parts (0146).
- Drill (staging): SIGKILL on the egress process mid-session → Docker restarted
  it (tmp wiped) → partial recovered from the guard, recording resumed ~60 s
  later, one 170 s lecture from 2 parts.
- LiveKit capacity raised to 3 cores / 2 GiB (load test: 300 listeners × 4
  speakers hit the 2-core cap).
