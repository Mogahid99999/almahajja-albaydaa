# V16 — Small-screen responsive audit & fixes (student app)

Read `CLAUDE.md` first, then the memory index (`memory/MEMORY.md`) and load any
memory that looks relevant (especially the RTL/layout ones). This is an Expo SDK
56 app, Arabic **RTL**, Supabase backend.

## The problem (reported by the owner)

On **small screens**, some screens have UI defects: **text clipped/truncated,
elements overlapping, or content overflowing past the screen edges** (horizontal
overflow). The request is to **audit the whole STUDENT app** for this class of bug
and fix it.

### The core requirement (non-negotiable)
Every student screen must be **responsive AND clean on BOTH emulator sizes at the
same time** — the small one (`emulator-5556`, 720×1280) *and* the normal one
(`emulator-5554`, 1080×2400). A fix is only accepted if the screen looks correct
on **both**. Making 5556 fit by shrinking/cramping in a way that then looks wrong
(too sparse, mis-aligned, oversized gaps, stretched tiles) on 5554 is a FAILURE,
not a fix. Treat both sizes as first-class targets and screenshot **both** after
every change. The goal is one fluid layout that adapts, not a small-screen
special case that regresses the normal size.

There is **no admin/sheikh work in this pass** — student app only. (The owner's
original tile example happened to be an admin screen; ignore admin here and apply
the same *idea* to the student screens.)

**A second owner example — the `(auth)/register.tsx` screen on a real small phone
(~720px-wide, status bar «mobily 9:08»):** the form itself renders fine (fields
stack cleanly, labels/placeholders are not clipped), BUT the primary
**«إنشاء حساب» submit button is only half-visible, peeking at the very bottom
edge**, with النوع (ذكر/أنثى) being the last fully-visible row. This is the exact
class of defect to hunt: on a **short viewport** the last element(s) get cut off
because the screen either doesn't scroll far enough, lacks bottom padding/safe-area
clearance, or an inner container has a fixed height. So the audit is NOT only
about horizontal overflow and mid-word clipping — it's also **vertical: can the
user actually reach and tap the last control (submit buttons, toggles, links) on a
short screen?** Every form/CTA screen must be fully scrollable to its last
interactive element with comfortable bottom clearance above the system nav bar.

