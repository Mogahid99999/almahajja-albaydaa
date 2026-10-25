// Two samples of the prod VM metrics, 10 s apart: memory, swap, disk, load, connections, CPU.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2] || '.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
async function sample() {
  const r = await fetch(env.EXPO_PUBLIC_SUPABASE_URL + '/customer/v1/privileged/metrics', { headers: { Authorization: 'Basic ' + Buffer.from('service_role:' + env.SUPABASE_SECRET_KEY).toString('base64') } });
  const m = {}; const proc = {};
  for (const l of (await r.text()).split('\n')) {
    if (l.startsWith('#')) continue;
    const mm = l.match(/^([a-zA-Z_:]+)(\{[^}]*\})? (\S+)/); if (!mm) continue;
    const [, name, labels = '', v] = mm; const val = +v;
    if (name === 'node_cpu_seconds_total') { const mode = labels.match(/mode="(\w+)"/)[1]; m['cpu_' + mode] = (m['cpu_' + mode] || 0) + val; continue; }
    if (name === 'node_disk_read_bytes_total' || name === 'node_disk_written_bytes_total' || name === 'node_disk_reads_completed_total' || name === 'node_disk_writes_completed_total') { m[name] = (m[name] || 0) + val; continue; }
    if (/^(node_load1|node_memory_MemAvailable_bytes|node_memory_SwapFree_bytes|node_vmstat_pswpin|node_vmstat_pswpout|node_memory_Cached_bytes)$/.test(name)) m[name] = val;
    if (name === 'pg_stat_activity_count') { const st = (labels.match(/state="([^"]*)"/) || [])[1]; if (st) proc[st] = (proc[st] || 0) + val; }
    if (/^node_procs_(running|blocked)$/.test(name)) m[name] = val;
  }
  return { m, proc, t: Date.now() };
}
const a = await sample(); await new Promise(r => setTimeout(r, 10000)); const b = await sample();
const dt = (b.t - a.t) / 1000; const rate = k => ((b.m[k] - a.m[k]) / dt);
const cpuTot = Object.keys(b.m).filter(k => k.startsWith('cpu_')).reduce((s, k) => s + (b.m[k] - a.m[k]), 0);
console.log({
  load1: b.m.node_load1, procs_running: b.m.node_procs_running, procs_blocked: b.m.node_procs_blocked,
  mem_avail_MB: Math.round(b.m.node_memory_MemAvailable_bytes / 1048576), cached_MB: Math.round(b.m.node_memory_Cached_bytes / 1048576), swap_free_MB: Math.round(b.m.node_memory_SwapFree_bytes / 1048576),
  swap_in_pages_s: Math.round(rate('node_vmstat_pswpin')), swap_out_pages_s: Math.round(rate('node_vmstat_pswpout')),
  disk_read_MBs: (rate('node_disk_read_bytes_total') / 1048576).toFixed(1), disk_write_MBs: (rate('node_disk_written_bytes_total') / 1048576).toFixed(1),
  read_iops: Math.round(rate('node_disk_reads_completed_total')), write_iops: Math.round(rate('node_disk_writes_completed_total')),
  cpu_pct: Object.fromEntries(['user', 'system', 'iowait', 'idle', 'steal'].map(k => [k, (100 * (b.m['cpu_' + k] - a.m['cpu_' + k]) / cpuTot).toFixed(0)])),
  pg_conns_by_state: b.proc,
});
