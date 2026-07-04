/**
 * App-version gate config (Issue 5). Reads the remote "minimum supported
 * version" + optional download URL from the `app_config` table (migration
 * 0021), so a new APK can force a calm "حدّث التطبيق" prompt on older installs.
 * World-readable; guests (anon session) can read it too. Never throws — a failed
 * read just resolves to "no gate" so the app opens normally.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type AppVersionGate = {
  minVersion: string | null;
  downloadUrl: string | null;
};

export async function getAppVersionGate(): Promise<AppVersionGate> {
  if (USE_MOCK) return { minVersion: null, downloadUrl: null };
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['min_app_version', 'app_download_url']);
    if (error || !data) return { minVersion: null, downloadUrl: null };
    const map = new Map(data.map((r) => [r.key, r.value]));
    return {
      minVersion: map.get('min_app_version') || null,
      downloadUrl: map.get('app_download_url') || null,
    };
  } catch {
    return { minVersion: null, downloadUrl: null };
  }
}
