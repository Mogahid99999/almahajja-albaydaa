# Production Deployment Runbook — Backup & Restore

**Feature:** النسخ الاحتياطي والاستعادة (admin Backup & Restore)
**Status when written:** staging-validated (backup, restore round-trip, failure-injection all passed 2026-07-19); `RESTORE_ENABLED = true` in code. **Nothing applied to production yet.**
**Audience:** the operator deploying to production.

> ⚠️ Read the whole runbook before running anything. Every destructive step is
> gated. The app's `RESTORE_ENABLED` flag is **compile-time** — once a prod app
> build ships with it `true`, restore is live for admins, so the backend
> (migration + Edge Function + secrets) MUST be in place on prod **first**.

---

## 0. Preconditions (verify before starting)

- [ ] Staging validation is green (this runbook is the prod counterpart of that).
- [ ] You have the **production** Supabase project ref: `prpyxn…` (the value of
      `SUPABASE_PROJECT_ID` in `.env`). Confirm it is prod, not staging
      (`xjtpwcwotuflomqigzfa` is staging — must NOT appear here).
- [ ] You have a prod **personal access token** with Management-API rights
      (the account-wide `SUPABASE_ACCESS_TOKEN` in `.env` works).
- [ ] You have the prod **R2** credentials: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
      `R2_SECRET_ACCESS_KEY`, and the prod bucket name **`almahajja-media`**.
- [ ] Working tree is on the intended release commit; `npm run typecheck` and
      `npm test` are green locally.
- [ ] A recent, independent DB backup of prod exists (belt-and-suspenders — this
      runbook does not delete data, but always have one).

**Environment convention:** commands below read prod values from `.env` (which
points at prod). Never source `.env.staging.local` here. Where a command needs a
variable, it is shown explicitly.

```bash
# Load prod values into the shell for this runbook session:
cd <repo root>
export SUPABASE_ACCESS_TOKEN=$(grep -E '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"'\r')
export PROD_REF=$(grep -E '^SUPABASE_PROJECT_ID=' .env | cut -d= -f2- | tr -d '"'"'"'\r')
echo "PROD_REF = $PROD_REF   # MUST be the production ref, NOT xjtpwcwotuflomqigzfa"
```

---

## 1. Deploy order (do NOT reorder)

The dependency chain is: **migration → secrets → Edge Function → (types) → app build**.
Restore in the app calls RPCs from `0102` and the `backup-media` function; both
must exist on prod before any admin can use restore.

1. Apply migration `0102_backup_restore.sql` to prod.
2. Set the R2 Edge-Function secrets on prod.
3. Deploy the `backup-media` Edge Function to prod.
4. Run `security-check.mjs` against prod.
5. (Recommended) Regenerate `database.generated.ts` and drop the `as never` casts.
6. Smoke-test **backup only** on prod (non-destructive).
7. Ship the prod app build (restore becomes usable).

---

## 2. Step-by-step

### Step 1 — Apply migrations 0102 AND 0103 to production

Both are **idempotent** and **non-destructive**. `0102` creates `backup_log`,
`restore_sessions`, and the export/restore functions; `0103` adds
`backup_schema_fingerprint()` (schema fingerprint for the manifest). Neither
touches existing data. Apply **in order**.

```bash
# Apply each migration SQL via the Management API (browser UA required — CF 1010).
for V in 0102_backup_restore 0103_backup_schema_fingerprint; do
  echo "applying $V …"
  curl -s -X POST "https://api.supabase.com/v1/projects/$PROD_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -H "User-Agent: Mozilla/5.0" \
    --data "$(node -e 'const fs=require("fs");console.log(JSON.stringify({query:fs.readFileSync("supabase/migrations/'"$V"'.sql","utf8")}))')" \
    -w "\nHTTP %{http_code}\n"
done

# Record both in the migration history so they are not re-applied by tooling:
curl -s -X POST "https://api.supabase.com/v1/projects/$PROD_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
  --data '{"query":"insert into supabase_migrations.schema_migrations (version, name) values ('"'"'0102'"'"', '"'"'backup_restore'"'"'), ('"'"'0103'"'"', '"'"'backup_schema_fingerprint'"'"') on conflict (version) do nothing"}' \
  -w "\nHTTP %{http_code}\n"
```

**Verify Step 1:**
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/$PROD_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
  --data '{"query":"select to_regclass('"'"'public.backup_log'"'"') is not null as has_log, to_regclass('"'"'public.restore_sessions'"'"') is not null as has_sessions, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='"'"'public'"'"' and p.proname in ('"'"'export_table'"'"','"'"'restore_tables'"'"','"'"'backup_table_order'"'"','"'"'is_restore_session_active'"'"','"'"'start_restore_session'"'"','"'"'backup_schema_fingerprint'"'"')) as backup_fns"}'
```
- [ ] Expect `has_log = true`, `has_sessions = true`, `backup_fns = 6`.

> If prod is behind on migrations (unlikely — prod is the source of truth at
> `0101`), apply the missing ones in order first, exactly as staging did.

---

### Step 2 — Set the R2 Edge-Function secrets on production

The function reads `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`. (`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by
Supabase automatically — do NOT set them.)

