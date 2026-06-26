مشغّل الصوت — سطح التشغيل الكامل لمحاضرة صوتية (٣٩٠×٨٤٤، موبايل، RTL).

# AudioPlayer — مشغّل الصوت

Full-screen playback surface for a lecture. Full-bleed teal `#1f4a42` with a faint concentric-circle motif at the top.

## Layout
- **Top bar** — left button = collapse/minimize (line handle, returns to mini-player), center label "شرح الأصول الثلاثة", right = overflow (⋮). Both on `rgba(255,255,255,.08)`, radius 13.
- **Artwork emblem** — 148px rounded tile (`#16352f`, radius 30) with nested rotated-square rhombi in brass. Calm, no photo.
- **Title block (centered)** — eyebrow "الدرس الخامس" (brass 11), title Amiri 25/700 ("باب الأصل الأول: معرفة الله") in `#f6f0e2`, sheikh in `#a9bdb6`.
- **Waveform** — ~48 thin bars; played portion (62%) brass `#c9a463`, remaining `rgba(223,231,227,.22)`. Tap to seek. Current time `١٨:٤٢` (brass) and duration `٣٠:١٥` below.
- **Transport row (centered)** — back-10s (circular-arrow + "١٠"), 78px brass round play/pause, forward-10s.
- **Bottom utility bar (absolute, 26px from bottom)** — playback-speed chip (cycles ٠٫٧٥× ١٫٠× ١٫٢٥× ١٫٥× ٢٫٠×), download chip, minimize icon-button. All on `rgba(255,255,255,.07)`.

## Notes
- On-teal text colors: `#f6f0e2` primary, `#a9bdb6` secondary, `#dfe7e3` icon stroke.
- This card shows the **playing** state (pause bars in the 78px button).
