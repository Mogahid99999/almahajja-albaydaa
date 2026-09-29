# `/opt/almahajja-go` — go.almahajja.app (V23 P5, share links)

Static site behind the «البث المباشر» share links (PLAN_LIVE_V23 §9.3, D8):
`https://go.almahajja.app/live/{share_code}`.

- **App installed** → Android App Links / iOS Universal Links open the app directly
  (`app.json` intent filter + associated domain; `app/+native-intent.tsx` maps
  `/live/{code}` → `/live/code/{code}`). This site is never loaded.
- **Not installed / in-app browser** → `public/live.html`: calls `get_live_by_code`
  (0138, `anon` may execute it) → live / scheduled / ended card (a gender-restricted
  session shows only its status), «لديّ التطبيق · افتح البث» →
  `riwaqalilm://live/code/{code}`, and after 1.5 s Android → Google Play, iOS → App Store.

## Files
| Path | Served as |
|---|---|
| `public/live.html` + `live.css` + `live.js` | `/live/{code}` (nginx `try_files /live.html`) |
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
1. `assetlinks.json` → `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`: Play Console → Test and release →
   App integrity → **App signing key certificate** SHA-256 (colon-separated, upper-case). Add the
   upload/local release key's SHA-256 as a second entry if locally built APKs should verify too.
2. `apple-app-site-association` → `TEAMID` (both `appIDs` and `appID`): Apple Developer Team ID.
   The iOS build also needs the Associated Domains capability (EAS syncs it from `app.json`).

## Deploy (VPS isolation rules as in `vps/live/README.md`)
```sh
# on the VPS
mkdir -p /opt/almahajja-go && cd /opt/almahajja-go   # copy nginx.conf, docker-compose.yml, public/
docker compose up -d
docker exec almahajja-go wget -qO- http://127.0.0.1/healthz          # ok
```
Cloudflare Tunnel (`almahajja-admin`): public hostname `go.almahajja.app` → `http://almahajja-go:80`.
In Cloudflare keep `/.well-known/*` free of redirects, challenges and Bot Fight Mode (Apple's CDN
and Google's verifier must get a plain 200 JSON). Checks after deploy:

```sh
curl -sI https://go.almahajja.app/.well-known/apple-app-site-association   # 200, application/json
curl -s  https://go.almahajja.app/.well-known/assetlinks.json
# Google: https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://go.almahajja.app&relation=delegate_permission/common.handle_all_urls
# Android device: adb shell pm get-app-links com.riwaqalilm.app   → go.almahajja.app: verified
```

Link previews (WhatsApp/Telegram) don't run JS, so the Open Graph tags are generic (brand +
image); the shared message itself carries the title, section and sheikh.
