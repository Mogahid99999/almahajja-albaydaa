# Phase 0 report — Baseline, environment, and audit infrastructure

**Date:** 2026-07-14 · **Branch:** `audit/phase-0-baseline` · **Executor:** Claude (Fable 5)
**Scope (PLAN_AUDIT §Phase 0):** environment, docs, tooling — no feature auditing.

## Outcome: complete — all exit criteria met

| Exit criterion | Result |
|---|---|
| App boots on all three targets | ✅ **Android** Pixel_10_Pro emulator (API 37): dev build compiled (1m40s, patched expo-audio Kotlin included), installed, Home renders RTL with live data. **iOS** iPhone 17 Pro simulator (iOS 26): build 0 errors, Home renders RTL with live data + guest nudge. **Web**: Metro serves `/`; headless-Chrome screenshot shows the sign-in screen rendering (correct unauthenticated-web routing) — GLITCH_LOG #14's total web crash is confirmed fixed by the react-native-web patch. Screenshots in the session log. |
| Typecheck clean | ✅ `npm run typecheck` — no errors (re-run after all Phase-0 edits). |
| All historical docs read | ✅ GLITCH_LOG.md, PLAN.md, all 17 PLAN_*.md, IOS_SUBMISSION.md, LANDING_PAGE_PLAN.md, plus the three PROMPT-only batches (V14, V16, V17). The 8 remaining PROMPT_*.md files were verified to be thin kickoff wrappers around their PLAN files. |
| Findings log operational | ✅ `audit/FINDINGS.md` seeded with **24 findings** (F-001…F-024): 5 fixed in-phase, 19 open leads routed to their phases. |

## Task-by-task

1. **Install/typecheck/doctor.** `npm install` ✔ (11 moderate audit vulns → F-005).
   `npm run typecheck` ✔ clean. `npx expo-doctor` 20/21 — the failing check is dependency
   versions: gesture-handler **3.0.2 vs expected ~2.31.1** (major → F-003) + 4 patch-level
   lags (F-004).
2. **Boot + env.** Three-target boot verified (table above). `src/lib/env.ts` fail-fast
   wiring confirmed; `.env` holds client keys + Management-API secrets for the **production**
   project only — **no staging project exists (F-002, P1)**: this is the blocking
   prerequisite for Phase 2's live verification; owner action requested. Seed scripts
   verified env-driven (`SEED_PASSWORD` required, no hardcoded passwords — PLAN_SECURITY
   S0.2 held) and were **not** run (production-only environment).
3. **Historical-doc mining.** All known-issue/deferred/TODO material extracted into
   FINDINGS (F-013…F-023): demo-account cleanup still open (F-013), CLI migration-history
   gap (F-015), ogg-on-iOS (F-016), admin/sheikh small-screen debt (F-017), unshipped
   Resend email leg (F-018), unverified iOS device-check list (F-019), hardcoded
   sheikh-name override UUID (F-020), ABI-split direct-APK risk (F-021), buddy-search
   perf lead (F-022), bubble-inertness check (F-023).
4. **Code TODO grep.** Only three real markers in the whole tree (F-010 Android RTL
   native enforcement — P1 lead for Phase 1; F-011 section-nav search stub; F-012 admin
   pagination cap). Notably clean.
5. **Scaffolding.** `audit/FINDINGS.md`, `audit/reports/`, `audit/DEVICE_MATRIX.md`
   created. Matrix: 6 targets ready today (iPhone 17 Pro/Max, 3 iPads, Pixel_10_Pro
   API 37) and 6 gaps (SE-class sim, iOS 16 runtime, Go-class/API 29/API 35 AVDs,
   physical iPhone + Android — physical devices are mandatory for Phases 5/9).
6. **Doc rot fixed.** CLAUDE.md: "out of scope" section replaced with the real shipped
   baseline (quizzes/notifications/journey/community/etc.), 90%→95% completion threshold,
   Supabase+R2 storage reality, accurate project layout (F-008). `profile.tsx` header
   rewritten to describe the actual settings hub (F-009).
7. **Patches.** **Found broken (F-001, P1): `npm install` was silently building unpatched
   expo-audio** — `core.autocrlf=true` (Windows-era) checked patches out CRLF so no hunk
   matched, and node_modules held a stale half-patched state (the newest audio-focus
   hunks had never applied on this machine). Fixed: `.gitattributes` pins `*.patch -text`,
   patches restored to LF, node_modules restored to pristine+patch (verified byte-identical
   against a pristine npm tarball + the committed patch; apply is idempotent). Full fork
   dossier for Phase 5: `audit/EXPO_AUDIO_PATCH.md`.

## Fixes landed this phase (all doc/infra — no product code paths touched)

- `.gitattributes` (new) — patch line-ending pin (F-001).
- CLAUDE.md scope/stack/layout rewrite (F-008).
- `app/(student)/profile.tsx` header comment (F-009) — comment-only change.
- `audit/` scaffolding: FINDINGS.md, DEVICE_MATRIX.md, EXPO_AUDIO_PATCH.md, reports/phase-0.md.
- Environment (non-repo): stale pre-session `expo start --web` on :8081 killed (F-007);
  node_modules/expo-audio repaired via patch-package.

## Risks carried forward

- **F-002 (no staging)** blocks Phase 2 as specced — needs the owner to create a staging
  Supabase project; applying migrations 0001–0087 to it doubles as the Phase-2 replay test
  (F-015).
- **Physical devices** (audio focus, push, RTL restart) are not yet attached — Phases 5
  and 9 cannot sign off on emulators alone (F-019).
- **gesture-handler major mismatch (F-003)** may surface as subtle gesture bugs in
  Phases 1/5 — treat any gesture anomaly there as possibly dependency-level.
- Boots ran against production as normal read-mostly app usage; no writes were seeded.

**Next:** Phase 1 — root shell & cross-cutting runtime (`app/_layout.tsx`).
