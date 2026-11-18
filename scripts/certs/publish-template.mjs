// Publishes a certificate template version and makes it the one used for NEW certificates.
// Usage: node scripts/certs/publish-template.mjs <envfile> <version> <file.html> ["notes"]
// A version already published cannot change (trigger): to change the design, publish N+1.
import fs from 'node:fs';

const [, , envFile, versionArg, file, notes] = process.argv;
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
  }),
);
const version = Number(versionArg);
if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer');
const html = fs.readFileSync(file, 'utf8');
const lit = (s) => `$tpl$${s}$tpl$`;
if (html.includes('$tpl$')) throw new Error('template contains the quoting marker');

const sql = `begin;
insert into public.certificate_templates (version, html, notes) values (${version}, ${lit(html)}, ${notes ? lit(notes) : 'null'})
  on conflict (version) do nothing;
update public.certificate_templates set is_active = false where is_active and version <> ${version};
update public.certificate_templates set is_active = true where version = ${version};
commit;
select version, is_active, length(html) as bytes, md5(html) = '${(await import('node:crypto')).createHash('md5').update(html).digest('hex')}' as same_as_file from public.certificate_templates order by version;`;

const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  body: JSON.stringify({ query: sql }),
});
console.log(r.status, JSON.stringify(await r.json()));
