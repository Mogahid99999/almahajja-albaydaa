# Recording-drift reproduction (2026-10-13)

Reproduces the 10-10 / 10-12 recording cuts: a publisher whose audio clock runs slow
(the sheikh's Android phone ≈ 1.4 %), recorded by the production egress into a local
file on the VPS. Rooms are named `zz_drift_*` (no `prd_`/`stg_` prefix → the media
workers ignore them) and are deleted afterwards.

Setup (outside the repo, e.g. a temp dir): `npm i @livekit/rtc-node livekit-server-sdk ffmpeg-static ffprobe-static`,
then run from that dir:

    node sim.mjs  <repo>/.env <label> 0.02 360   # one drifting speaker, 2 %, 6 min
    node sim2.mjs <repo>/.env <label> 0.02 360   # + a "student" on a correct clock (660 Hz, 20 s/min)
    bash analyze.sh <room> <egressId>           # waits for egress_complete, counts drops, pulls the
                                                 # file (then deletes it on the VPS), finds silences
                                                 # (edit the ffmpeg paths at its top)

Results on egress v1.14.1 (2 % drift, 6 min):
- defaults + audio_tempo_controller → 138.7 s silent (2282 buffers dropped)
- + enable_sync_engine → silent from 1:56 to the end (3757 dropped) — do NOT use
- latency windows 180 s → 0 dropped, one 1.5 s re-alignment pause (5 s RTPMaxAllowedTsDiff)
- + `rtpmaxallowedtsdiff: 180s` (FINAL) → 0 dropped, 0 pauses, tempo stretches the late
  speaker; 5 % drift also clean; 2 speakers both complete. Residual: «buffer full» 1-packet
  (20 ms) drops ~4 per 6 min — a hard-coded 100-item queue (cSamplesQueueDepth).
