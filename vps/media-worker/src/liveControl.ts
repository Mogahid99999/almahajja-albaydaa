// Calls the `live-control` edge function as the service role — used for the
// D4 auto-end (host absent 10 min / room finished while still `live`) and, since
// 0146, `resume_recording` (a new egress for a live session whose egress died).

export type AutoEndReason = 'host_absent' | 'room_finished';
/** supabase/functions/_shared/liveRules.ts RESUME_REASONS. */
export type ResumeReason = 'egress_failed' | 'egress_ended';

export type ResumeResult =
  | { status: 'resumed'; egressId: string | null; seq: number | null }
  /** 404 / 409: session not live any more, a part is still recording, room gone… — nothing to do. */
  | { status: 'refused'; httpStatus: number; detail: string };

export interface LiveControl {
  autoEnd(sessionId: string, reason: AutoEndReason): Promise<void>;
  resumeRecording(sessionId: string, reason: ResumeReason): Promise<ResumeResult>;
}

export function createLiveControl(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): LiveControl {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/live-control`;
  const post = (body: Record<string, unknown>) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  // Body may carry the function's error code; never echo request headers.
  const bodyText = async (res: Response) => (await res.text().catch(() => '')).slice(0, 200);

  return {
    async autoEnd(sessionId, reason) {
      const res = await post({ action: 'auto_end', sessionId, reason });
      if (!res.ok) {
        throw new Error(`live-control auto_end failed: HTTP ${res.status} ${await bodyText(res)}`.trim());
      }
    },

    async resumeRecording(sessionId, reason) {
      const res = await post({ action: 'resume_recording', sessionId, reason });
      const text = await bodyText(res);
      if (res.ok) {
        let parsed: { egressId?: unknown; seq?: unknown } = {};
        try {
          parsed = JSON.parse(text) as typeof parsed;
        } catch {
          // 2xx without a readable body: still resumed.
        }
        return {
          status: 'resumed',
          egressId: typeof parsed.egressId === 'string' ? parsed.egressId : null,
          seq: typeof parsed.seq === 'number' ? parsed.seq : null,
        };
      }
      if (res.status === 404 || res.status === 409) return { status: 'refused', httpStatus: res.status, detail: text };
      throw new Error(`live-control resume_recording failed: HTTP ${res.status} ${text}`.trim());
    },
  };
}
