# Production sign-off report — منصة دروس العلم الشرعي

**Date:** 2026-07-17
**Scope:** PLAN_AUDIT.md Phases 0–13, this session closing 9–13.
**Recommendation: CONDITIONAL GO** — no open P0, two open P1 leads (both
device/ops, not code), one durable-tracking gap on native config that must be
resolved before the *next* clean checkout ships.

---

## 1. Per-phase status

| Phase | Status | Notes |
|---|---|---|
| 0 | Done | Baseline, doc-rot fixed, staging Supabase created |
| 1 | Done | Root shell/gates audited, Android RTL native patch applied (untracked, see §5) |
| 2 | Done | RLS/RPC/Edge Function matrix built and verified live on staging |
| 3 | Done | Auth/identity lifecycle audited |
| 4 | Done | Content browsing/discovery audited |
| 5 | Done (code-level) | Player state machine + patch dossier; device pass **deferred** (owner confirmed player works on real devices; nothing device-dependent executed) |
| 6 | Done | Journey/streak math, incl. a real day-attribution split-brain fix (F-043) |
| 7 | Done | Community/UGC, anonymity verified at the network layer |
| 8 | Done | Quiz integrity |
| 9 | Done (static) | Notifications/engagement — physical-device push/permission verification deferred, no device available that session |
| 10 | Done | Admin web + upload pipeline, incl. R2-orphan fix (F-1000) |
| 11 | Done (mixed) | Memory/a11y static sweep + fixes; one physical Android device pass (debug build); full device-matrix execution deferred |
| 12 | Done | Jest + RNTL test infrastructure, CI wired |
| 13 | Done (this session) | Release-config lint script written and run against a **real signed release AAB**; privacy manifest gap found and fixed (untracked, see §5); migration/FK/npm-audit hygiene re-verified |

## 2. Open P0/P1 register

Only two open P0/P1-severity items remain in `audit/FINDINGS.md`, and neither
is a code defect found or left unfixed by this audit — both are
operational/device leads that predate and survive the audit:

- **F-013** (P1 lead) — seeded demo-account credentials are permanently
  burned (readable in 8 committed historical docs + git history). Action
  needed from the owner: delete or re-password any account still using
  `test55%%`, independent of any code change.
- **F-019** (P1 lead) — the entire iOS physical-device checklist is
  unexecuted; no iOS hardware was available in any audit session. This is a
  coverage gap, not a known bug — flagged as a hard blocker for iOS release
  specifically (Android has real device coverage from Phases 5 and 11;
  iOS has none).

No other P0/P1 is open. 43 findings fixed, 4 wontfix (documented/accepted
risk), 56 open (mostly P2/P3 polish, a few explicit product decisions
awaiting the owner — e.g. F-1003 quiz-delete-with-attempts behavior).

## 3. Release-config lint — VERIFIED against a real build

`scripts/release-check.mjs` (new this session) was run both at the source
level and against an actual **signed release AAB** built this session
(`android/app/build/outputs/bundle/release/app-release.aab`, extracted
`index.android.bundle`, Hermes bytecode v98, string-scanned via `strings`):

```
PASS  USE_MOCK is false
PASS  NOTIF_TEST_MODE is false
PASS  BUBBLE_ENABLED is false
PASS  DEMO_ACCOUNTS gated behind USE_MOCK
PASS  no hardcoded Supabase URLs outside env.ts
PASS  no hardcoded Supabase secret/service-role key literals
PASS  bundle does not contain literal DEMO_ACCOUNTS credentials
PASS  bundle does not contain "NOTIF_TEST_MODE":true
```

The bundle embeds only the **production** Supabase URL
(`prpyxnxgkpspjoxvcaro.supabase.co`), not staging — confirms `.env` (not
`.env.staging.local`) was used, as it should for a release build. This is
real evidence, not inference from source: dead `USE_MOCK ? {...} : undefined`
branches are confirmed absent from the actual shipped bytecode (Metro/Hermes
constant-folds the literal-boolean branch away).

