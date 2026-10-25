// One-shot memory snapshot of a project's VM. Usage: node mem.mjs <envfile>
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const r = await fetch(env.EXPO_PUBLIC_SUPABASE_URL + '/customer/v1/privileged/metrics', { headers: { Authorization: 'Basic ' + Buffer.from('service_role:' + key).toString('base64') } });
const o = {};
for (const l of (await r.text()).split('\n')) {
  const m = l.match(/^(node_memory_(?:MemTotal|MemAvailable|Cached|Shmem|AnonPages|SwapTotal|SwapFree|SwapCached)_bytes|node_vmstat_pswpin|node_vmstat_pswpout)(?:\{[^}]*\})? (\S+)/);
  if (m) o[m[1].replace('node_memory_', '').replace('_bytes', '').replace('node_vmstat_', '')] = +m[2];
}
const MB = (x) => Math.round(x / 1048576);
console.log(JSON.stringify({ t: new Date().toISOString().slice(11, 19), status: r.status, avail: MB(o.MemAvailable), cached: MB(o.Cached), shmem: MB(o.Shmem), anon: MB(o.AnonPages), swapUsed: MB(o.SwapTotal - o.SwapFree), swapCached: MB(o.SwapCached), pswpin: o.pswpin, pswpout: o.pswpout }));
