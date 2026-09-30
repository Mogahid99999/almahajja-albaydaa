# `/opt/almahajja-go` — go.almahajja.app (V23 P5, share links)

Static site behind the «البث المباشر» share links (PLAN_LIVE_V23 §9.3, D8):
`https://go.almahajja.app/live/{share_code}`.

## The three Android paths

| Who taps the link | What happens |
|---|---|
| **App ≥ 1.1.3**, App Link verified | Android opens the app directly (`app.json` intent filter, `autoVerify`); `app/+native-intent.tsx` maps `/live/{code}` → `/live/code/{code}` → the room. This site is never loaded. |
| **App ≥ 1.1.3**, link not taken (App Link not verified yet, in-app browser, URL typed into Chrome) | `public/live.html` → «افتح البث في التطبيق» (an intent aimed at our package, see below) opens the room. |
| **App < 1.1.3** (no `/live` filter, so Android gives the link to the browser) | `public/live.html` → the same button: no matching filter → Chrome follows the fallback to Google Play, which shows «تحديث». Also a plain «حدّث التطبيق أو ثبّته من Google Play» button. |
| **No app** | Same button → Google Play, which shows «تثبيت». |

The Android button is a package-targeted https intent:

```
intent://go.almahajja.app/live/{code}#Intent;scheme=https;package=com.riwaqalilm.app;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.riwaqalilm.app;end
```

- An explicit package does not need App Link verification, so the room opens
  even before `assetlinks.json` has the SHA-256, and for installs that
  verified against the placeholder.
- The page never uses `riwaqalilm://`. Old apps have that scheme too and would
  open on a route they don't have.
- The page does **not** redirect to a store on its own. Chrome only launches
  intents after a tap, and an automatic Play redirect would send a 1.1.3 user
  to Play. There, «فتح» opens the app's home screen, not the room.
- After installing or updating, the user opens the link again. There is no
  deferred deep link: Play's «فتح» does not carry the code.

The card calls `get_live_by_code` (0138, `anon` may execute it) and shows a
live, scheduled or ended session. A gender-restricted session shows only its status.

iOS (out of scope this round) and desktop get a short note and the Google Play
button (on iOS, the App Store button replaces Play once `config.js` carries
`appStoreUrl`). Pure helpers in `live.js` are unit-tested in
`tests/go-site/shareLinks.test.ts`, which also checks `assetlinks.json` and the
`app.json` filter.

## Files
| Path | Served as |
|---|---|
| `public/live.html` + `live.css` + `live.js` | `/live/{code}` (nginx `try_files /live.html`). **Bump `?v=` in `live.html` whenever `live.css`/`live.js` change**: both are cached for 1 day by nginx and Cloudflare. |
| `public/config.js` | **generated, not in git** — `window.GO_CONFIG` (Supabase URL + anon key) |
| `public/.well-known/assetlinks.json` | Android App Links (`application/json`) |
| `public/.well-known/apple-app-site-association` | iOS Universal Links (`application/json`, no redirect) |
| `public/og-live.png` | Open Graph image (1200×630) |
| `nginx.conf` | `/etc/nginx/conf.d/default.conf` |
| `docker-compose.yml` | service `almahajja-go` on `almahajja_net`, **no host ports** |

## config.js (one per environment)
Generated from the same env files the app builds with — the key is the public anon /
publishable key, never a service key (the script refuses one and never prints the key):

```sh
node vps/go-site/gen-config.mjs --env .env                 # production → public/config.js
node vps/go-site/gen-config.mjs --env .env.staging.local   # staging (only for a staging host)
# optional iOS store redirect: --app-store-url https://apps.apple.com/app/id<APP_ID>  (or GO_APP_STORE_URL in the env file)
```

Then copy `public/config.js` to `/opt/almahajja-go/public/config.js` (mode 644). No restart needed.
`go.almahajja.app` is production; a staging copy would be a second service/host (e.g.
`almahajja-go-stg` → `go-stg.almahajja.app`) with the staging config.

