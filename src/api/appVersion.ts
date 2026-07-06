/**
 * App-version gate config (Issue 5 + Item 9). Reads the remote "minimum
 * supported version" + optional download URL (migration 0021) — the manual
 * emergency override — plus the "latest released version" + its release
 * timestamp (migration 0055), which UpdateGate uses to derive an automatic
 * 30-day force-update grace period, independent of the manual switch. Both
 * are read from the same world-readable `app_config` table; guests (anon
 * session) can read it too. Never throws — a failed read just resolves to
 * "no gate" so the app opens normally.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type AppVersionGate = {
  minVersion: string | null;
  downloadUrl: string | null;
  latestVersion: string | null;
  latestReleasedAt: string | null;
};

const EMPTY_GATE: AppVersionGate = {
  minVersion: null,
  downloadUrl: null,
  latestVersion: null,
  latestReleasedAt: null,
};

export async function getAppVersionGate(): Promise<AppVersionGate> {
  if (USE_MOCK) return EMPTY_GATE;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['min_app_version', 'app_download_url', 'latest_app_version', 'latest_released_at']);
    if (error || !data) return EMPTY_GATE;
    const map = new Map(data.map((r) => [r.key, r.value]));
    return {
      minVersion: map.get('min_app_version') || null,
      downloadUrl: map.get('app_download_url') || null,
      latestVersion: map.get('latest_app_version') || null,
      latestReleasedAt: map.get('latest_released_at') || null,
    };
  } catch {
    return EMPTY_GATE;
  }
}
