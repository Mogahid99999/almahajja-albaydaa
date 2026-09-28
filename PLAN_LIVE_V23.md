# V23 — «البث المباشر» (Live Audio) + Server-Side Media Worker

> Implementation plan for audio-only live sessions inside the app, replacing the Telegram voice chats,
> plus moving lecture audio compression from the admin's browser to our VPS.
> Approved design (interactive prototype): https://claude.ai/artifact/CwVkmMUvxLN6xMpVmUM7GW
> (origins: A https://claude.ai/artifact/CzkNySvjWmgCyjjfAcrCDL · B https://claude.ai/artifact/W2n2NycXJD34bHRvwRThTD · C https://claude.ai/artifact/9kp1y2DQW8eqwU2nhKAXWh)
> User-facing copy stays in Arabic (it ships to users); everything else is English.
> Tone: calm and scholarly. No hearts, gifts, reactions, gamification or social-live clutter.

> **⚠️ HARD RULE 1 — RTL EVERYWHERE.** Every new screen, sheet, row, icon and animation is right-to-left
> (forced-RTL conventions of this app: `row` not `row-reverse`, back chevron on the right, `Txt` for all text).
> Anything that only looks right in LTR is a defect.

> **⚠️ HARD RULE 2 — THE VPS IS SHARED; AL-MAHAJJAH STAYS ISOLATED.** 161.97.135.4 also runs LIMS
> (`lims-proxy-1` owns host ports 80/443, `lims-certbot-1`, `lims_lims`) and the dafaalla.dev sites (`cpanel_net`).
> Never edit `/opt/lims/**`, never use the LIMS proxy or certbot, never join `cpanel_net`/`lims_lims`,
> never name a compose service `web`/`api`/`redis` (Docker DNS aliases collide — this caused a 502 on
> app.geo-lims.com on 2026-09-28). Everything of ours lives under `/opt/almahajja-*`, on `almahajja_net`,
> reaches the internet through our own Cloudflare Tunnel, and publishes only the UDP/TCP media ports listed in §3.

---

## 0. Executive summary

| Already built (reuse, do not rebuild) | Genuinely new |
|---|---|
| Roles + helpers: `is_admin`, `is_sheikh`, `is_content_manager`, `is_staff_viewer`, `is_guest`, `is_moderator` | LiveKit server + Egress + Redis on the VPS (`/opt/almahajja-live`) |
| Anonymous guest sessions; deferred gender prompt `GenderPrompt` → `profiles.gender` | Media worker (ffmpeg) for **lecture uploads** and **live recordings** |
| Sections tree, lectures (`lecture_status` = draft/published; «واردة» = `section_id is null`) | `live_sessions`, `live_participants`, `media_jobs`, `live_buddy_invites`, `live_reminders` |
| Admin «المحاضرات الواردة» (`app/admin/unclassified.tsx`, `getUnclassifiedLectures`) | Edge functions `live-token`, `live-control`; `r2-upload-url` kind `lecture_raw` |
| R2 via signed URLs (`r2-upload-url`/`r2-read-url`/`r2-delete`), bucket CORS `*` | Room UI «الحلقة» (hijab ring, niqab icons, star medallion, ripples) |
| Push pipeline: async fan-out queue (0129) + paced `push_queue` (0131), `notify-on-publish` | Notification types `live_start`, `live_reminder`, `live_invite` + prefs |
| Buddies (`buddy_requests` accepted = pair, max 3, gender-segregated) + «تشجيع رفيقك» pattern | Buddy invite to a live (fixed phrase, once per buddy per session) |
| Player store + `MiniPlayer`, patched expo-audio lock-screen controls, background audio | `liveStore` + live mini-bar; WebRTC audio session coexisting with expo-audio |
| Admin web live at https://admin.almahajja.app (tunnel `almahajja-admin`) | Share links + Android App Links / iOS Universal Links + store fallback page |
| Client-side ffmpeg.wasm compression (`src/lib/audioTranscode.web.ts`, `public/ffmpeg/`) | **Replaced** by the server worker (kept behind a flag until verified, then removed) |

Governing architecture (CLAUDE.md) still applies: all data access through `src/api/*`; hooks wrap the API;
student reads only see what RLS allows; migrations are append-only; run `node scripts/security-check.mjs`
after any migration touching RLS/functions.

---

## 1. Decisions

### 1.1 Locked by the owner (2026-09-28)

1. **Home** shows a live exactly like prototype A: a teal «مباشر الآن» feature card **in the slot of «أكمِل الاستماع»** while live; an «المجلس المباشر القادم» card for scheduled sessions.
2. **Room** is prototype B's «الحلقة»: sheikh in the centre (8-point star medallion), brothers in rings around him, a **circular hijab (mashrabiya lattice ring)**, sisters outside it. Every attendee is an icon: brothers = youth icon, sisters = **full niqab, only the eyes visible**.
3. **Sisters choose on entry**: with their name, or hidden → shown as «طالبة», still counted. Choice is remembered and changeable from «في الحلقة».
4. **Sessions start from the section page** (sheikh/admin/publisher). The recording lands **already placed in that section** (next order), unpublished, and only needs **final title + sheikh** in the admin.
5. **Anyone can request to speak** — brothers, sisters, registered users and guests.
6. Once approved, a speaker **opens/closes their own mic freely**. A moderator's mute is temporary (speaker may reopen). Moderators can **return a speaker to listener**; to speak again they must request again.
7. **Live-start push to everyone** (respecting a new per-user toggle «بث مباشر»).
8. **Buddy invite**: a student can invite their buddy (push that opens the room).
9. **Shareable link** on social apps: opens the room if the app is installed, otherwise routes to Google Play / App Store.
10. **Lecture compression moves to the VPS** (media worker); the admin uploads the original.
11. Audio only. No video, no camera, no chat.
12. **A live recording is never lost** (owner, 2026-09-28). Egress writes the raw file to the VPS disk
    (`/opt/almahajja-live/recordings/<env>/`, mounted into egress and the worker), not straight to R2.
    The worker transcodes from that local file, uploads the MP3 **and** a backup copy of the raw to R2
    `live-raw/`, and deletes the local raw only after the lecture is **published** and 7 days have passed
    (supersedes D5's "7 days after the lecture is created"). On any failure the raw stays on the VPS and the
    admin can **download it** or **retry** from the admin «البث المباشر» page (worker endpoint behind our
    tunnel, staff JWT required).

### 1.2 Open — confirm before the phase that needs them

| # | Question | Default we build unless told otherwise | Needed by |
|---|---|---|---|
| D1 | «ارجاعه لمستمع بواسطة أي أدمن أو متحدث» — can a *speaker* demote *another* speaker? | No. Moderators (admin/sheikh/publisher) demote; a speaker can step down himself. | P4 |
| D2 | Can moderators see the real name of a sister who chose «بدون اسم»? | No, same as anonymous Q&A (V14). The DB keeps `user_id` for abuse handling only. | P3 |
| D3 | Max concurrent live sessions | 1 (VPS budget, §3.6) | P2 |
| D4 | Host disconnects: auto-end after how long? | 10 minutes of no host, then end + record as normal | P4 |
| D5 | Keep the raw recording after processing? | Delete raw 7 days after the lecture is created | P2 |
| D6 | Does `live_start` push respect quiet hours (23:00–05:00)? | Yes (skip push, still in inbox) | P5 |
| D7 | Can admins/publishers host from the **web** admin too? | Later (P6+); v1 hosts from the mobile app | P6 |
| D8 | Share-link host: `almahajja.app/live/<code>` or `go.almahajja.app/live/<code>`? | `go.almahajja.app` — fully in our stack (§9.3); apex only if its current host is ours to change | P5 |

---

## 2. Architecture

```mermaid
flowchart LR
  subgraph Phone[App — React Native]
    RN[Room «الحلقة» · liveStore · LiveKit RN SDK]
  end
  subgraph Web[Admin web — admin.almahajja.app]
    AW[Upload original · live sessions · «واردة»]
  end
  subgraph SB[Supabase]
    DB[(Postgres: live_sessions, live_participants,\nmedia_jobs, notifications…)]
    EF1[live-token]
    EF2[live-control]
    EF3[r2-upload-url kind=lecture_raw]
    PQ[fan-out queue 0129 + push_queue 0131]
  end
  subgraph CF[Cloudflare]
    T[Tunnel almahajja-admin]
    R2[(R2 almahajja-media)]
  end
  subgraph VPS[/opt/almahajja-live on almahajja_net/]
    LK[almahajja-livekit :7880]
    EG[almahajja-egress]
    RD[almahajja-lk-redis]
    MW[almahajja-media-worker + ffmpeg]
  end
  RN -- JWT --> EF1 -- LiveKit token --> RN
  RN -- wss live.almahajja.app --> T --> LK
  RN -- UDP 7882 / TCP 7881 / TURN --> LK
  EF2 -- Twirp API via tunnel --> LK
  LK <--> RD <--> EG
  EG -- raw .ogg --> R2
  LK -- webhooks (internal) --> MW
  MW -- claim/complete jobs --> DB
  MW -- get raw / put mp3 --> R2
  AW -- signed PUT original --> R2
  AW -- enqueue --> DB
  DB --> PQ --> Phone
```

**Flows**
- **Join**: app → `live-token` (checks session state, ban, gender) → LiveKit JWT (listener grants) → connect `wss://live.almahajja.app` (signaling through our tunnel) → media over UDP 7882 directly to 161.97.135.4 (TCP 7881 / TURN fallback).
- **Speak**: listener sets own attribute `hand=1` → moderators see it → `live-control approve` → server `UpdateParticipant(canPublish=true)` → client may publish the mic and toggles it itself.
- **Record**: `live-control start` → `CreateRoom` + `StartRoomCompositeEgress(audio_only, OGG → R2 live-raw/)`; `end` → `StopEgress` + `DeleteRoom` → `egress_ended` webhook → worker job → MP3 → lecture row (section preset, `review_state='needs_title'`).
- **Upload** (admin): signed PUT of the **original** to `incoming/` → `enqueue_lecture_transcode` → worker → MP3 at the normal lecture key → lecture updated → original deleted.

---

## 3. Phase 0 — VPS infrastructure (`/opt/almahajja-live`)

### 3.1 Compose project

`/opt/almahajja-live/docker-compose.yml`, project name `almahajja-live`, network `almahajja_net` (external, created by `almahajja-admin`). Services (names are project-unique on purpose):

| Service / container | Image | Role | Limits |
|---|---|---|---|
| `almahajja-livekit` | `livekit/livekit-server:<pinned>` | SFU, signaling on :7880 (internal), TURN | `cpus: 1.0`, `mem_limit: 768m` |
| `almahajja-lk-redis` | `redis:7-alpine` | LiveKit ⇄ Egress bus (NOT the LIMS redis) | `mem_limit: 96m`, no persistence |
| `almahajja-egress` | `livekit/egress:<pinned>` | Room-composite audio recording → R2 | `cpus: 1.5`, `mem_limit: 1536m`, `cap_add: [SYS_ADMIN]` |
| `almahajja-media-worker` | built from `vps/media-worker/` | ffmpeg jobs + LiveKit webhooks | `cpus: 1.0`, `mem_limit: 512m`, ffmpeg under `nice -n 10` |
| `almahajja-media-worker-stg` | same image, staging env | staging jobs only; started on demand | same |

Pin every tag at build time and record it in the file. `restart: unless-stopped` everywhere.

### 3.2 Hostnames & DNS (zone `almahajja.app`, token `CLOUDFLARE_domain_TOKEN`)

| Host | Record | Purpose |
|---|---|---|
| `live.almahajja.app` | CNAME → tunnel `almahajja-admin` (proxied); add ingress `live.almahajja.app → http://almahajja-livekit:7880` | signaling (WebSocket) + server API used by edge functions |
| `turn.almahajja.app` | A → 161.97.135.4 (**DNS-only**) | TURN/TLS on 5349 (needs a real cert, see 3.4) |
| `go.almahajja.app` | CNAME → tunnel (proxied); ingress → `http://almahajja-admin:80` (second server block) | share links + `.well-known` (D8) |

Reuse the existing tunnel (id `abc61509-cbe6-4028-a10b-745c23a7fa81`) — add ingress rules via the API, keep the final `http_status:404`.

### 3.3 Ports (published by Docker → they bypass UFW; do not edit UFW)

| Port | Proto | Container | Why |
|---|---|---|---|
| 7881 | TCP | livekit | ICE/TCP fallback |
| 7882 | UDP | livekit | single-port UDP mux for all media |
| 3478 | UDP | livekit | TURN/UDP |
| 5349 | TCP | livekit | TURN/TLS (restrictive networks) |

Before publishing, re-check `ss -tulnH` that none are used by another project. Contabo network firewall (if enabled in their panel) must allow them too.

### 3.4 TLS for TURN

Our own `almahajja-certbot` (image `certbot/dns-cloudflare`, DNS-01 with a **dedicated** DNS-edit token file `/opt/almahajja-live/secrets/cf-dns.ini`, mode 600) issues `turn.almahajja.app` into `/opt/almahajja-live/certs`. Renew loop every 12 h; a deploy hook restarts `almahajja-livekit` when the cert changes. Never touch `lims-certbot-1`.

### 3.5 LiveKit config (`livekit.yaml`, mounted read-only)

- `port: 7880`, `rtc.tcp_port: 7881`, `rtc.udp_port: 7882`, `rtc.use_external_ip: false`, `rtc.node_ip: 161.97.135.4`
- `keys:` two pairs — **prod** and **staging** (edge functions sign with their env's key; room names prefixed `prd_`/`stg_`)
- `redis.address: almahajja-lk-redis:6379`
- `room.empty_timeout: 600`, `room.max_participants: 1000`, `audio.active_speaker_update: 0.4`
- `turn: enabled, domain turn.almahajja.app, tls_port 5349, udp_port 3478, cert_file/key_file`
- `webhook.api_key: <prod key>`, `webhook.urls: [http://almahajja-media-worker:8080/lk, http://almahajja-media-worker-stg:8080/lk]` (internal; the worker ignores rooms of the other env)

### 3.6 Capacity budget (4 vCPU EPYC, 7.8 GB RAM; LIMS & others use ~2.2 GB)

- Our steady state: livekit ~150 MB, redis ~10 MB, worker ~80 MB. During a live + recording: egress ~0.8–1.2 GB, ~1 CPU.
- 200 listeners × ~32 kbps Opus mono ≈ 6.5 Mbps egress bandwidth — fine.
- Hard caps via `cpus`/`mem_limit` so a runaway recording can never starve LIMS. **One concurrent live** (D3), enforced in `live-control start`.
- Transcode jobs run one at a time; the worker defers new transcodes while an egress is active.

### 3.7 Secrets (VPS)

`/opt/almahajja-live/.env` (600): LiveKit key/secret pairs, R2 access key + secret (write-scoped if possible), Supabase URL + **service role** keys per env, worker webhook api key. Never commit; document names in `vps/README.md`.

### 3.8 Exit criteria P0
- `lk` CLI: host publishes audio, **200 simulated subscribers** (`lk load-test --subscribers 200 --audio-publishers 1`) for 15 min: CPU < 60 %, no packet-loss alarms, LIMS sites all 200.
- Egress records a 10-min room to `almahajja-media-staging/live-raw/…ogg` and fires `egress_ended` to the staging worker.
- Phone on 4G (no Wi-Fi) connects via UDP; on a UDP-blocked Wi-Fi it connects via TCP/TURN.

---

## 4. Data model (migrations 0132 →)

### 0132_live_sessions.sql
```sql
create type public.live_status as enum ('scheduled','green','live','ended','processing','ready','failed','cancelled');

create table public.live_sessions (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references public.sections(id),
  sheikh_id       uuid references public.sheikhs(id),
  title           text not null check (length(title) between 3 and 200),   -- preliminary title
  status          public.live_status not null default 'scheduled',
  scheduled_at    timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  host_user_id    uuid not null references auth.users(id),
  allow_requests  boolean not null default true,
  notify_all      boolean not null default true,
  room_name       text unique not null,               -- 'prd_' || short id
  share_code      text unique not null,               -- 6 chars, unambiguous alphabet
  egress_id       text,
  raw_key         text,                               -- R2 live-raw/… (deleted per D5)
  lecture_id      uuid references public.lectures(id),
  peak_listeners  int not null default 0,
  created_at      timestamptz not null default now()
);
```
RLS: everyone (incl. guests) `select` rows with status in (`scheduled`,`live`,`ended`,`processing`,`ready`) but **only safe columns** through a view `live_sessions_public` (no `raw_key`, `egress_id`, `host_user_id`). Staff (`is_content_manager() or is_sheikh()`) select all. Writes only via RPCs/edge functions (service role).

### 0133_live_participants.sql
`live_participants(session_id, user_id, identity text, gender text check in ('m','f'), hidden_name bool, display_name text, role text check in ('listener','speaker','host','moderator'), joined_at, left_at, spoke_seconds int)`.
`identity` = opaque per-session id (`encode(digest(user_id||session_id,'sha256'),'hex')` first 16) so other clients never see user ids. RLS: no client access; edge functions only. Used for moderation lookups, attendance stats, the admin «مداخلات» list.

### 0134_live_social.sql
- `live_reminders(session_id, user_id, created_at, primary key(session_id,user_id))` — «ذكّرني».
- `live_buddy_invites(session_id, from_user, to_user, created_at, primary key(session_id, from_user, to_user))` — enforces **once per buddy per session**.
- Enum additions: `notification_type` add `live_start`, `live_reminder`, `live_invite`.
- Prefs: new toggle key `live_start` (default ON); `live_invite` is gated by the existing `buddy_activity` pref; `live_reminder` is opt-in by nature.

### 0135_media_jobs.sql
```sql
create type public.media_job_kind as enum ('lecture_transcode','live_recording');
create type public.media_job_status as enum ('queued','running','done','failed');
create table public.media_jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.media_job_kind not null,
  status public.media_job_status not null default 'queued',
  progress real not null default 0,          -- 0..1, written by the worker
  input_key text not null,                   -- incoming/… or live-raw/…
  output_key text,
  lecture_id uuid references public.lectures(id),
  live_session_id uuid references public.live_sessions(id),
  attempts int not null default 0,
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(), started_at timestamptz, finished_at timestamptz
);
```
`claim_media_job(p_env text)` — `update … where id = (select id from media_jobs where status='queued' order by created_at for update skip locked limit 1) returning *` (service role only). Staff can `select` their jobs (progress UI).

### 0136_lectures_live_source.sql
- `lectures.source text not null default 'upload' check in ('upload','live')`, `lectures.live_session_id uuid`, `lectures.review_state text check in ('needs_title', null)`.
- «واردة» becomes: `section_id is null OR review_state = 'needs_title'` (update `getUnclassifiedLectures` + any RPC behind it).
- Live-created lectures: `status='draft'`, `section_id` = session section, order = `max(order)+1` in that section, `sheikh_id` = session sheikh (pre-filled, editable), `review_state='needs_title'`. Publishing requires clearing `review_state` (title + sheikh confirmed) → existing publish path (and its notify-on-publish fan-out, which the admin can skip via «نشر بدون إشعار», 0123).

### 0137_live_rpcs.sql (security definer, `search_path=public`)
| RPC | Who | Does |
|---|---|---|
| `create_live_session(p_section, p_title, p_sheikh, p_scheduled_at, p_notify, p_allow_requests)` | content manager or sheikh | inserts `scheduled`/`green`, generates `room_name`, `share_code` |
| `get_live_now()` | anyone | current `live` session (safe columns) + next 3 `scheduled` + my reminder flags |
| `get_live_by_code(p_code)` | anyone (anon too) | safe fields for share links / fallback page |
| `set_live_reminder(p_session, p_on)` | registered | upsert/delete in `live_reminders` |
| `invite_buddy_to_live(p_session, p_buddy)` | registered | checks accepted `buddy_requests` pair + session `live` + not already invited → inserts invite + `notifications(type='live_invite')` (fixed Arabic phrase, gendered) |
| `enqueue_lecture_transcode(p_lecture, p_input_key)` | content manager | inserts `media_jobs` |
| `finalize_live_lecture(p_lecture, p_title, p_sheikh)` | content manager | sets title/sheikh, clears `review_state` |

Security: `node scripts/security-check.mjs` after each; contract tests in `tests/contract/live.contract.test.ts` (student cannot create; guest can read public; invite rejects non-buddy and duplicates; reminder requires registered).

---

## 5. Edge functions

### 5.1 `live-token` (new; `verify_jwt=true`, guests allowed)
Input `{ sessionId, identityChoice?: 'named'|'hidden' }`. Steps:
1. Load session (must be `green` for host/moderators, `live` for everyone else).
2. Load profile: role, ban flag, `gender`. Missing gender → `409 gender_required` (client shows `GenderPrompt`, then retries).
3. Upsert `live_participants` (identity, gender, hidden_name — only honoured for `f`; D2).
4. Mint LiveKit JWT (`npm:livekit-server-sdk` AccessToken, TTL 2 h) with env key:

| Role | `canSubscribe` | `canPublish` | `canPublishData` | `canUpdateOwnMetadata` | `roomAdmin` |
|---|---|---|---|---|---|
| listener (student/guest) | ✓ | ✗ | ✗ | ✓ (hand, visible name) | ✗ |
| host (session sheikh) | ✓ | ✓ | ✓ | ✓ | ✗ (admin actions go through `live-control`) |
| moderator (admin/publisher/other sheikh) | ✓ | ✓ | ✓ | ✓ | ✗ |

Participant `name` = display name, or «طالبة»/«ضيف»/«ضيفة» when hidden/guest. Attributes: `g` (m/f), `r` (role), `h` (hand 0/1), `hid` (hidden).

### 5.2 `live-control` (new; staff only except `leave`)
Actions: `open_green` · `start` · `end` · `approve` · `reject` · `mute` · `demote` · `set_allow_requests` · `host_leave` (hand over to a moderator).
- `start`: enforce D3; `CreateRoom(room_name, empty_timeout 600)`; `StartRoomCompositeEgress({audio_only:true, file:{filepath:'live-raw/{room_name}-{time}.ogg', s3:{R2…}}})`; status `live`, `started_at`; enqueue **`live_start` fan-out** (reuse 0129 queue; D6) and **`live_reminder`** for reminder holders.
- `approve`/`demote`: `UpdateParticipant(identity, permission{canPublish:±}, attributes{r, h:'0'})`; log to `live_participants.role`.
- `mute`: `MutePublishedTrack(identity, trackSid, true)` — speaker keeps permission (decision 6).
- `reject`: `UpdateParticipant(attributes{h:'0'})` + data message `{t:'rejected'}` to that identity.
- `end`: `StopEgress` → `DeleteRoom` → status `ended`. 5-second undo lives in the client (§7.6).
All calls go to `https://live.almahajja.app` (Twirp) with the env's API key. Every action writes an audit row (`live_participants` role changes + a small `live_moderation_log` if needed).

### 5.3 `r2-upload-url` (extend)
New kind `lecture_raw` → key `incoming/{uuid}.{ext}`, content types audio/* and video/mp4 (audio track extracted), max 2 GB, staff only. Browser PUT with **XHR upload progress** (current web path buffers the whole file with `fetch(...).arrayBuffer()` — replace with a streamed `File`/`Blob` PUT).

### 5.4 LiveKit webhooks → media worker (internal HTTP, not public)
Verify with `WebhookReceiver` (signed JWT + body hash). Handle: `room_started`, `participant_joined/left` (peak count, `spoke_seconds` via `track_published/unpublished`), `egress_ended` (→ enqueue `live_recording` job with `raw_key`), `room_finished` (safety net if `end` never came: status `ended`, D4).

---

## 6. Media worker (`vps/media-worker/`, Node 22 + TypeScript + ffmpeg)

- Image: `node:22-alpine` + `apk add ffmpeg`. Deps: `@supabase/supabase-js` (service role), `@aws-sdk/client-s3` (R2; remember the V13 `HeadObjectCommand` gotcha — use `GetObject` with Range or `ListObjectsV2` for existence), `livekit-server-sdk` (webhook receiver only).
- Loop: `claim_media_job(env)` every 5 s (and immediately after a webhook). One job at a time. Stream input from R2 to a temp file, run ffmpeg, stream output back.
- **Speech profile (unchanged from today):** `-vn -codec:a libmp3lame -q:a 9 -ac 1 -ar 22050`. Also run `-af loudnorm=I=-18:TP=-2` for live recordings (volume varies between sheikh and students) — decide after A/B on real audio.
- Progress: parse ffmpeg `-progress pipe:1` `out_time_ms` against duration (`ffprobe`) → `media_jobs.progress` (throttled 1/s).
- **lecture_transcode**: output to the same key scheme `r2-upload-url` uses for lectures (section/lesson-named keys, V13) — factor that naming into a shared module used by both. Update lecture `audio_key`, `duration_sec`, size; delete `incoming/` original.
- **live_recording**: output MP3; create the lecture row (§4 0136 rules); set session `ready` + `lecture_id`; notify staff inbox «تسجيل المجلس جاهز للمراجعة»; schedule raw deletion (D5).
- Failures: 3 attempts with backoff; then `failed` + staff inbox notification; the raw/original is never deleted on failure.
- Health: `/health` for Docker healthcheck; logs to stdout (`docker logs almahajja-media-worker`).
- Tests: unit tests for progress parsing, key naming, job state transitions (vitest in the worker package).

### 6.1 Admin upload switch
- `app/admin/upload.tsx`: pick file → PUT original (progress bar «جارٍ رفع الملف الأصلي») → create draft lecture + `enqueue_lecture_transcode` → progress «جارٍ الضغط على الخادم» from `media_jobs.progress` (poll 2 s) → done. The admin may leave the page; the job continues.
- Feature flag `app_config.server_transcode` (default off on prod until P1 verified). When on, `audioTranscode.web.ts` is not used.
- Cleanup after two weeks of clean prod runs: delete `public/ffmpeg/`, `src/lib/audioTranscode*.ts`, the flag.

---

## 7. Mobile app

### 7.1 Native dependencies (new binary required — cannot ship over OTA)
`@livekit/react-native`, `@livekit/react-native-webrtc`, `livekit-client`, `@livekit/react-native-expo-plugin`, `react-native-svg`.
Config (app.json plugins): LiveKit Expo plugin; Android `FOREGROUND_SERVICE_MICROPHONE` (+ existing `RECORD_AUDIO`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`), `BLUETOOTH_CONNECT`; iOS `NSMicrophoneUsageDescription` (Arabic), keep `UIBackgroundModes: audio`. Rebuild the dev client; verify the expo-audio patch still applies (`patches/`).

### 7.2 Audio session & coexistence
- Joining a live **pauses the lecture player** (`audioController.pause()`) and hands the session to WebRTC (`AudioSession.configureAudio` / `startAudioSession`). Leaving restores it.
- Listener: playback category; speaker: play-and-record with speaker/earpiece routing respected.
- Background: iOS `audio` mode; Android foreground service with a persistent notification «مباشر الآن · شرح كتاب …» and actions «كتم»/«مغادرة» (speakers use type `microphone|mediaPlayback`). Acceptance: 30 min screen-off listening on R5CX10P3BPL and an iPhone without drops.

### 7.3 Files
```
src/api/live.ts                 getLiveNow, getLiveByCode, createLiveSession, setReminder, inviteBuddy,
                                fetchLiveToken, liveControl(action,…)
src/hooks/useLive.ts            TanStack hooks (queryKeys.liveNow, liveSession(id))
src/stores/liveStore.ts         Zustand: session, connection state, my role/hand/mic, participants map,
                                active speakers, buddies-present
src/lib/liveClient.ts           LiveKit Room wrapper: connect/reconnect, event → store mapping,
                                publish/unpublish mic, set attributes; the ONLY file importing livekit
src/lib/halaqaLayout.ts         pure geometry: rings, slots, capacity, special placements (unit-tested)
src/components/live/
  LiveHomeCard.tsx              A-style card in the ContinueCard slot
  LiveUpcomingCard.tsx          scheduled sessions + «ذكّرني»
  LiveSectionPin.tsx            section page pin (live / scheduled / review / host «ابدأ»)
  Halaqa.tsx                    react-native-svg board: star medallion, mashrabiya ring, rows (Use/Symbol),
                                ripples (Reanimated), overlays for me/speakers/buddies/hands
  NiqabIcon.tsx · BrotherIcon.tsx  16-unit pictograms (same paths as the prototype)
  LiveDock.tsx                  leave · request/mic · people
  LiveMiniBar.tsx               mini-bar variant of MiniPlayer (sheikh + speaker stack, mic/pause)
  sheets/  IdentitySheet, PeopleSheet, BuddyInviteSheet, ShareSheet, ManageSheet, PersonSheet,
           RequestSheet, EndSheet (choice → confirm → 5 s undo), CreateLiveSheet
  LiveStateLine.tsx             «يتحدث الآن…» / connection states
app/live/[id].tsx               the room (modal-like full screen, Android peek-sheet like the player)
app/live/code/[code].tsx        deep-link entry (resolves code → id, handles gender/identity, joins)
app/live/green/[id].tsx         host green room (mic meter, connection check, «ابدأ البث»)
```
Edits: `app/(student)/index.tsx` (card slot), `app/(student)/section/[id].tsx` (pin + staff CTA), `src/components/MiniPlayer.tsx` (render `LiveMiniBar` when `liveStore.session`), notifications labels/prefs (`live_start`, `live_invite`, `live_reminder`), `app/_layout.tsx` deep links.

### 7.4 Halaqa rendering (performance)
- One `<Svg>`; listeners as `<Use href="#pm|#pf">` (≈200 nodes), memoized by a **layout key** (counts + specials), not by every attribute change. Active-speaker changes only re-render overlays and ripples.
- Ripples: 3 Reanimated circles (`transform: scale`), disabled when `AccessibilityInfo.isReduceMotionEnabled`.
- Capacity rule: 4 brother rows + 2 sister rows fit ≈ 230 at 15 px; above that shrink to 12 px; above ≈ 350 show «+N» per section (tap → PeopleSheet).
- Tap on an icon → small tooltip (name or «طالبة»); moderators get Person/Request sheets.

### 7.5 Connection states (map LiveKit events → `liveStore.conn`)
`connecting` (Room.connect) · `ok` · `poor` (`ConnectionQualityChanged` = poor) · `reconnecting` (`Reconnecting`) · `hostdrop` (host participant disconnected / no host audio track > 5 s) · `offline` (NetInfo offline) · `failed` (connect error after 3 tries) · `ended` (`Disconnected` with reason ROOM_DELETED). Copy exactly as the prototype («جارٍ الانضمام…»، «الاتصال ضعيف · قد يتقطع الصوت قليلاً»، «انقطع اتصال الشيخ مؤقتاً»، «انتهى المجلس»…).

### 7.6 Host controls
Green room (mic test, connection check, «يُسجَّل تلقائياً ويُحفظ في قسم …», «إشعار للجميع عند البدء»). Live: «يُسجَّل» marker, requests strip + hands on icons, Manage/Person sheets, End: choice («أغادر ويستمر البث» when another moderator is present / «إنهاء البث للجميع») → confirm (shows the destination section) → **5-second undo** before `live-control end`.

### 7.7 Privacy
Sister hidden: `name` «طالبة» in token, `hid=1`; PeopleSheet shows «طالبة»; buddy invites still use the real name *to the buddy only* (they are already paired). Listener names otherwise visible on tap (decision 3 implies names are public when chosen).

---

## 8. Admin web

- Sidebar: «البث المباشر» (list: live now, scheduled, ended with recording status/job progress; cancel scheduled; open green room link for staff on phone).
- «المحاضرات الواردة»: live items show chip «من بث مباشر», section **fixed** (change link), order auto, **only two required fields**: final title + sheikh (pre-filled suggestion), interventions list with timestamps (from `live_participants`), then «نشر» (with/without notification) or «حفظ دون نشر».
- Upload page: server transcode flow (§6.1).
- Redeploy recipe (unchanged): `npx expo export --platform web` → tar to `/opt/almahajja-admin/site`.

---

## 9. Notifications, buddies, sharing

### 9.1 Live start
`live-control start` → fan-out through the existing async queue (0129) and paced `push_queue` (0131) with `type='live_start'`, title «بدأ البث المباشر», body «{title} · {session}، مع {sheikh}. اضغط للاستماع.», data `{route:'/live/{id}'}`. Honour the `live_start` pref and D6. Host toast: «بدأ البث. يصل الإشعار إلى كل الطلاب خلال دقيقة تقريباً».

### 9.2 Buddy invite
`BuddyInviteSheet` → `invite_buddy_to_live` → notification `live_invite`: «رفيقك {name} يدعوك» / «رفيقتك {name} تدعوك», body «{name} في مجلس «{title}» الآن، فهلمّ/فهلمّي إليه.». Once per buddy per session; hidden for guests (no buddies). Buddies present in the room are highlighted «رفيقك · حسن».

### 9.3 Share links (D8)
- Link: `https://go.almahajja.app/live/{share_code}`; message: «يُبث الآن: {title} · {session}، مع {sheikh}.\nاستمع في المحجّة البيضاء:\n{link}».
- **Android App Links**: `app.json` `android.intentFilters` (`autoVerify: true`, host `go.almahajja.app`, pathPrefix `/live`) + `https://go.almahajja.app/.well-known/assetlinks.json` with the **Play app-signing SHA-256** (from Play Console) for `com.riwaqalilm.app`.
- **iOS Universal Links**: `ios.associatedDomains: ["applinks:go.almahajja.app"]` + `/.well-known/apple-app-site-association` (JSON, no redirect, `application/json`).
- **Fallback page** (`go.almahajja.app/live/{code}`, static, served by our nginx on `almahajja_net`): calls `get_live_by_code` (anon key) → live / scheduled / ended card; UA detection redirects to Play or App Store after 1.5 s; «لديّ التطبيق · افتح البث» uses `riwaqalilm://live/code/{code}`. Open-graph tags for the preview (title, sheikh, image `og-live.png`).
- After install, no deferred deep link needed: the live card is on Home while the session is live.

### 9.4 Scheduled reminders
pg_cron every minute: sessions with `scheduled_at` in 15 min → `live_reminder` to `live_reminders` holders (once).

---

## 10. Security & abuse

- Tokens: short TTL, per-session identity, no user ids in the room. Banned users get `403`.
- Only `live-control` (server) changes permissions; clients can only set their own hand/visibility attributes.
- Rate limits: hand raise toggles ≤ 1 per 5 s (client) and moderators can switch requests off («استقبال طلبات الكلمة»).
- Recordings private until published; raw deleted per D5; interventions list lets the admin review student voices before publishing (they were told «صوتك سيكون ضمن التسجيل» on approval).
- VPS: our containers only on `almahajja_net`; secrets 600; no SSH keys or tokens in the repo.

---

## 11. Testing

| Layer | What |
|---|---|
| Unit (jest) | `halaqaLayout` (capacity, specials, overflow), connection-state reducer, permission mapping, share-code parsing, Arabic copy helpers (gendered verbs «يتحدث/تتحدث») |
| Screen (RNTL, hook-seam mocks) | Home card states, section pin, room listener/speaker/host, identity sheet, end flow with undo, notifications prefs row |
| Contract (staging) | all §4 RPCs incl. RLS denials; `live-token` role grants; `live-control` staff-only |
| Worker | progress parser, key naming, retries, webhook signature |
| Load | `lk load-test` 300 subscribers + 3 speakers, 30 min, with recording |
| Failure drills | kill egress mid-session (session still ends cleanly, job marks failed, raw kept); host airplane mode (hostdrop → back); worker restart mid-job (job re-claimed) |
| Devices | R5CX10P3BPL (Android 14+), small Android (<700 dp), one iPhone; screen-off 30 min; Bluetooth headset; incoming phone call during live |

Regression tests name the finding they guard, per CLAUDE.md conventions.

---

## 12. Delivery phases (each ends deployable and verified)

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 Infra** | §3: compose, LiveKit+Redis+Egress, tunnel ingress `live.`, ports, TURN cert, load test | §3.8 met; LIMS untouched (all its hosts 200 before/after) |
| **P1 Media worker + server compression** | §6, 0135 (media_jobs), `r2-upload-url lecture_raw`, admin upload switch behind flag | 1 h and 2 h 40 m real lectures processed on staging then prod; admin can close the tab mid-job |
| **P2 Sessions backend** | 0132–0137, `live-token`, `live-control`, webhooks → recording → lecture | CLI-driven session on staging produces a draft lecture in the right section with `needs_title` |
| **P3 Listening app** | deps + binary, liveStore/liveClient, Home card, section pin, room (listen), mini-bar, background audio, identity & gender prompts, connection states | internal build: 30 min background listening on both OSes; halaqa renders 200 at 60 fps on R5CX10P3BPL |
| **P4 Speaking & moderation** | hands, approve/reject, self mic, mute, demote, green room, end + undo, host handover, D4 auto-end | 3 phones + 1 host on staging complete a full «رفع يد → حديث → كتم → إعادة للاستماع» cycle; recording contains all voices |
| **P5 Notifications & sharing** | 0134 types/prefs, fan-out, reminders, buddy invites, share sheet, App Links/Universal Links, fallback page | link opens the room with app installed; routes to store without; buddy invite once only |
| **P6 Admin web** | «البث المباشر» page, «واردة» live items (title + sheikh only), interventions list | admin finalizes a live lecture in < 1 min |
| **P7 Hardening & release** | load test 300, drills, device matrix, prod keys/buckets, `app_config.live_enabled` flag, UpdateGate min version, EAS build (versionCode 12), store submission | flag on for staff first, then everyone |

Order note: **P1 ships value on its own** (fixes slow in-browser compression) and exercises the worker/R2 path the recordings need — do it first after P0.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Egress (Chrome) spikes CPU/RAM on a shared VPS | hard `cpus`/`mem_limit`; one live at a time; monitor during P0 load test; fall back to Participant egress of the host only if needed |
| UDP blocked on some networks | TCP 7881 + TURN/TLS 5349 fallback; tested in P0 |
| Cloudflare proxy and WebSocket signaling | tunnel supports WS; verify reconnect behaviour in P0; if flaky, make `live.` DNS-only with our own cert (like `turn.`) |
| expo-audio patch or background playback conflicts with WebRTC | single owner of the audio session (liveClient pauses the player); device tests in P3 |
| Push fan-out volume (10 k devices) | existing paced queue (0131) already handles it; live_start is one broadcast |
| Student voices published without consent | approval sheet states recording; admin reviews interventions before publishing |
| New native deps delay the store release | P1/P2 need no app release; P3 starts the binary early (internal testing track) |

---

## 14. Out of scope (v1)

Video, screen share, chat/comments, reactions, live transcription/captions, multiple simultaneous rooms (D3), web listening for students (web stays admin-only), paid features, public listener lists beyond what §7.7 allows.

---

## 15. Arabic copy reference (ship exactly; gender-aware where marked)

| Key | Copy |
|---|---|
| home.card | «مباشر الآن» · «بدأ منذ {n} دقيقة» · «{count} في الحلقة» · «الشيخ يتحدث» · «استمع» / «العودة إلى الحلقة» |
| room.now | «يتحدث الآن: {name}» · «تتحدث الآن: {name}» (f) · «أنت تتحدث الآن» · «لا أحد يتحدث الآن» |
| room.request | «طلب الكلمة» · «بانتظار الإذن · إلغاء» · «رفعت يدك. يراها المشرفون في مكانك من الحلقة» |
| room.accepted | «صرت من المتحدثين. افتح الميكروفون وأغلقه متى شئت. المجلس يُسجَّل وصوتك ضمنه» |
| room.rejected | «اعتذر المشرف عن إعطائك الكلمة الآن» |
| room.muted | «أغلق المشرف ميكروفونك، وتستطيع فتحه متى احتجت» |
| room.demoted | «أعادك المشرف إلى الاستماع. ارفع يدك من جديد إن أردت الكلمة» |
| identity | «كيف تظهرين في الحلقة؟» · «باسمي» · «بدون اسم» · «تظهرين «طالبة» في الحلقة وفي القوائم» |
| states | «جارٍ الدخول إلى الحلقة…» · «جارٍ إعادة الاتصال…» · «الاتصال ضعيف · قد يتقطع الصوت قليلاً» · «انقطع اتصال الشيخ مؤقتاً. ابقَ في الحلقة، يُستأنف الصوت تلقائياً عند عودته.» · «انقطع اتصالك بالإنترنت. سنعيدك إلى الحلقة تلقائياً عند عودته.» · «تعذّر الدخول إلى الحلقة» |
| end | «مغادرة الحلقة» · «أغادر ويستمر البث» · «إنهاء البث للجميع» · «إنهاء البث للجميع؟» · «ينتهي البث خلال ثوانٍ · تراجع» · «انتهى المجلس» · «جزاكم الله خيراً على الحضور» |
| buddy | «رفيقك {name} ليس في الحلقة · ادعُه» · «رفيقتك {name} ليست في الحلقة · ادعيها» · «أُرسلت الدعوة إلى {name}» |
| push | «بدأ البث المباشر» · «رفيقك {name} يدعوك» / «رفيقتك {name} تدعوك» |
| share | «مشاركة رابط البث» · «من لديه التطبيق يدخل الحلقة مباشرة، ومن ليس لديه يُوجَّه إلى متجر جهازه.» |
| admin | «من بث مباشر» · «مطلوب منك: العنوان النهائي والشيخ» · «جارٍ الضغط على الخادم» |