> ✅ **`R2_BUCKET` MUST be `almahajja-media` (prod)** — NOT
> `almahajja-media-staging`. A wrong bucket here points prod restore at staging
> media. Double-check this value.

```bash
# Build the secrets payload from prod .env and POST it.
node -e '
const fs=require("fs");
const env={};for(const l of fs.readFileSync(".env","utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/\r$/,"");}
if(env.R2_BUCKET!=="almahajja-media"){console.error("R2_BUCKET is "+env.R2_BUCKET+" — refusing (expected almahajja-media)");process.exit(1);}
const secrets=[
  {name:"R2_ENDPOINT",value:env.R2_ENDPOINT},
  {name:"R2_BUCKET",value:env.R2_BUCKET},
  {name:"R2_ACCESS_KEY_ID",value:env.R2_ACCESS_KEY_ID},
  {name:"R2_SECRET_ACCESS_KEY",value:env.R2_SECRET_ACCESS_KEY},
];
fs.writeFileSync(".prod-secrets.tmp.json", JSON.stringify(secrets));
console.log("prepared:", secrets.map(s=>s.name).join(", "), "| bucket="+env.R2_BUCKET);
'
curl -s -X POST "https://api.supabase.com/v1/projects/$PROD_REF/secrets" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data @.prod-secrets.tmp.json -w "\nHTTP %{http_code}\n"
rm -f .prod-secrets.tmp.json   # never leave secrets on disk
```

