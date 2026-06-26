# Handoff: رِواق العِلم — Islamic Educational Lessons App

A calm, scholarly platform for Islamic knowledge (دروس علمية شرعية): audio lectures organized into a nested tree of subjects (العقيدة، الفقه، السيرة…), with a student-facing mobile app and an admin web dashboard.

---

## About the Design Files

The files in `screens/` are **design references created in HTML** — prototypes that show the intended look, layout, and behavior. **They are not production code to copy directly.**

Each screen is authored as a self-contained "Design Component" (`*.dc.html`) that runs against the included `support.js` runtime. That runtime is a *prototyping* tool — **do not ship it**. Your task is to **recreate these designs in the target codebase's environment** (React Native / Expo, Flutter, SwiftUI, a React web app for the dashboard, etc.) using its established patterns, component library, and i18n setup. If no codebase exists yet, pick the framework best suited to the product (a cross-platform mobile framework for the three app screens; a React/Vue web app for the admin dashboard) and implement there.

To preview a reference: open any `screens/*.dc.html` in a browser (they load fonts from Google Fonts and the local `support.js`).

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are specified. Recreate pixel-for-pixel using the codebase's own libraries. Exact hex values, sizes, and copy are given below.

## Localization & Direction

- **All UI is Arabic, RTL.** Every screen sets `dir="rtl"`. Mirror the entire layout: the sidebar sits on the **right**, back chevrons point **right** (`›`), progress fills from the right, horizontal scrollers start from the right.
- **Numerals are Arabic-Indic** (٠١٢٣٤٥٦٧٨٩) throughout — times, counts, percentages, dates. Use a locale-aware number formatter (`ar-EG` / `ar-SA`) rather than hardcoding glyphs.
- Times use tabular figures (`font-variant-numeric: tabular-nums`) so digits don't jitter.

---

## Design Tokens

### Color palette (manuscript-inspired, warm & muted)
| Token | Hex | Use |
|---|---|---|
| `bg/sand` | `#f3ecdd` | App background (warm off-white) |
| `bg/sand-raised` | `#f8f3e8` | Admin topbar / raised surfaces |
| `surface/card` | `#fbf7ed` | Cards on sand |
| `surface/white` | `#ffffff` | Inputs, inner rows |
| `surface/inset` | `#e9e0cd` | Icon-button backgrounds |
| `surface/track` | `#ece3cf` | Progress tracks, segmented control bg |
| `primary/teal` | `#1f4a42` | Primary brand green-teal (headings, feature cards, sidebar, primary buttons) |
| `primary/teal-deep` | `#16352f` | Darker teal (player bg gradient end, artwork) |
| `primary/teal-600` | `#2c6157` | Teal gradient light end, input focus border |
| `accent/brass` | `#c9a463` | Brass/gold accent (play buttons, active progress, emphasis) |
| `accent/brass-muted` | `#b0894f` | Muted brass (asterisks, hairline motifs, secondary accent) |
| `accent/brass-soft` | `#cbb98e` | Dashed borders on "dua"/tip cards |
| `text/ink` | `#2b2723` | Primary text |
| `text/slate` | `#5c5343` | Form labels |
| `text/muted` | `#6b6253` | Secondary text |
| `text/faint` | `#897a5d` | Descriptions on sand |
| `text/ghost` | `#9a8f7c` | Meta, captions |
| `border/sand` | `#e8ddc6` | Card borders |
| `border/sand-2` | `#ddd1b7` / `#e4d9c2` | Input borders / dividers |
| `border/hair` | `#ece3cf` | Row separators inside cards |
| `state/success` | `#1f8a5b` | Completed lecture check |
| `state/danger` | `#b85c4a` | Remove / delete icons |
| On-teal text | `#f6f0e2` (primary), `#a9bdb6` (secondary), `#dfe7e3` (icon stroke) | Text on teal surfaces |

Two background colors max (`#f3ecdd` app, teal for feature/player/sidebar surfaces). No bright or competitive colors — the mood is calm and serious, **no gamification**.

### Typography
- **Display / titles:** `Amiri` (serif), weight 700. Used for screen titles, lecture titles, section names, large numerals-as-emblem. Line-height ~1.3.
- **UI / body:** `IBM Plex Sans Arabic`, weights 300–700. Labels 13px/600, body 12.5–14px/400, captions 11–11.5px.
- Google Fonts import (already in each file):
  `https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap`
