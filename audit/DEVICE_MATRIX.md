# Device matrix (PLAN_AUDIT Phase 0, task 5)

The minimum matrix the audit must cover (PLAN_AUDIT §Phase 0 + §Phase 11.4), what is
available today on this machine, and the gaps. Emulator/simulator results are **not**
sign-off evidence for audio focus, push, lock-screen controls, or RTL-restart behavior
(PLAN_AUDIT standing risks) — those rows need the physical devices.

## Required targets → availability

| # | Matrix target | What we have today | Status / gap |
|---|---|---|---|
| 1 | iPhone SE-class (320pt width, small) | none installed | **Gap** — add an iPhone SE (3rd gen) simulator (`xcrun simctl create`), or nearest small runtime available in Xcode 26 |
| 2 | iPhone Pro-Max-class (large) | iPhone 17 Pro Max simulator (iOS 26) | Ready |
| 3 | iPhone baseline (audit workhorse) | iPhone 17 Pro simulator (iOS 26) — Phase 0 boot target | Ready |
| 4 | iPad (app declares `supportsTablet: true`) | iPad Pro 13" (M5), iPad Pro 11" (M5), iPad mini (A17 Pro) simulators | Ready (portrait-lock vs multitasking is a Phase 11 item) |
| 5 | iOS 16 (deployment target 16.4) | only iOS 26 runtime installed | **Gap** — download the oldest available iOS 16.x simulator runtime in Xcode, or accept-and-record if Apple no longer ships it |
| 6 | iOS latest | iOS 26 runtimes (Xcode 26.6) | Ready |
| 7 | Flagship Android (new OS) | Pixel_10_Pro AVD — API 37 (Android 16), arm64, Play images | Ready (Phase 0 boot target) |
| 8 | Small / Go-class Android (720×1280, low RAM) | none | **Gap** — create a 720×1280 / 320dpi AVD with 2GB RAM (V16's small-emulator profile: this class caught real bugs before) |
| 9 | Android 10 (API 29) | none | **Gap** — create an API 29 AVD (x86_64/arm64 image download) |
| 10 | Android 15 (API 35) | none | **Gap** — create an API 35 AVD |
| 11 | **Physical Android** (audio focus, Doze, push, Bluetooth) | Samsung `R5CX10P3BPL` (One UI) was the historical test phone — presence on this Mac unverified | **Gap** — confirm with owner which physical Android is available; required for Phases 5, 9, 11 |
| 12 | **Physical iPhone** (push, background audio, RTL first launch) | none registered | **Gap** — required for Phases 5, 9, 13 (IOS_SUBMISSION device-check list, F-019) |

## Phase 0 boot verification (three targets)

| Target | Result |
|---|---|
| Web (admin surface) — Metro at `http://localhost:8081` | see `audit/reports/phase-0.md` |
| iOS simulator — iPhone 17 Pro, dev build via `expo run:ios` | see `audit/reports/phase-0.md` |
| Android emulator — Pixel_10_Pro (API 37), dev build via `expo run:android` | see `audit/reports/phase-0.md` |

## Standing notes

- Both native targets build **dev clients** (custom native code: patched expo-audio built
  from source, custom `AppDelegate.swift` RTL, floating-bubble module) — Expo Go is never
  a valid target for this app.
- The Android emulator runs arm64 system images on Apple Silicon; per-ABI split builds
  (F-021) only matter for release APK distribution, not for these dev builds.
- When the F-002 staging project exists, matrix devices should point at staging; today
  boots run against production as read-mostly normal app usage (no seed/chaos writes).