**Verify Step 2:**
```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROD_REF/secrets" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).map(s=>s.name).join(', ')))"
```
- [ ] Expect the four `R2_*` names present. (Values are not returned — that's fine.)

---

### Step 3 — Deploy the `backup-media` Edge Function to production

Use the Management-API multipart deploy (no local Docker needed). `verify_jwt=true`.

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/$PROD_REF/functions/deploy?slug=backup-media" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F 'metadata={"name":"backup-media","entrypoint_path":"index.ts","verify_jwt":true};type=application/json' \
  -F 'file=@supabase/functions/backup-media/index.ts;type=application/typescript' \
  -w "\nHTTP %{http_code}\n"
```

**Verify Step 3** (function is live and JWT-gated):
```bash
PROD_URL=$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
curl -s -o /dev/null -w "no-auth: HTTP %{http_code}\n" -X POST "$PROD_URL/functions/v1/backup-media" \
  -H "Content-Type: application/json" --data '{"action":"list"}'
```
- [ ] Expect `HTTP 201` from the deploy, `status: ACTIVE`.
- [ ] Expect `no-auth: HTTP 401` (unauthenticated calls rejected).

---

### Step 4 — Run security-check against production

```bash
set -a
eval "$(grep -E '^(EXPO_PUBLIC_SUPABASE_URL|EXPO_PUBLIC_SUPABASE_ANON_KEY)=' .env | sed 's/\r$//')"
# security-check needs the service_role JWT in SUPABASE_SECRET_KEY:
SUPABASE_SECRET_KEY=$(grep -E '^SUPABASE_SECRET_KEY=' .env | cut -d= -f2- | tr -d '\r')
set +a
node scripts/security-check.mjs
```
- [ ] Expect **"All 20 checks passed."** (RLS invariants intact after 0102.)

> If `SUPABASE_SECRET_KEY` in prod `.env` is an `sb_secret_…` key rather than the
> legacy `service_role` JWT, the script's admin-user creation will be blocked
> (Cloudflare). Temporarily point `SUPABASE_SECRET_KEY` at the service_role JWT
> for this run only (as done in staging).

---

### Step 5 — Regenerate types (recommended, not blocking)

`src/api/backup.ts` uses `as never` casts because the backup RPCs and
`backup_log` are not in `src/types/database.generated.ts` yet. After 0102 is on
prod, regenerate and drop the casts:

```bash
npx supabase gen types typescript --project-id "$PROD_REF" > src/types/database.generated.ts
# then remove the `as never` casts in src/api/backup.ts (backupRpc + listBackupLog)
npm run typecheck   # must stay green
```
- [ ] Types regenerated, `as never` casts removed, typecheck green.
  (Skippable for the first ship — the casts are harmless — but do it soon.)

---

### Step 6 — Smoke-test BACKUP on production (non-destructive)

Backup only reads. Do this from a **desktop Chrome/Edge** signed in as a prod admin:

- [ ] Open `/admin/backup`.
- [ ] The sensitive-data warning and "إنشاء نسخة احتياطية" card render.
- [ ] Click **إنشاء النسخة الآن** → pick a save location → progress bar advances
      (files/bytes/current-file/elapsed).
- [ ] A `almahajja-backup-YYYYMMDD-HHmm.zip` downloads.
- [ ] Open the ZIP: it contains `manifest.json`, `database/*.jsonl`,
      `media/…`, `checksums.json`. `manifest.source_project_id` = the **prod** ref.
- [ ] A row appears in **سجلّ العمليات** with status ناجحة and the size.

> Do NOT run a restore on prod as a smoke test. Restore is destructive; its
> correctness was proven on staging. The first real prod restore should be an
> intentional, planned operation (with the pre-restore safety backup ON).

---

### Step 7 — Ship the production app build

Only after Steps 1–6 pass. `RESTORE_ENABLED = true` is already in the code, so
this build makes restore usable for prod admins.

- [ ] Build/submit the prod app (EAS) per the normal release process.
- [ ] Confirm the `EXPO_PUBLIC_*` env on the build points at **prod**.
- [ ] After release, verify `/admin/backup` shows the **Restore** card as enabled
      (not the "معطّلة مؤقتًا" notice).

---

## 3. Verification summary (what "done" looks like on prod)

- [ ] `backup_log` + `restore_sessions` exist; 5 backup functions present.
- [ ] Four `R2_*` secrets set; `R2_BUCKET = almahajja-media`.
- [ ] `backup-media` ACTIVE, verify_jwt=true, unauthenticated → 401.
- [ ] security-check: 20/20.
- [ ] Backup smoke test produced a valid ZIP with a prod-ref manifest.
- [ ] App build shipped; Restore card enabled in prod admin.

---

## 4. Rollback plan

The deploy is additive and reversible. By failure point:

**If Step 1 (migration) fails or misbehaves:**
- The migrations only ADD objects. To fully reverse (0103 then 0102):
  ```sql
  drop function if exists public.backup_schema_fingerprint();
  drop function if exists public.restore_tables(jsonb, public.restore_mode);
  drop function if exists public.export_table(text, text, int);
  drop function if exists public.export_table_counts();
  drop function if exists public.export_sequences();
  drop function if exists public.backup_table_order();
  drop function if exists public.backup_excluded_tables();
  drop function if exists public.start_restore_session(text);
  drop function if exists public.set_restore_session_status(uuid, public.restore_session_status);
  drop function if exists public.is_restore_session_active(uuid);
  drop function if exists public.backup_log_start(public.backup_op_type, text, public.restore_mode, uuid);
  drop function if exists public.backup_log_update(uuid, public.backup_op_status, bigint, jsonb, int, bigint, text, text, text, text, text, boolean);
  drop table if exists public.backup_log;
  drop table if exists public.restore_sessions;
  -- enum types last (only if nothing else references them)
  drop type if exists public.backup_op_type;
  drop type if exists public.backup_op_status;
  drop type if exists public.restore_mode;
  drop type if exists public.restore_session_status;
  delete from supabase_migrations.schema_migrations where version in ('0102','0103');
  ```
- No existing table/data is touched by this migration, so dropping is clean.

**If Step 3 (function) is bad:**
- Redeploy the previous good version, or delete the function:
  ```bash
  curl -s -X DELETE "https://api.supabase.com/v1/projects/$PROD_REF/functions/backup-media" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -w "\nHTTP %{http_code}\n"
  ```

**To disable the feature entirely after shipping (kill switch):**
- Set `RESTORE_ENABLED = false` in `src/api/backupRestore.ts` and ship a build →
  restore UI reverts to the disabled notice; backup still works.
- For an immediate server-side block without an app release: delete/rename the
  `backup-media` function (backup + restore both stop; the UI surfaces errors).

**A FAILED restore needs no rollback of its own** (this is by design, verified on
staging): the DB restore runs in one transaction (a mid-restore error rolls the
whole thing back — live data unchanged), media is staged under
`restore-staging/{id}/` and only copied to live on activation, and any live
object replaced/removed during activation is archived to `pre-restore/{id}/`
first. If a restore fails, live data + media remain intact; the staged and
rollback prefixes can be cleaned via the function's `cleanup` action.

---

## 5. Post-deploy notes

- **R2 lifecycle (optional housekeeping):** `restore-staging/` and `pre-restore/`
  prefixes accumulate on restores. Consider an R2 lifecycle rule to expire
  objects under those prefixes after N days, or rely on the function's `cleanup`.
- **Backups are UNENCRYPTED (v1)** and contain sensitive system data — the admin
  UI warns to store them securely. Encryption is the explicit v2 follow-up.
- **Auth users:** backups include `profiles` + app data, never plaintext
  passwords. Same-project restore keeps auth users; cross-project needs
  re-creation via the admin API. (Stated in the manifest `auth_users_note`.)
- **Deferred to v2** (not in this deploy): AES encryption, anti-adversarial-archive
  hardening (zip bombs/symlinks/ratios), per-file retry + resumable cancel,
  merge mode, automated auth/page post-restore verification.

---

## 6. Final go/no-go checklist (tick before declaring prod-ready)

- [ ] `PROD_REF` confirmed = production (not staging).
- [ ] Independent prod DB backup taken.
- [ ] Step 1 verified (tables + 5 functions).
- [ ] Step 2 verified (4 R2 secrets, bucket = `almahajja-media`).
- [ ] Step 3 verified (function ACTIVE, 401 unauth).
- [ ] Step 4 verified (security-check 20/20).
- [ ] Step 6 backup smoke test produced a valid prod ZIP.
- [ ] App build shipped; Restore card enabled.
- [ ] Rollback plan understood and reachable.
