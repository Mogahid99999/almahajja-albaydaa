# listener-rec — live recording by the server's clock

Records every live room the way a student's phone hears it, to replace the
room-composite egress recording after a comparison period.

## Why

The LiveKit egress mixes tracks by the **sender's** clock (RTP timestamps + RTCP
sender reports). A phone whose clock drifts or jumps made the egress drop
13–40 s (before 2026-10-13) and, with the 180 s latency windows set that day,
hold and lose ~3-minute blocks (10-14 → 11-05, ~64 min in 13 lives). Live
listeners never heard those cuts: a phone plays each packet when it arrives.

## How

- Polls `ListRooms` every 3 s and joins every `prd_` / `stg_` room as a **hidden
  recorder** (`listener-rec`, no publish, invisible to the app; the media worker
  ignores unknown identities).
- Each audio track → its own Ogg/Opus file, packets copied as received (no
  re-encoding during the live, near-zero CPU). RED is reduced to its primary
  Opus block.
- Timeline = server arrival time: a pause (no packet for 200 ms: DTX, mute,
  reconnect) is filled with Opus silence up to the arrival time; network loss
  (sequence gap ≤ 50) is filled with silence of the lost length; a fast sender
  is held within 1 s of the wall clock (comfort-noise packets dropped first,
  anything beyond 3 s); a slow sender without any pause is pulled back after 5 s.
- When the room is deleted (or no visible participant for 20 s) it writes
  `manifest.json` and mixes the tracks by arrival offset with ffmpeg
  (`amix normalize=0`, `nice 15`) → `mix.ogg`.

Output: `/opt/almahajja-live/recordings/listener/<room>-<UTC join time>/`
(`NNN_<identity>_<trackSid>.ogg`, `manifest.json`, `mix.ogg`).

## Phase 1 (from 2026-11-14): beside the egress

It only writes files. The published lecture still comes from the egress.
Compare each live's `mix.ogg` with the egress file (duration, silences ≥ 15 s,
digital-zero blocks) before switching the media worker to it.

## Build and run (VPS, only with no live running)

```sh
tar -cf - listener-rec | ssh … 'tar -C /opt/almahajja-live -xf -'
cd /opt/almahajja-live/listener-rec && docker build -t almahajja-listener-rec:<tag> .
docker run -d --name almahajja-listener-rec --restart unless-stopped --network almahajja_net \
  --env-file /opt/almahajja-live/secrets/listener-rec.env \
  -v /opt/almahajja-live/recordings/listener:/recordings/listener almahajja-listener-rec:<tag>
```

`secrets/listener-rec.env` holds `LIVEKIT_WEBHOOK_KEY`, `LIVEKIT_WEBHOOK_SECRET`
(the same API key the media worker uses) and `LIVEKIT_URL=ws://almahajja-livekit:7880`.
Optional: `ROOM_PREFIXES` (default `prd_,stg_`), `OUT_DIR`.

Test without touching real rooms: run a second copy with `ROOM_PREFIXES=zz_`
and publish test files with `livekit/livekit-cli` (`lk room create`, then
`lk room join --publish <file.ogg>`) on `almahajja_net`.

No retention yet: files are ~10 MB per speaker-hour; delete compared folders
by hand until the switch-over adds cleanup.