- Type scale (mobile): screen title 25–26px (Amiri), section heading 16px/600, card title 14–16px, label 13px/600, caption 11–12px. **Mobile minimum ~11px for captions; tap targets ≥ 44px.**

### Spacing, radius, shadow
- **Screen padding:** 22px horizontal (mobile), 30px (admin content).
- **Radius scale:** inputs/icon-buttons 11–13px; cards 16–18px; feature cards & artwork 20–30px; pills/badges 50%.
- **Card border:** 1px solid `#e8ddc6` on `#fbf7ed`.
- **Soft shadows only** (long, low-opacity, brand-tinted): feature card `0 14px 30px -14px rgba(31,74,66,.7)`; mini player `0 16px 34px -14px rgba(22,53,47,.85)`; primary button `0 8px 18px -8px rgba(31,74,66,.6)`. Avoid hard or neutral-gray shadows.
- **Geometric motif:** faint concentric circles and rotated squares (rhombus, `transform: rotate(45deg)`) at low opacity as the decorative language — used in place of imagery. The rotated-square rhombus is the recurring brand mark (logo, bullets, list dots, emblem).

### Iconography
- Stroke icons, ~1.8–2 stroke width, rounded caps/joins (Lucide/Feather style). Stroke colors per surface: `#5c5343`/`#6b6253` on sand, `#dfe7e3` on teal, `#c9a463` for accented.
- Status/bullet dots are rhombus squares or small circles, not filled icons.

### Mobile frame
Designs are drawn at **390 × 844** (iPhone portrait) with a mock status bar (٩:٤١, signal, battery ٨٤). Drop the status-bar mock in production — use the real device chrome / safe-area insets.

---

## Screens / Views

### 1. Home — `screens/رواق العلم.dc.html`  (390 × 844, mobile)
**Purpose:** Student landing; resume listening and browse.
**Layout (top → bottom), single vertical scroll, 22px side padding, 118px bottom padding to clear the fixed mini-player:**
1. **Header** — app logo (40px circle, brass ring + teal rhombus), title "رِواق العِلم" (Amiri 22/700, teal) + subtitle "مجالس الدروس الشرعية" (11px ghost); search icon-button (40px, `#e9e0cd`, radius 13) on the left.
2. **"أكمِل الاستماع" (Continue listening) feature card** — teal `#1f4a42`, radius 22, with faint concentric-circle motif. 62px artwork tile (`#16352f`, brass rhombus), lesson eyebrow (brass 11px: "الدرس الخامس · شرح الأصول الثلاثة"), title (Amiri 19/700, `#f6f0e2`: "باب الأصل الأول: معرفة الله"), sheikh ("الشيخ عبد الله بن سالم"). Progress row: ١٨:٤٢ / track (62% brass fill) / ٣٠:١٥, and a 42px brass round play/pause button. **Tapping the card toggles play/pause** (drives the `playing` state shared with the mini-player).
3. **"أُضيف حديثاً" (Newly added)** — section header + "عرض الكل"; horizontal snap scroller of 158px cards: 158px cover tile (tinted gradient + play glyph + duration chip), Amiri 15/700 title, ghost sheikh line.
4. **"الأقسام العِلمية" (Sections grid)** — 2-column grid, 12px gap. Each card (`#fbf7ed`, radius 18): 42px letter tile (Amiri, teal letter on `#eef0e9`) + name (14/600) + count ("٤٢ درساً"). Items: العقيدة، الفقه، التفسير، الحديث، السيرة، التزكية.
5. **"لا تنسَ الدعاء" (Dua card)** — quiet dashed-brass card (`rgba(176,137,79,.06)`), rhombus mark, Amiri 15/700 title + soft body inviting the student to make du'a for the platform's scholars and contributors. Deliberately non-intrusive.
6. **Mini player (fixed)** — pinned 14px from bottom, left/right 12px. Teal `#16352f`, radius 20. 40px artwork, current lecture title + thin 62% progress bar, 40px brass round play/pause. Tapping toggles play.

