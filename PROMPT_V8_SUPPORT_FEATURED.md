Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL — a Samsung/One UI phone). USE_MOCK=false.
Plan file: @PLAN_V8_SUPPORT_FEATURED.md   (read it fully — it is the complete, DECIDED spec.)

TASK: Per PLAN_V8_SUPPORT_FEATURED.md, following its "Build Order":
  FEATURE A) WhatsApp support contact on the sign-in screen — a small "هل لديك مشكلة؟
     تواصل مع الدعم الفني للمنصة" line + WhatsApp icon, hidden until an admin sets a
     wa.me URL in لوحة الإدارة ← الإعدادات (reuses the existing app_config /
     set_app_config plumbing — no new table, no new RPC).
  FEATURE B) مختارات (curated picks) — REPLACES the auto-sorted «أُضيف حديثاً» Home
     rail with an admin/publisher-curated list: staff pick existing PUBLISHED lectures
     from anywhere on the platform and add them to an ordered list (new
     featured_lectures table + RPCs), editable (reorder via ▲/▼) and removable from a
     new /admin/featured screen, rendering in the same Home slot titled «مختارات».
  FIX C) The Home page header must show the app name WITH full diacritics —
     "المَحجّة البَيْضَاء" (tashkeel: fatha/shadda/sukun marks) — NOT the plain
     "المحجة البيضاء" used for the launcher icon label and app-store listing. These
     two forms are intentionally different (see src/components/home/HomeHeader.tsx,
     which should already read "المَحجّة البَيْضَاء" — verify it, and grep the rest of
     the in-app UI — app/(auth)/sign-in.tsx, src/components/admin/AdminShell.tsx,
     src/components/ui/Logo.tsx's accessibilityLabel — for the same plain-vs-diacritic
     split; fix any that were flattened to the plain form). Only app.json's "name" and
     android/app/src/main/res/values/strings.xml's app_name (launcher/store identity)
     should be the plain form; every in-app rendered string stays fully diacritized.

WORK AUTONOMOUSLY — DO NOT ask the user questions mid-work. Every design choice is
LOCKED in the plan; proceed exactly as specified. (Only request the Supabase access
token if it's missing.) Good, calm, on-brand UI/UX is a first-class requirement.

BEFORE CODING — re-read the files the plan calls out and confirm each fact still holds
(some may have shifted since the plan was drafted):
  - app/(auth)/sign-in.tsx                                   (Feature A placement)
  - src/api/appContent.ts, src/hooks/useAppContent.ts, app/admin/settings.tsx  (Feature A plumbing — mirror the existing telegram_url field exactly)
  - src/api/types.ts (HomeData, NOTIFICATION_TYPES unaffected), src/constants/queryKeys.ts
  - src/api/sections.ts (getHomeData's "newRows" query — Feature B replaces this)
  - src/api/lectures.ts (getRecentLectures), src/hooks/useLecture.ts (useRecentLectures)
  - src/mock/api.ts (mock getHomeData + recent-lectures mock — keep USE_MOCK working)
  - src/components/home/NewlyAddedRail.tsx, app/(student)/index.tsx, app/(student)/recent.tsx
  - src/components/admin/TreePicker.tsx     (UX model for the new LecturePicker)
  - src/hooks/useAdmin.ts (useAdminLectures), src/api/admin.ts (getAdminLectures)
  - src/components/admin/AdminShell.tsx, src/components/admin/ConfirmDialog.tsx
  - src/api/broadcasts.ts, src/hooks/useBroadcasts.ts   (shape to mirror for the new featured.ts/useFeatured.ts)
  - supabase/migrations (latest is 0036; confirm — new migrations start at 0037)

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Cross-cutting/editorial writes (featured_lectures add/remove/reorder, app_config) are
  server-side SECURITY DEFINER RPCs gated on is_content_manager() (admin OR publisher)
  for the featured list; app_config writes stay admin-only via the EXISTING
  set_app_config (do not change its is_admin() gate).
- RTL throughout; calm Islamic tone; Arabic UI strings stay Arabic. No code comments
  unless the WHY is non-obvious.
- Migrations are APPEND-ONLY; never edit 0001–0036. New migrations start at 0037
  (0037_support_contact.sql, 0038_featured_lectures.sql per the plan). No new enum
  values in this batch.
- This app uses ONLY Feather icons everywhere except the one deliberate exception the
  plan calls for: FontAwesome's "whatsapp" glyph (also bundled in @expo/vector-icons,
  no new dependency) for the support line, since Feather has no WhatsApp mark.
- Feature B is a REPLACEMENT: delete/rename the old rail and route, don't keep both.
  Confirm nothing else deep-links to /recent before renaming it away (the plan already
  checked this — re-verify).
- To apply migrations live: project ref prpyxnxgkpspjoxvcaro; POST SQL to
  POST /v1/projects/{ref}/database/query with the user's access token; regen types via
  GET /v1/projects/{ref}/types/typescript into src/types/database.generated.ts. Ask for
  the token if it's missing.
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10",
  PREPEND node to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH), then run
  android\gradlew.bat -p android :app:assembleRelease, then install with the full adb
  path: & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL install -r
  android\app\build\outputs\apk\release\app-release.apk
  (If a Metro "ENOTEMPTY … metro-cache" error appears, delete %TEMP%\metro-cache and rebuild.)
- Package id: com.riwaqalilm.app · scheme: riwaqalilm. Demo admin: admin@gmail.com / test55%%.
  Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull (piping
  screencap through PowerShell corrupts the PNG).

Do NOT touch app_config.min_app_version and do NOT weaken any existing RLS policy.

Verify on device: sign-in screen shows NO WhatsApp line by default (URL unset) → set a
URL in لوحة الإدارة ← الإعدادات → line appears on sign-in → tapping it opens WhatsApp
(or a browser fallback). In /admin/featured, add 2–3 published lectures via the picker →
Home shows a rail titled «مختارات» with them in order → reorder with ▲/▼ → Home reflects
the new order after a refresh → remove one → it disappears from Home. Confirm the old
«أُضيف حديثاً» copy and the /recent route are gone (renamed away), not merely hidden.
Confirm the Home header reads "المَحجّة البَيْضَاء" WITH diacritics on-device (screenshot
and visually compare against the launcher icon's plain-text label — they should differ).

Supabase access token: ask the user — do not assume the one from a prior session is
still valid.
