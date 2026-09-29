#!/bin/sh
# almahajja-egress-guard (V23 P7). Egress wipes its tmp dir (/home/egress/tmp,
# host: recordings/egress-tmp) every time it starts, so after a crash + auto
# restart an in-progress recording would be gone before the media worker could
# recover it. Every 2 s this hard-links each in-progress EG_*/…ogg into
# recordings/egress-guard/EG_*/ — same inode, so the link keeps growing with the
# recording and survives the wipe. The workers read partials from there
# (mounted at /egress-tmp). Links older than 24 h are dropped.
src=/rec/egress-tmp
dst=/rec/egress-guard
mkdir -p "$src" "$dst" && chown 1000:1000 "$dst" && chmod 775 "$dst"
while true; do
  for f in "$src"/EG_*/*.ogg; do
    [ -f "$f" ] || continue
    eg=$(basename "$(dirname "$f")")
    d="$dst/$eg"
    t="$d/$(basename "$f")"
    if [ ! -d "$d" ]; then mkdir -p "$d" && chown 1000:1000 "$d" && chmod 775 "$d"; fi
    [ "$f" -ef "$t" ] || ln -f "$f" "$t"
  done
  find "$dst" -mindepth 2 -type f -mmin +1440 -delete 2>/dev/null
  find "$dst" -mindepth 1 -maxdepth 1 -type d -empty -mmin +60 -delete 2>/dev/null
  sleep 2
done