### 2. Section page — `screens/صفحة القسم.dc.html`  (390 × 844, mobile)
**Purpose:** A **generic, reusable** node page that renders at every level of the tree (top subject / sub-topic / book). Same template for العقيدة, التوحيد, كتاب التوحيد, etc.
**Layout:**
- **Nav bar:** back chevron (points right) + parent-context label ("العقيدة") + search.
- **Header (optional block):** a vertical **badge** (58px wide, ≥74px tall, teal, radius 18) containing the section name in a condensed Amiri treatment (`transform: scaleX(.82)`, brass `#c9a463`) — the badge replaces a separate icon+title; the section name lives *inside* the badge. Beside it, the description (13px, `#6b6253`). *(This was an explicit revision: do not show a single-letter icon and the title separately — put the title in the badge.)*
- **Meta row:** sheikh (with rhombus bullet) · lecture count.
- **Progress card** (`#fbf7ed`): "تقدّمك في القسم" + percentage (٣٨٪, teal 700), 7px gradient track (`#1f4a42 → #2c6157`), "أكملت ١٦ من ٤٢ محاضرة".
- **"الأقسام الفرعية" (Sub-sections):** horizontal snap scroller of 152px cards (letter tile + left chevron, Amiri name, count). Hidden/empty when a node is a leaf.
- **"محاضرات القسم" (Lectures list):** flat list inside one rounded card, rows separated by `#ece3cf` hairlines. Each row:
  - **Status indicator** (34px round): **not started** = sand bg + ghost dot; **in progress** = teal bg + brass play triangle, label "قيد الاستماع · ١٢:٣٠" (brass); **completed** = teal-tint bg + green check `#1f8a5b`, label "مكتملة", title dimmed to `#6b6253`.
  - Title (14/600), duration + status label meta row.
  - **Download icon** on the left (outline download; completed rows show a filled/checked download).

### 3. Full-screen audio player — `screens/مشغل الصوت.dc.html`  (390 × 844, mobile)
**Purpose:** Full playback surface for a lecture.
**Layout (teal `#1f4a42` full-bleed, faint concentric motif top):**
- **Top bar:** minimize/collapse chevron-down icon (returns to mini-player) on the right control slot is the leftmost button here is the "minimize" — actually: left button = collapse (line/handle), center label "شرح الأصول الثلاثة", right = overflow (⋮). *(See file for exact placement.)*
- **Artwork emblem:** 148px rounded tile (`#16352f`, radius 30) with nested rotated-square rhombi in brass — calm, no photo.
- **Title block (centered):** eyebrow "الدرس الخامس" (brass 11), title Amiri 25/700 ("باب الأصل الأول: معرفة الله"), sheikh (`#a9bdb6`).
- **Waveform:** ~48 thin bars, played portion (62%) brass `#c9a463`, remaining `rgba(223,231,227,.22)`; tap to seek. Current time ١٨:٤٢ (brass) and duration ٣٠:١٥ below.
- **Transport row (centered):** back-10s (circular-arrow icon + "١٠"), 78px brass round play/pause, forward-10s.
- **Bottom utility bar (absolute, 26px from bottom):** **playback speed** chip (cycles ٠٫٧٥× ١٫٠× ١٫٢٥× ١٫٥× ٢٫٠×), **download** chip, **minimize** icon-button. All on `rgba(255,255,255,.07)`.

### 4. Admin — Upload lecture — `screens/لوحة التحكم - رفع محاضرة.dc.html`  (1440 × 900, desktop web)
**Purpose:** Content manager uploads a new audio lecture and files it into the section tree. Denser than the student app but same calm identity.
**Layout:** RTL two-pane app shell.
- **Sidebar (right, 252px, teal):** logo + "لوحة الإدارة", nav (لوحة المعلومات، المحاضرات [active, brass-tint], الأقسام والشجرة، المشايخ، التعليقات، الإعدادات), user chip pinned bottom. Active item = `rgba(201,164,99,.16)` bg + brass rhombus.
- **Topbar (64px, `#f8f3e8`):** breadcrumb "المحاضرات / رفع محاضرة جديدة", notifications + avatar.
- **Content (scroll, 30px padding):** page title (Amiri 27/700 teal) + subtitle; top-right actions "إلغاء" (outline) + "حفظ المحاضرة" (teal). Then a **two-column grid: `1fr 320px`**.
  - **Left column — three cards:**
    1. **المعلومات الأساسية:** عنوان المحاضرة (text input, 46px, radius 12, focus → border `#2c6157` + `0 0 0 3px rgba(31,74,66,.1)`); **ملف الصوت** uploaded-state row (teal waveform tile, filename, "٢٤٫٨ ميجابايت · ٣٠:١٥ دقيقة · تم الرفع", remove ✕).
    2. **التصنيف والترتيب:** **searchable nested-tree dropdown** for القسم/العنصر الأب (see Interactions); **رقم الترتيب** (140px numeric, centered, Arabic numerals); **اسم الشيخ** (select-style).
    3. **المرفقات:** dashed-brass dropzone ("اسحب الملفات هنا أو تصفّح الجهاز", "PDF، Word، صور · بحد أقصى ١٠ ميجابايت للملف") + an attached-file row (تفريغ-المحاضرة.pdf).
  - **Right rail (sticky, 320px):**
    - **حالة النشر:** segmented control **مسودة / منشورة** (Draft/Published); selected segment = white (draft) or teal (published) with shadow. A status note + colored dot updates with the choice. Meta (created/modified dates), primary submit button whose label switches **"حفظ كمسودة" ↔ "نشر المحاضرة"**, and a "معاينة" outline button.
    - **Tip card** (dashed brass) about matching order number to lesson sequence.

