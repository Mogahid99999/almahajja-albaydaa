# iOS Submission — MY MANUAL STEPS

Everything the code can't do for you, in the order to do it. Nothing in this
pass was device-tested — every item below marked **[device check]** needs you
to confirm it on a real iPhone.

---

## 1) Apple Developer account (one time, ~10 min)

1. Sign in at https://developer.apple.com/account (paid membership required).
2. You do **not** need to create the App ID by hand — the first `eas build`
   registers `com.riwaqalilm.app` and enables its capabilities (including Push
   Notifications) for you when you let EAS manage credentials. If you prefer to
   check manually: Certificates, Identifiers & Profiles → Identifiers →
   `com.riwaqalilm.app` → capability **Push Notifications** should be ✔.

## 2) APNs push key → Expo (one time, ~5 min)

Push here uses **Expo push tokens**, so iOS needs an APNs Auth Key (.p8) in
Expo's credentials — **not** Firebase, **no** GoogleService-Info.plist.

```
npx eas credentials
```

- Platform: **iOS** → profile: **production**
- Choose **Push Notifications: Set up your Push Notifications Key**
- Let EAS **generate a new APNs key** on your Apple account (easiest), or
  upload an existing .p8 (Apple allows max 2 APNs keys per account).

That's the entire iOS push setup — the server fan-out already goes through
Expo's push API, which signs with this key.

## 3) Build

```
# On-device development build (needs your iPhone registered as an internal device):
npx eas build --profile development --platform ios

# Simulator build (quick Mac-only checks — push won't work on simulator):
npx eas build --profile development-simulator --platform ios

# TestFlight / App Store:
npx eas build --profile production --platform ios
npx eas submit --platform ios          # sends the build to App Store Connect
```

Notes:
- iOS deployment target is SDK 56's default (**iOS 16.4**) — nothing to configure.
- The first build will ask to generate a distribution certificate +
  provisioning profile — accept the defaults (EAS-managed).
- `eas submit` will ask you to sign in with your App Store Connect account the
  first time.

## 4) App Store Connect — App Privacy (nutrition label)

App Store Connect → your app → **App Privacy**. Answers derived from the
privacy manifest in app.json + what the app actually stores:

| Question | Answer |
|---|---|
| Do you collect data? | **Yes** |
| **Contact Info → Name** | Collected · **Linked to identity** · Not used for tracking · Purpose: **App Functionality** (display name on the account) |
| **Contact Info → Email Address** | Collected · **Linked to identity** · Not used for tracking · Purpose: **App Functionality** (sign-in) |
| **User Content → Other User Content** | Collected · **Linked to identity** · Not tracking · **App Functionality** (private lesson notes, questions to the sheikh, shared benefits) |
| **Usage Data** | **Not collected** for advertising/analytics — listening progress is App Functionality, stored under the account. If the reviewer form insists on classifying progress, declare **Usage Data → Product Interaction**, linked, App Functionality, no tracking. |
| Tracking (ATT) | **No** — `NSPrivacyTracking=false`, no ads, no third-party analytics. |

Also in App Store Connect:
- **App Review notes**: mention that account deletion is at
  **حسابي (Profile) → حذف الحساب نهائيًا** (visible for registered accounts), and
  provide a test email/password account so the reviewer can try it.
- Sign in with Apple is **not required**: the app offers only email/password
  and a silent guest mode — no third-party/social login (Guideline 4.8 only
  triggers when third-party login is offered).
- Export compliance: already answered in the binary
  (`ITSAppUsesNonExemptEncryption=false`) — no prompt per build.

## 5) Supabase (already done for you)

- Edge Function **`delete-account`** is deployed and ACTIVE (verify_jwt=true),
  version 1. Nothing to do. If you ever redeploy:
  `supabase functions deploy delete-account`.

---

## Per-feature device verification — [device check] all of these

**Push notifications (end to end)**
1. Install a **development** (or TestFlight) build on a real iPhone — push
   never works in the simulator or Expo Go.
2. Launch → accept the notification permission prompt.
3. Confirm the token registered: Supabase Studio → `push_tokens` table → a row
   for your user with `platform = 'ios'` (this was the bug fixed in this pass —
   it used to say `android`).
4. Send a test push: https://expo.dev/notifications → paste the
   `ExponentPushToken[...]` from that row → send with a title/body.
5. Kill the app, send again — notification should arrive; tapping it should
   open the app. Then publish a lecture from the admin panel and confirm the
   real fan-out reaches the iPhone, and that tapping deep-links into the player.

**Background / lock-screen audio**
1. Play a lecture → press the side button (lock). Audio must keep playing.
2. Lock screen + Control Center must show title + sheikh name, play/pause,
   ±10s skip buttons, and a draggable progress bar — all must work.
   (Known iOS difference: **no prev/next-track buttons** on the iOS lock screen —
   the Android media-notification patch doesn't apply to iOS; iOS shows
   skip-±10s instead. Everything else is expo-audio's built-in iOS support.)
3. Flip the silent/ring switch — playback must continue audibly.
4. Receive a phone call mid-playback — audio pauses; after hangup, press play.
5. Unplug/disconnect headphones mid-playback — audio should pause.

**RTL first launch**
1. Delete the app, set the iPhone language to **English**, reinstall, launch.
2. The very first screen after the splash must already be RTL (tabs rightmost-
   first, text right-aligned) with **no LTR flash** — the app restarts itself
   once behind the splash on first launch if needed.
3. Relaunch — no restart loop, still RTL.

**Safe areas**
1. On a notch/Dynamic Island iPhone: Home, section pages, notifications,
   profile — content must not sit under the clock; scrolled content passes
   under a subtle dark veil at the very top (new in this pass, iOS only).
2. Full player (opens as a sheet): controls and «أدوات الدرس» must clear the
   home indicator; mini player must float above the tab bar.
3. iPad (supportsTablet is on): spot-check Home + player for layout sanity.

**Account deletion (what the reviewer will test)**
1. Register an account, listen a little, add a note.
2. حسابي → **حذف الحساب نهائيًا** → confirm dialog → delete.
3. App returns to Home as a guest. In Supabase Studio: the auth user is gone,
   and their rows in `profiles`, `user_lecture_progress`, `lecture_notes`,
   `push_tokens`, `notifications` are gone (cascade).
4. Signing in with the deleted email/password must fail.

**App icon**
- `assets/icon.png` was flattened (alpha channel removed, pixels identical).
  After the first build, check the icon renders correctly on the home screen.
