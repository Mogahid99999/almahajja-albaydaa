// Read-only SQL via the Supabase Management API. Usage: node q.mjs <envfile> "<sql>"
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36' },
  // argv[3]: SQL, or @file; argv[4] === 'write' → not read-only.
  body: JSON.stringify({ query: process.argv[3].startsWith('@') ? fs.readFileSync(process.argv[3].slice(1), 'utf8') : process.argv[3], read_only: process.argv[4] !== 'write' }),
});
const body = await r.json();
// Q_OUT=<file>: write the FULL JSON there (stdout stays truncated).
if (process.env.Q_OUT) fs.writeFileSync(process.env.Q_OUT, JSON.stringify(body));
console.log(r.status, JSON.stringify(body, null, 1).slice(0, 6000));