## 4. Store compliance

- **Account deletion (5.1.1(v)):** `supabase/functions/delete-account`
  re-verified this session — every `auth.users` foreign key across all 90
  migrations carries an explicit `on delete cascade` or `on delete set null`
  (confirmed via `grep -rn "references auth.users" | grep -v "cascade\|set null"`
  → zero orphan-risk tables). Single service-role delete removes the account
  and every personal row transactionally. Admin anti-lockout guard present.
- **iOS privacy manifest — F-1300 (P1, fixed but untracked):** the manifest
  declared only `Name` + `EmailAddress`. Actual collection also includes
  **gender** (`profiles.gender`), **listening/usage data** (progress,
  streaks, journey), and **audio content** (recorded voice notes in Q&A).
  Added `SensitiveInfo`, `ProductInteraction`, `AudioData`, and
  `OtherUserContent` entries. This is a real App-Store-review-risk gap that
  existed before this session — worth flagging to the owner as the single
  most concrete Phase 13 finding.
- **Android backup posture (F-109, open, accepted risk):** `allowBackup=true`
  with no `dataExtractionRules`; private notes/journey/notifications persist
  in plaintext AsyncStorage. Documented as a deliberate product tradeoff
  (offline-first notes is a stated goal) — carried into this sign-off's risk
  register, not re-litigated.
- **`npm audit` (F-005):** 11 moderate vulnerabilities, single root cause
  (`uuid <11.1.1` via `xcode`/`@expo/config-plugins`), confirmed build-time/
  CLI-only — never reaches the shipped bundle. Closed wontfix.

## 5. **Blocking risk: untracked native customizations**

`android/` and `ios/` are both gitignored (`.gitignore:47` region). Two
real, applied fixes exist **only on this machine** and will silently
disappear on the next fresh clone / `expo prebuild`:

1. **F-010** — Android RTL native enforcement (`MainApplication.kt`,
   `I18nUtil` call) — applied in Phase 1, confirmed still present.
2. **F-1300** (this session) — the corrected `PrivacyInfo.xcprivacy`.

**This is the single highest-priority action item for the owner before
shipping**, higher-severity than either open P1 lead: either commit tracked
copies of these two native files (or better, wire them through an Expo
config plugin, which survives `prebuild`), or manually reapply both before
every native build. A fresh EAS build today would ship *without* either fix.

## 6. Versioning / build coherence

- `app.json`: `version` 1.0.1, iOS `buildNumber` 3, Android `versionCode` 4.
- `src/lib/version.ts`'s `APP_VERSION` reads `Constants.expoConfig?.version`
  — derived from `app.json`, not hardcoded, so no drift is possible by
  construction.
- A real `bundleRelease` (Android) succeeded this session and produced a
  signed, installable artifact (`app-release.aab`). No EAS/iOS build was
  attempted (no macOS code-signing credentials in scope here) — iOS build
  verification remains an owner action, tied to the F-019 device gap.

## 7. What was NOT done this session (deferred, not waived)

- Live physical-device execution of the Phase 11 device matrix (30-min
  memory soak, full VoiceOver/TalkBack pass, tablet/small-phone/Android-15,
  network chaos injection) — F-1106.
- Release-build cold-start remeasurement — F-1105 (only a debug-build number
  exists, ~16.7s, not representative).
- Any iOS device work at all (F-019) — no iOS hardware available.
- `/code-review ultra` — user-triggered only, not run this session.

## 8. Go/no-go

**Android: conditional go.** Release build succeeds, release-config lint
passes against real output, delete-account/RLS verified, no open P0/P1 code
defect. Condition: fix the untracked-native-file risk (§5) before the actual
ship build.

**iOS: no-go until F-019 closes.** Zero physical-device verification exists
for the iOS-specific surfaces (lock-screen controls, background audio
interruptions, RTL native enforcement equivalence, the just-fixed privacy
manifest itself) — same untracked-file risk applies doubly here since the
fixed manifest only exists locally. Needs at least one physical-device pass
before submission.
