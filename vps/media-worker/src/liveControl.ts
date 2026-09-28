// Calls the `live-control` edge function as the service role — used for the
// D4 auto-end (host absent 10 min / room finished while still `live`).

export type AutoEndReason = 'host_absent' | 'room_finished';

export interface LiveControl {
  autoEnd(sessionId: string, reason: AutoEndReason): Promise<void>;
}

export function createLiveControl(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): LiveControl {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/live-control`;
  return {
    async autoEnd(sessionId, reason) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_end', sessionId, reason }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // Body may carry the function's error code; never echo request headers.
        const text = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`live-control auto_end failed: HTTP ${res.status} ${text}`.trim());
      }
    },
  };
}
