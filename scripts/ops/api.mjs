// GET a Management API path (read-only). Usage: node api.mjs <envfile> /v1/projects/{ref}/...
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const path = process.argv[3].replace('{ref}', env.SUPABASE_PROJECT_ID);
const r = await fetch(`https://api.supabase.com${path}`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36' } });
console.log(r.status, JSON.stringify(await r.json().catch(() => null), null, 1).slice(0, 4000));
