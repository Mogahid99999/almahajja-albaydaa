#!/usr/bin/env bash
# Usage: analyze.sh <room> <egressId>
S="C:/Users/Dafa-Alla/AppData/Local/Temp/claude/d--Projects-Al-Mahajjah-App-almahajja-albaydaa/4a8ebdc8-cc99-4b46-8253-8c9988f46919/scratchpad"
FF="$S/ff/node_modules/ffmpeg-static/ffmpeg.exe"; FP="$S/ff/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe"
ROOM="$1"; EG="$2"; KEY=~/.ssh/lims_vps_ed25519
for i in $(seq 1 40); do ssh -i $KEY -o BatchMode=yes root@161.97.135.4 "docker logs --since 40m almahajja-egress 2>&1 | grep -F '$EG' | grep -qE 'egress_(complete|failed)'" && break; sleep 10; done; echo "ended after ~$((i*10)) s of waiting"
ssh -i $KEY -o BatchMode=yes root@161.97.135.4 "docker logs --since 30m almahajja-egress 2>&1 | grep -F '$EG' > /tmp/zz_eg.log; echo \"recorder: mixer-drops=\$(grep -c 'mixer will drop' /tmp/zz_eg.log) sr-ignored=\$(grep -c 'unacceptable drift' /tmp/zz_eg.log) pts-corrections=\$(grep -c 'correcting PTS' /tmp/zz_eg.log) \$(grep -oE 'audioBuffersDropped\": [0-9]+' /tmp/zz_eg.log | tail -1) \$(grep -oE 'egress_(complete|failed)' /tmp/zz_eg.log | tail -1)\"; rm -f /tmp/zz_eg.log"
scp -q -i $KEY "root@161.97.135.4:/opt/almahajja-live/recordings/egress-tmp/$ROOM.ogg" "$S/audio/$ROOM.ogg" || { echo "no file"; exit 1; }
ssh -i $KEY -o BatchMode=yes root@161.97.135.4 "rm -f /opt/almahajja-live/recordings/egress-tmp/$ROOM.ogg"
echo "file duration: $("$FP" -v error -show_entries format=duration -of csv=p=0 "$S/audio/$ROOM.ogg") s"
echo -n "silences ≥0.3 s: "
"$FF" -hide_banner -nostats -i "$S/audio/$ROOM.ogg" -af silencedetect=noise=-40dB:d=0.3 -f null - 2>&1 | grep -oE "silence_start: [0-9.]+|silence_duration: [0-9.]+" | paste - - | awk '{c++; tot+=$4; l=l sprintf(" @%ds(%.1fs)", $2, $4)} END {printf "%d, total %.1f s:%s\n", c, tot, l}'
