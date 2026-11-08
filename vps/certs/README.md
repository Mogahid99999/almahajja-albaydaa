# `/opt/almahajja-certs`: certificate rendering and public verification

Server-only. The mobile app holds no template and draws nothing.

| Piece | Where |
|---|---|
| Issuing, snapshot, access rules | `supabase/migrations/0170_certificate_issuance.sql` |
| Template source (Mustache HTML + fit script) | `vps/certs/templates/vN.html`, stored in `certificate_templates` |
| PDF + preview rendering, `/c/{id}` page | this service (Chromium in a container) |
| Files | R2, `certificates/<random uuid>.pdf` and `.jpg`; keys are never sent to a client |
| Signed links for the app | Edge Function `certificate-files` |

## Changing the design
No app release and no service rebuild:

```sh
node scripts/certs/publish-template.mjs <envfile> <N+1> vps/certs/templates/vN+1.html "notes"
```

A published version cannot be edited (trigger). New certificates use the active version; each
issued certificate keeps its own `template_version`. A new font needs either a `data:` URI in the
template or a new `@fontsource` package and an image rebuild.

Rendering stops a certificate whose layout overflows (`window.__certificateLayout.ok`), records
`render_error`, and retries up to 5 times. Look for stuck rows with:

```sql
select id, render_attempts, render_error from certificates where pdf_key is null and status = 'valid';
```

To re-render, clear `pdf_key` and `render_attempts`; the snapshot does not change.

## Revoking
```sql
update certificates set status = 'revoked' where id = 'MAH-XXXX-XXXX-XXXX';
```

## Deploy (build only with no live running: check the media worker's `/health`)
```sh
tar -C vps/certs --exclude=node_modules --exclude=test -cf - . | ssh ... 'tar -C /opt/almahajja-certs/src -xf -'
docker build -t almahajja-certs:<tag> /opt/almahajja-certs/src   # then set CERTS_TAG_STG in .env
docker compose up -d --no-deps almahajja-certs-stg
```
`.env` and `.env.stg` (mode 600) hold the tunnel token, service key and R2 keys, one environment each.

## Staging
`https://certs-stg.almahajja.app/c/{id}`: own tunnel `almahajja-certs-stg`, own DNS record, staging
Supabase and bucket. `app_config.certificate_verify_base` sets the URL printed on new certificates.

## Production (not done; needs the owner's approval)
1. Apply 0170 and publish template v1 on production; do **not** set `certificate_verify_base`
   (the default is `https://almahajja.app/c/`). Deploy `certificate-files`.
2. Add `almahajja-certs` (production env, `R2_BUCKET=almahajja-media`) beside the staging service.
3. Route `almahajja.app/c/*` to it. The apex is an `AAAA 100::` proxied record, so a Worker or
   Pages project answers it, and the tokens in `.env` cannot read Workers routes or Pages. The
   route needs a token with Workers Routes edit, or adding `/c/*` in whatever serves the apex.
   Add a hostname `certs.almahajja.app` on a dedicated tunnel and have a route-scoped Worker
   on `almahajja.app/c/*` forward to it, leaving every other path untouched.
4. Verify a real certificate's QR and link before enabling any section.