## Owner placeholders (must be filled before App Links / Universal Links verify)
1. **`public/.well-known/assetlinks.json`**: replace the string
   `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` (the only entry in `sha256_cert_fingerprints`).
   - Where to find it: Play Console → the app → **Test and release → App integrity →
     App signing** → «App signing key certificate» → **SHA-256 certificate fingerprint**.
     Use the SHA-256 row, not MD5 or SHA-1. Format: 32 upper-case hex pairs joined by colons,
     `AB:CD:…:EF`.
   - Optional second entry: the **Upload key certificate** SHA-256 from the same page. Add it
     only if locally built release APKs (`gradlew assembleRelease`, signed with the upload key)
     should verify too.
   - Result:
     ```json
     "sha256_cert_fingerprints": [
       "AB:CD:…:EF"
     ]
     ```
   - `npx jest tests/go-site` rejects a malformed fingerprint. Then deploy (below).
2. `apple-app-site-association` → `TEAMID` (both `appIDs` and `appID`): Apple Developer Team ID.
   The iOS build also needs the Associated Domains capability (EAS syncs it from `app.json`).

## Deploy (VPS isolation rules as in `vps/live/README.md`)
First install:
```sh
# on the VPS
mkdir -p /opt/almahajja-go && cd /opt/almahajja-go   # copy nginx.conf, docker-compose.yml, public/
docker compose up -d
docker exec almahajja-go wget -qO- http://127.0.0.1/healthz          # ok
```
Cloudflare Tunnel (`almahajja-admin`): public hostname `go.almahajja.app` → `http://almahajja-go:80`.

Updating static files. Name the changed files explicitly: a local `public/config.js` may be
staging's, and it must never overwrite production's. No restart is needed, because nginx serves
`./public` from the bind mount:
```sh
# from the repo root
tar -C vps/go-site -cf - public/live.html public/live.js public/live.css public/.well-known/assetlinks.json \
  | ssh root@161.97.135.4 'tar -C /opt/almahajja-go -xf -'
```

In Cloudflare, keep `/.well-known/*` free of redirects, challenges and Bot Fight Mode. Apple's CDN
and Google's verifier must get a plain 200 JSON. Checks after deploy:

```sh
curl -sI https://go.almahajja.app/.well-known/apple-app-site-association   # 200, application/json
curl -s  https://go.almahajja.app/.well-known/assetlinks.json              # the real SHA-256, no placeholder
curl -s  https://go.almahajja.app/live/ABC234 | grep -c 'live.js?v='       # 1 = the new page
# Google's view (must list the statement):
# https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://go.almahajja.app&relation=delegate_permission/common.handle_all_urls
# Android device:
adb shell pm get-app-links com.riwaqalilm.app                  # go.almahajja.app: verified
adb shell pm verify-app-links --re-verify com.riwaqalilm.app   # if it still says legacy_failure / 1024
```

Devices that installed 1.1.3 before the real SHA-256 was live may stay unverified until
Android re-verifies them, at the latest on the next app update. Until then their links
open this page, and «افتح البث في التطبيق» still takes them into the room.

## Old app versions (UpdateGate, `app_config`) — owner's call, set in «الإعدادات» on the admin web
Do not change these before 1.1.3 is at **100% rollout** on Play. Until then, some users are not
offered the update yet, and a block would leave them facing an update button with no update behind it.

1. `app_download_url` (رابط تنزيل التحديث) = `https://play.google.com/store/apps/details?id=com.riwaqalilm.app`,
   if it is still empty. Without it, UpdateGate's blocking screen has **no** «تحديث التطبيق» button.
2. At 100% rollout: `latest_app_version` = `1.1.3`, `latest_released_at` = that day (`YYYY-MM-DD`).
   Installs below 1.1.3 (every store build since 1.1.0 honours this) immediately get the
   dismissible banner «يتوفر إصدار جديد، يفضّل التحديث قريبًا». **30 days later** they are blocked
   by «يتوفر إصدار جديد» until they update.
3. `min_app_version` (أدنى إصدار مدعوم): **leave it as is**. Live does not need it: old apps keep
   working, and their share links land on this page, which sends them to Play. It is the
   emergency switch: it blocks immediately, with no grace period. Raise it only for a breaking
   server change, and only after 100% rollout.
