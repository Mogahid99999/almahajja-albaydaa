# خطة المشروع — منصة دروس العلم الشرعي (رِواق العِلم)

Build plan derived from `sharia_app_prd_mvp_aligned.pdf` (PRD v1.0) + `CLAUDE.md` + the
`screens/` and `ds-bundle/` design references. This document is sized to the **full
product**: it covers what we build now (the approved MVP) and the phases deferred to
later, with the seams that keep deferred features from forcing a redesign.

---

## 1. Scope, straight from the PRD

The PRD §3 ("نطاق التنفيذ المعتمد") + §25 ("أهم مميزات التطبيق") define what is **in
scope for v1**. Everything in §26 and the "خارج النطاق / النسخة الثانية" list is
**deferred**.

### ✅ In scope (build now — MVP)
1. **Nested sections/items tree** — a node holds sub-sections, lectures, or both, to
   arbitrary depth (العقيدة → التوحيد → كتاب التوحيد → دروس). One reusable section page
   renders at every level. (PRD §4, §5)
2. **Optional per-level header** — name, description, sheikh(s), lecture count, progress
   %, optional cover; admin toggles visibility per node. (PRD §6)
3. **Sheikh chips** — shown clearly above the lecture list, not repeated per row. (§7)
4. **Listening experience** — tap a lecture → plays immediately; mini player; full
   player; resume from last position; download button per lecture; speed / ±10s in the
   full player. (§8)
5. **Lecture states** — not-started / in-progress ("متابعة من ٢٢:١٠") / completed
   (✓ at ≥90% listened). (§9)
6. **Offline download** — idle / downloading / downloaded / delete; dedicated
   "المحاضرات المحملة" page. (§10)
7. **Personal progress** — per lecture, per section, per item; never compared between
   students. (§11)
8. **Direct admin upload** — title, audio file, parent section, order #, sheikh,
   attachments slot, publish status (draft/published). (§14.1)
9. **Unclassified/review queue** — "غير مصنفة" status built now so the deferred Telegram
   bot drops into the same review→classify→publish path with no redesign. (§14.2, §28)
10. **Extended web admin panel** — manage sections/tree, lectures, unclassified queue,
    users; basic stats placeholders. (§15.1)
11. **Simple roles** — student / admin. (§16)
12. **"عن المنصة / الدعاء" page** — prominent, asks for du'a for the scholars and
    contributors; also surfaced as a small card on Home. (§23)
13. **Home** — resume card, newly-added rail, sections grid, du'a card, mini player. (§24)
14. **Arabic-first RTL**, Arabic-Indic numerals, calm manuscript design, no gamification.

### ⏳ Deferred (design seams left, not built now)
- Telegram ingestion bot → feeds the **same** unclassified queue. (§14.2)
- Quizzes tied to a section/item (MCQ first). (§12)
- Attachments as a system (PDF/كتاب/تفريغ/صورة/رابط) on any node or lecture. (§13)
- Notifications (new lecture/quiz/attachment, resume reminders). (§17)
- Weekly goals + personal streak/مداومة, simple badges, "رحلتي العلمية". (§18–22)
- Admin mini phone panel. (§15.2)
- Daily streak (§26.1), study companion رفيق الدراسة (§26.2), roadmap (§26.3),
  onboarding screen (§26.4).
- Content supervisor role, certificates, community, comments, competitions,
  auto-summary, transcription, complex permissions.

---

## 2. Architecture

Expo (SDK 56) + Expo Router, TypeScript strict, Supabase (Auth/DB/Storage), Zustand
(player + downloads UI state), TanStack Query (server state). All data access goes
through `src/api/*`; components never touch `supabase` directly.

### Mock-data mode (now)
- `src/config.ts` exposes `USE_MOCK` (currently **true**).
- `src/mock/*` holds a deterministic in-memory dataset (sections tree, lectures,
  sheikhs, per-user progress, downloads) plus playable sample audio URLs.
- `src/api/*` branch on `USE_MOCK`: same function signatures, mock results now / real
  Supabase later. Flipping the flag to `false` switches the whole app to the live
  backend (schema + RPCs already exist in `supabase/migrations/0001_initial_schema.sql`).
- **Auth is real Supabase** (so email password-reset works). Mock sign-in also accepts
  the two demo accounts so emulator testing never blocks on email delivery.

### Deferred-feature seams (so §26 etc. don't force a redesign)
- Lectures carry a `status` enum already including `unclassified` (alongside
  draft/published) → bot + review queue reuse it.
- Section/lecture rows are data-driven from one shape `{title, description, sheikh,
  lectureCount, progress, subsections[], lectures[]}` → quizzes/attachments slot in as
  extra optional arrays on a node without touching the renderer.
- Progress is stored per (user, lecture); rollups are server-side recursive CTEs →
  weekly goals/streak read the same progress events.

---

## 3. Demo accounts & environment
- `admin@gmail.com` / `test55%%` → admin (web dashboard at `localhost` via `expo start --web`).
- `user@gmail.com` / `test55%%` → student (Android emulator).
- Password reset via email → `supabase.auth.resetPasswordForEmail`.
- Supabase project `prpyxnxgkpspjoxvcaro`; keys + PAT in `.env` (gitignored).
- Seed/refresh the two accounts any time: `node scripts/seed-auth.mjs`.

---

## 4. Execution phases

### Phase 0 — Foundation (serial, shared by every screen)
- Fonts (Amiri + IBM Plex Sans Arabic) loaded at root.
- `src/lib/format.ts` — Arabic-Indic numerals, durations (mm:ss), percentages, dates.
- `src/components/ui/*` — shared primitives: `Rhombus`/`Motif`, `Card`, `ProgressBar`,
  `IconButton`, `SectionHeader`, `Pill`, `ScreenScroll`, `StatusDot`, `Logo`.
- `src/config.ts` + `src/mock/*` + `src/api/*` wired to mock.
- `src/lib/audioController.ts` (single expo-audio owner) + finalized `playerStore` +
  `src/components/MiniPlayer.tsx` (consumed by Home/Section).
- Auth: mock sign-in + real reset; root-layout gating routes auth/student/admin.

### Phase 1 — Screens (parallel agents, file-disjoint)
- **Home** — `app/(student)/index.tsx` + `src/components/home/*`.
- **Section page** (recursive) — `app/(student)/section/[id].tsx` + `src/components/section/*`.
- **Player (full)** — `app/player/[id].tsx` + `src/components/player/*` (consumes the
  shared audio controller).
- **Admin dashboard** — `app/admin/*` (dashboard, upload form, tree manager,
  unclassified queue) + `src/components/admin/*`.
- **Downloads + About + Profile** — `app/(student)/{downloads,about,profile}.tsx` +
  downloads store wiring + `src/components/downloads/*`.

### Phase 2+ — Deferred (later)
Telegram bot → unclassified queue; quizzes; attachments; notifications; weekly
goals/streak/badges/journey; admin phone panel; roadmap/companion/onboarding. Flip
`USE_MOCK=false` to run on the live Supabase backend.

---

## 5. Design fidelity
High-fidelity recreation of `screens/*.dc.html` using the tokens in
`src/constants/theme.ts` (synced from `README.md` / `.design-sync`). RTL everywhere,
Arabic-Indic numerals, geometric rhombus/concentric motif instead of imagery, soft
brand-tinted shadows only, calm transitions (~.15s), no gamification.