**Scope for this pass: the STUDENT app only** (the `app/(student)/*` screens, the
full-screen player `app/player/[id].tsx`, the `(auth)` screens, and every shared
component they use under `src/components/*`). Do NOT spend time on the `admin/*`
or `sheikh/*` screens in this pass unless a shared component you're fixing is
also used there (then just don't regress them).

## Environment — two emulators are already running

`adb` is at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` (NOT on PATH —
use the full path, or the Bash form
`"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"`). Two emulators are
attached:

| Device | Size | Density | Role |
|---|---|---|---|
| `emulator-5554` | 1080×2400 | 420 | normal modern phone (baseline / "should look fine") |
| `emulator-5556` | **720×1280** | **320** | **the SMALL screen — this is where you reproduce & verify fixes** |

The app package is **`com.riwaqalilm.app`**. It is currently installed on
`emulator-5554` but **NOT on `emulator-5556`**, and there is no prebuilt APK.
**First task: get the app running on the small emulator (5556).** Cheapest paths,
in order:
1. Start Metro once (`npx expo start` — dev server; do NOT use `--web`, this is a
   native RTL bug that won't reproduce faithfully in the browser), then install/run
   the dev build on 5556. If a dev client isn't installed there, use
   `npx expo run:android --device emulator-5556` (this builds+installs; slow the
   first time — the native build recipe/OOM caveats are in the
   `android-release-build-recipe` memory).
2. Or, if a fresh release APK already exists later, `adb -s emulator-5556 install -r <apk>`.
   Either way, **always target the small emulator explicitly with `-s emulator-5556`**
   — two devices are attached, an un-targeted adb command errors or hits the wrong one.

Sign in as the **student test account**:
- email: `dffallacanan6@gmail.com`
- password: `12345678`

(Native is guest-first; you may need to open the sign-in screen from the profile/
"إنشاء حساب"/sign-in entry to log in as this real student rather than staying a guest.)

### Driving + capturing the emulator
- Screenshot: `adb -s emulator-5556 exec-out screencap -p > shot.png` then **Read the
  PNG and actually look at it** — a responsive bug is visual; don't declare a screen
  "fine" without looking.
- Tap / swipe / type / back: `adb -s emulator-5556 shell input tap X Y` /
  `input swipe ...` / `input text '...'` / `input keyevent KEYCODE_BACK`.
- After a JS edit, Metro fast-refreshes; re-screenshot to confirm.

## What to check on every student screen (the checklist)

For each screen below, on **emulator-5556**, look for:
1. **Horizontal overflow** — the page body must never scroll sideways or have
   content cut off at the start/end edge. Wide rows (stat tiles, chip rows,
   filter rows, tables) must wrap or scroll inside their own container, not push
   the layout.
2. **Text clipping/truncation** — Arabic labels cut mid-word, `numberOfLines`
   hiding meaningful text, a number/label overflowing its card. Long lecture/
   section titles and long display names are the usual triggers.
3. **Overlap** — absolutely-positioned controls (player controls, mini-player,
   bottom nav, badges) sitting on top of text; two flex children colliding when
   there's less width.
4. **Off-screen / unreachable controls** — a button pushed past the edge, or
   under the bottom nav bar / mini-player, on a short viewport.
5. **Fixed widths / hardcoded pixel sizes** that don't fit 720px-wide — prefer
   `flex`, `flexWrap`, `maxWidth: '100%'`, relative units.
6. **Last control reachable on a SHORT viewport (vertical)** — scroll each
   form/CTA screen to the very bottom and confirm the final button/link/toggle is
   fully visible and tappable, clear of the system nav bar. The register screen
   above failed exactly here (submit button half-cut at the bottom). Screens that
   don't scroll (fixed `<Screen scroll={false}>`, a centered `justifyContent`, or
   a `KeyboardAvoidingView` that shrinks the frame) are the prime suspects — with
   the keyboard OPEN too, since the app is edge-to-edge and the keyboard overlays.

### Student screen inventory (drive each one)
- `index.tsx` (Home: header, ContinueCard, NewlyAddedRail, FeaturedRail,
  StreakCard, BuddyCard, SectionsGrid, QuestionsHomeCard, JourneyHomeCard,
  DuaCard, SupportContactLink)
- `section/[id].tsx` (nested section page + lecture rows + quiz cards)
- `player/[id].tsx` (full player — long titles are a known tight spot; controls
  are absolute-positioned)
- the **MiniPlayer** + **BottomNavBar** (shared, overlay everything — check they
  don't cover content or clip on short height)
- `journey.tsx`, `recent.tsx`, `featured.tsx`, `downloads.tsx`
- `questions.tsx` + shared `QuestionsBoard` (composer, tabs, chip rows, the inline
  edit editor added in V14)
- `lecture-questions/[id]`, `lecture-benefits/[id]`, `lecture-note/[id]`
- `quiz/[id]`, `quiz-attempt/[attemptId]`, `quiz-result/[attemptId]`
- `notifications.tsx`, `search.tsx`, `about.tsx`, `sheikh-info.tsx`
- `profile.tsx`, `edit-profile.tsx`, `buddy-search.tsx`, `reminder/[id]`
- `(auth)/sign-in.tsx`, `(auth)/register.tsx`, `(auth)/reset-password.tsx`

## Repo-specific gotchas you MUST respect (don't fight these)

- **Forced RTL with `swapLeftAndRightInRTL(false)`** (`app/_layout.tsx`): left/
  right styles stay **physical** (`right:0` = right edge, `textAlign:'right'` =
  right edge). BUT there's a confirmed rendering quirk the code works around: for
  a box **wider than its content**, `textAlign:'right'` renders flush LEFT and
  `'left'` flush RIGHT. See `src/components/ui/Txt.tsx` and the
  `visualRightTextAlign = 'left'` constant in `(auth)/sign-in.tsx`. When you touch
  text alignment, follow the existing pattern — don't naively "correct" it or you'll
  mirror text to the wrong edge. Verify alignment visually after any such change.
- **`arNum` / `toArabicDigits`** — all user-facing numbers render as Arabic-Indic
  digits via `src/lib/format`. Keep using them.
- **MiniPlayer + BottomNavBar clearance** — screens pad their bottom via
  `useMiniPlayerPad()` + `BOTTOM_NAV_CLEARANCE`. If content is hidden behind them
  on a short screen, fix via that padding mechanism, not a magic number.
- **Data access only through `src/api/*`**; components never call `supabase`
  directly. This pass is UI-only — you shouldn't need migrations. If you somehow
  do, they're append-only from `0082`, applied to the live DB via the Management
  API with a browser User-Agent (see the `supabase-mgmt-api-cloudflare-ua`
  memory) + `node scripts/security-check.mjs` must stay 20/20.
- Keep the calm, non-competitive, RTL Arabic tone and the muted palette.

## How to work

1. **Reproduce first.** Log in on 5556, walk every screen, screenshot, and build
   a concrete list of the actual defects (screen → what's wrong). Don't guess from
   code — the emulator is the source of truth. Report this list before mass-editing.
2. **Fix by making layouts fluid**, not by special-casing 720px: `flexWrap` on
   tile/chip rows, `flex:1` + `numberOfLines` + `flexShrink` on text that shares a
   row, `maxWidth:'100%'` on wide media, `overflow-x` scroll containers for
   genuinely wide content (tables). Prefer fixing the **shared component** once
   (e.g. a stat-tile or chip-row component) over patching each screen.
3. **Verify each fix on BOTH sizes.** After every change, screenshot the screen
   on **5556 AND 5554** and look at both — the fix passes only if both are clean
   (no overflow/clipping/overlap on 5556, no regression/awkward stretching on
   5554). `npx tsc --noEmit` must stay clean.
4. Work screen-by-screen; keep a running todo list. When done, give the owner a
   summary: which screens had defects, what each fix was, and before/after
   screenshots **from both sizes**.

## Definition of done
- Every student-facing screen listed above walked on **both** `emulator-5556`
  (720×1280) **and** `emulator-5554` (1080×2400), and looks responsive + clean on
  **both simultaneously**: no horizontal overflow, no clipped/overlapping text, no
  off-screen or unreachable controls (incl. the last submit/CTA on short screens),
  and no small-screen fix that regressed the normal size.
- `npx tsc --noEmit` clean.
- A short written report (defects found → fixes made) + sample screenshots from
  both sizes.
- Update memory with a V16 responsive-fixes note.

NOTE: student-only pass (do NOT touch admin/sheikh screens), and audit against the
real emulators — this is a visual bug, so "it typechecks" is not verification;
looking at the screenshots on BOTH the 720×1280 and 1080×2400 screens is.
