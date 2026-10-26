# Madinah mushaf pack — build, host, verify

The Madinah print (QCF v1 per-page fonts + one glyph index) is **not** in the
app binary. The app downloads it once on first use from **our own server over
HTTPS**, verifies every file, then reads offline. The simplified mushaf (KFGQPC
Hafs text + font) is bundled and needs nothing from here.

The pack source is one setting: `EXPO_PUBLIC_MUSHAF_PACK_URL` (read only in
`src/lib/env.ts`). Unset = print mode is not offered. Release builds accept
`https://` only.

## Server layout

```
<base>/current.json                  {"version":"madinah-1405-v1"}   ← switched LAST
<base>/madinah-1405-v1/manifest.json  sizes + MD5 of every file       (immutable)
<base>/madinah-1405-v1/p001.ttf.gz … p604.ttf.gz, glyphs.json.gz      (immutable)
```

Hard requirements for the web server (the app checks sizes and MD5, so a
mistake here makes downloads fail, never corrupts a pack):

- serve `*.gz` **as bytes**: `Content-Type: application/gzip`, **no
  `Content-Encoding` header** (no `gzip_static`, no on-the-fly compression);
- `Cache-Control: no-cache, no-transform` on `current.json`;
  `public, max-age=31536000, immutable, no-transform` on everything under a
  version (`no-transform` also stops a CDN/Cloudflare from re-encoding);
- plain GET, no auth, no redirects to another host.

nginx:

```nginx
location /mushaf/ {
    alias /srv/almahajja/mushaf/;
    gzip off;
    gzip_static off;
    types { application/gzip gz; application/json json; }
    add_header Cache-Control "public, max-age=31536000, immutable, no-transform";
    location = /mushaf/current.json {
        alias /srv/almahajja/mushaf/current.json;
        add_header Cache-Control "no-cache, no-transform";
    }
}
```

Caddy:

```caddy
handle_path /mushaf/* {
    root * /srv/almahajja/mushaf
    header Cache-Control "public, max-age=31536000, immutable, no-transform"
    header /current.json Cache-Control "no-cache, no-transform"
    file_server   # no `encode` directive here
}
```

## Publish a version (order matters)

1. Build: `node scripts/mushaf/build-mushaf-pack.mjs <workDir>`
   (self-contained; cross-checks against `src/mushaf/data/layout.json`).
2. Copy the **version directory first**:
   `rsync -a <workDir>/pack/madinah-1405-v1/ server:/srv/almahajja/mushaf/madinah-1405-v1/`
3. Then `current.json`:
   `rsync -a <workDir>/pack/current.json server:/srv/almahajja/mushaf/current.json`
4. Verify through the public URL, exactly as the app downloads:
   `node scripts/mushaf/verify-pack.mjs https://<host>/mushaf`
5. Set `EXPO_PUBLIC_MUSHAF_PACK_URL=https://<host>/mushaf` in the EAS
   environment of the build that should offer it.

Never delete an older version directory right after switching: devices keep
reading their verified pack until the new one has fully downloaded.

## Local testing on a phone (dev builds only)

```
node scripts/mushaf/serve-pack.mjs <workDir>/pack      # port 8090, fault injection: see the file
adb reverse tcp:8090 tcp:8090
EXPO_PUBLIC_MUSHAF_PACK_URL=http://localhost:8090  npx expo start --dev-client
```

## Source attribution

Shown at the end of the mushaf index (app/(student)/mushaf/index.tsx): the
text and fonts are from King Fahd Glorious Qur'an Printing Complex (مجمع الملك
فهد لطباعة المصحف الشريف). The QCF page fonts are redistributed unmodified.