---

## Interactions & Behavior

- **Play/pause is shared state.** On Home, both the feature card and the fixed mini-player reflect and toggle a single `playing` boolean. The player screen and section in-progress rows use the same brass play ▸ / pause ❚❚ glyph language.
- **Searchable tree dropdown (admin):** clicking the field toggles an overlay (field border → `#2c6157`). The overlay has a search input that **filters the flat-rendered tree by node name or ancestor path**; nodes are indented by depth (`padding-right: 12 + depth*20 px`), depth-0 nodes use a filled teal rhombus bullet, deeper nodes a brass ring. Selecting a node sets the value, closes the overlay, clears the query. The field shows the full **breadcrumb path** as chips (e.g. العقيدة › التوحيد › الأصول الثلاثة) with the leaf emphasized in a teal-tint pill.
- **Publish segmented control (admin):** toggles `published`; drives segment styling, the status-note text + dot color (`#b0894f` draft / `#1f8a5b` published), and the submit button label.
- **Playback speed (player):** chip cycles through 5 speeds.
- **Waveform seek (player):** tap to set position (stub in prototype).
- **Horizontal scrollers:** CSS scroll-snap (`scroll-snap-type: x mandatory`), hidden scrollbars, RTL start-aligned.
- **Hover/focus (desktop admin):** inputs show focus ring (above); primary buttons darken slightly; nav/list rows get a subtle tint. Define matching `:hover` states in production for the web dashboard. On mobile, suppress tap highlight (`-webkit-tap-highlight-color: transparent`).
- **Transitions:** keep short and calm — ~.15s ease on borders, segment, and button color changes. No bouncy/playful motion.

## State Management

- **Player:** `playing: boolean` (shared home card ↔ mini-player), `speedIdx` (player), `position` (waveform/seek).
- **Section page:** lecture list with per-item `status: 'new' | 'playing' | 'completed'` and `ts` (resume timestamp); section `progress` (% + completed/total). Template is data-driven and reused at every tree level — feed it `{ title, description, sheikh, lectureCount, progress, subsections[], lectures[] }`.
- **Admin upload form:** `title`, `audioFile`, `parentSectionId` (+ derived breadcrumb path), `order`, `sheikh`, `attachments[]`, `published: boolean`. Tree dropdown holds `treeOpen`, `query`, `selectedId`. Submit label/behavior derive from `published`.
- **Data fetching (production):** section tree, lectures per node, resume positions per user, upload (multipart audio + attachments) endpoints. The tree must support arbitrary nesting; the section page and the admin parent-picker both consume it.

## Assets

- **No raster images or photos.** All "artwork" is the geometric rhombus/concentric-circle motif drawn in CSS — reproduce with views/SVG in the target framework.
- **Fonts:** Amiri + IBM Plex Sans Arabic (Google Fonts). Bundle them or use the platform equivalent; both are open-source.
- **Icons:** Feather/Lucide-style stroke icons (search, bell, chevrons, download, file, upload, more, skip-10, music note). Use the codebase's icon set.
- No third-party logos or brand assets are used.

## Files

| File | Screen | Canvas |
|---|---|---|
| `screens/رواق العلم.dc.html` | Home | 390 × 844 |
| `screens/صفحة القسم.dc.html` | Section page (reusable) | 390 × 844 |
| `screens/مشغل الصوت.dc.html` | Full-screen audio player | 390 × 844 |
| `screens/لوحة التحكم - رفع محاضرة.dc.html` | Admin — upload lecture | 1440 × 900 |
| `screens/support.js` | Prototype runtime — **reference only, do not ship** | — |

Each `.dc.html` contains its markup inline-styled plus a small `Component` logic class (state + computed values). Read those classes for exact interaction logic; read the inline styles for exact values. Open any file in a browser to see the live reference.
