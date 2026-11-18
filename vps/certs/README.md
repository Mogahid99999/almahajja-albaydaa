# `/opt/almahajja-certs`: certificate rendering and public verification

Server-only. The mobile app holds no template and draws nothing.

| Piece | Where |
|---|---|
| Issuing, snapshot, access rules | `supabase/migrations/0170_certificate_issuance.sql` |
| Template source (Mustache HTML + fit script) | `vps/certs/templates/vN.html`, stored in `certificate_templates` |
| PDF + preview rendering, `/c/{id}` page | this service (Chromium in a container) |
| Files | VPS disk, `/opt/almahajja-certs/files-{prd,stg}/certificates/<random uuid>.pdf` and `.jpg`; opened only through 5-minute links signed by `certificate-files` (service `FILES_SECRET` = function `CERT_FILES_SECRET`) |
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
`.env`, `.env.prd` and `.env.stg` (mode 600) hold the tunnel tokens, service keys and file-link secrets.

A lost file can be rebuilt from its snapshot: clear `pdf_key` and `render_attempts` as above.

## Staging
`https://certs-stg.almahajja.app/c/{id}`: own tunnel `almahajja-certs-stg`, own DNS record, staging
Supabase and files directory. `app_config.certificate_verify_base` sets the URL printed on new certificates.

## Production (live since 2026-11-09)
`https://certs.almahajja.app/c/{id}`: tunnel `almahajja-certs`, service `almahajja-certs` (`.env.prd`), image tag `CERTS_TAG` in `.env`. Production leaves
`certificate_verify_base` unset, so certificates print `https://almahajja.app/c/{id}`.

`almahajja.app` is a Worker Custom Domain, so `/c/*` is a Cloudflare Single Redirect (302) to
`certs.almahajja.app`, rule "Certificate verification links". Every other path is untouched.
