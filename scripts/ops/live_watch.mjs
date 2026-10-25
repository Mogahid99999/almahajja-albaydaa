// Live-broadcast watch (read-only). Every 30 s: DB snapshot, VM memory, REST/auth latency.
// Prints only on danger, a notable change, or a 5-min heartbeat; exits when the live ends.
// Usage: node scripts/ops/live_watch.mjs .env scripts/ops/live_snap.sql
import fs from 'node:fs';
const [envFile, snapFile] = process.argv.slice(2);
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const SQL = fs.readFileSync(snapFile, 'utf8');
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';
const timed = async (fn, ms) => { const t0 = Date.now(); const c = new AbortController(); const to = setTimeout(() => c.abort(), ms);
  try { return { ok: true, v: await fn(c.signal), ms: Date.now() - t0 }; } catch (e) { return { ok: false, err: e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e), ms: Date.now() - t0 }; } finally { clearTimeout(to); } };
const snapshot = async (signal) => { const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/database/query`, { method: 'POST', signal,
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ query: SQL, read_only: true }) });
  const b = await r.json(); if (!r.ok || !Array.isArray(b)) throw new Error(`snap ${r.status} ${JSON.stringify(b).slice(0, 160)}`); return b[0]; };
const mem = async (signal) => { const r = await fetch(`${URL_}/customer/v1/privileged/metrics`, { signal, headers: { Authorization: 'Basic ' + Buffer.from('service_role:' + SECRET).toString('base64') } });
  const o = {}; for (const l of (await r.text()).split('\n')) { const m = l.match(/^(node_memory_(?:MemAvailable|SwapTotal|SwapFree)_bytes|node_load1)(?:\{[^}]*\})? (\S+)/); if (m) o[m[1]] = +m[2]; }
  const MB = (x) => Math.round(x / 1048576); return { avail: MB(o.node_memory_MemAvailable_bytes), swap: MB(o.node_memory_SwapTotal_bytes - o.node_memory_SwapFree_bytes), load1: o.node_load1 }; };
const rest = (signal) => fetch(`${URL_}/rest/v1/app_config?select=key&limit=1`, { signal, headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then((r) => { if (r.status >= 500) throw new Error(`rest ${r.status}`); return r.status; });
const auth = (signal) => fetch(`${URL_}/auth/v1/health`, { signal, headers: { apikey: ANON } }).then((r) => { if (r.status >= 500) throw new Error(`auth ${r.status}`); return r.status; });
// The recorder (egress on the VPS, read-only via ssh): dropped audio in the last 35 s.
// 2026-10-13: the sheikh's phone clock drifted and the mixer dropped his audio for 15–40 s
// at a time («mixer will drop the buffer»); egress now runs audio_tempo_controller — this
// proves (or disproves) it live. Set LIVE_WATCH_NO_SSH=1 to skip.
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const SSH_KEY = path.join(os.homedir(), '.ssh', 'lims_vps_ed25519');
// Counts only lines newer than the server time of the previous check (a fixed 35 s window
// every 30 s counted the same burst twice on 2026-10-13).
let egressSince = null;
const egressDrops = () => new Promise((resolve, reject) => {
  execFile('ssh', ['-i', SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@161.97.135.4',
    'date -u +%Y-%m-%dT%H:%M:%S.%3NZ; docker logs --since 60s almahajja-egress 2>&1 | grep -E "mixer will drop the buffer|audioBuffersDropped\\": [1-9]|buffer full, dropping sample|correcting PTS" | cut -c1-24 || true'],
  { timeout: 20000 }, (err, out) => {
    if (err) return reject(err);
    const [now, ...stamps] = String(out).trim().split('\n').filter(Boolean);
    const fresh = egressSince ? stamps.filter((t) => t > egressSince).length : 0;
    egressSince = now;
    resolve(fresh);
  });
});
const say = (s) => console.log(`${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh' })} ${s}`);
let lastBeat = 0, lastGov = null, lastPresent = null, lastStatus = null, peak = 0, recDrops = 0, swapBase = null;
for (;;) {
  const [s, m, r, a, e] = await Promise.all([timed(snapshot, 20000), timed(mem, 15000), timed(rest, 10000), timed(auth, 10000),
    process.env.LIVE_WATCH_NO_SSH ? Promise.resolve({ ok: true, v: 0 }) : timed(egressDrops, 25000)]);
  const alerts = [];
  if (e.ok && e.v > 0) { recDrops += e.v; alerts.push(`RECORDING dropped audio ×${e.v} (total ${recDrops})`); }
  if (!e.ok) alerts.push(`recorder check failed (${e.err})`);
  if (!s.ok) alerts.push(`DB snapshot failed (${s.err}, ${s.ms} ms)`); else if (s.ms > 6000) alerts.push(`DB snapshot slow ${s.ms} ms`);
  if (!r.ok) alerts.push(`REST ${r.err} (${r.ms} ms)`); else if (r.ms > 3000) alerts.push(`REST slow ${r.ms} ms`);
  if (!a.ok) alerts.push(`AUTH ${a.err} (${a.ms} ms)`); else if (a.ms > 3000) alerts.push(`AUTH slow ${a.ms} ms`);
  // Swap: idle parked pages are harmless (2026-10-13: 119 MB static, no paging); alert only
  // when it GROWS ≥ 30 MB above the first reading of this watch.
  if (m.ok) { swapBase ??= m.v.swap; if (m.v.swap - swapBase >= 30) alerts.push(`swap grew ${swapBase}→${m.v.swap} MB`); if (m.v.avail < 400) alerts.push(`mem avail ${m.v.avail} MB`); }
  let line = '';
  if (s.ok) { const v = s.v, c = v.conns ?? {};
    const active = ['authenticator', 'supabase_auth_admin', 'supabase_storage_admin'].reduce((n, u) => n + (c[`${u}:active`] ?? 0) + (c[`${u}:idle in transaction`] ?? 0), 0);
    const live = (v.live ?? [])[0]; if (live) peak = Math.max(peak, live.present);
    if (active >= 4) alerts.push(`app queries active ${active}`);
    if (v.http_bad5m > 0) alerts.push(`push http errors 5m=${v.http_bad5m}/${v.http_all5m}`);
    if (lastGov !== null && v.gov10m > lastGov) alerts.push(`governor throttled: ${JSON.stringify(v.gov_last)}`); lastGov = v.gov10m;
    const status = live ? live.status : 'none'; if (lastStatus !== null && status !== lastStatus) alerts.push(`live status ${lastStatus} → ${status}`); lastStatus = status;
    if (live && lastPresent !== null && Math.abs(live.present - lastPresent) >= 25) alerts.push(`present ${lastPresent} → ${live.present}`); lastPresent = live ? live.present : null;
    line = `title=${live?.title ?? '-'} present=${live?.present ?? '-'} joined=${live?.joined ?? '-'} peak=${peak} opened10m=${v.opened10m} active=${active} q_due=${v.q_due} q_later=${v.q_later} outbox=${v.outbox} gov10m=${v.gov10m}`; }
  const tail = (m.ok ? ` avail=${m.v.avail}MB swap=${m.v.swap}MB load1=${m.v.load1}` : ' mem=?') + ` db=${s.ms}ms rest=${r.ms}ms auth=${a.ms}ms recDrops=${recDrops}`;
  if (alerts.length) say(`⚠ ${alerts.join(' | ')} || ${line}${tail}`); else if (Date.now() - lastBeat > 5 * 60_000) { say(`ok ${line}${tail}`); lastBeat = Date.now(); }
  if (lastStatus === 'none' && peak > 0) { say(`live over — final peak=${peak} recording drops=${recDrops}`); process.exit(0); }
  await new Promise((res) => setTimeout(res, 30_000));
}
