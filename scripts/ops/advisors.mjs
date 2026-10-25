// Supabase performance advisor summary. Usage: node advisors.mjs <envfile>
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/advisors/performance`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36' } });
const j = await r.json(); const lints = j.lints || [];
fs.writeFileSync(new URL('./advisors-full.json', import.meta.url), JSON.stringify(lints, null, 1));
const by = {};
for (const l of lints) (by[`${l.name} [${l.level}]`] ??= []).push(l.metadata?.name || l.metadata?.table || '');
console.log('status', r.status, 'lints', lints.length);
for (const [k, v] of Object.entries(by)) console.log('-', k, v.length, '→', [...new Set(v)].slice(0, 16).join(', '));
