/**
 * src/stores/celebrationStore.ts — the achievement celebration queue (V20 · §15).
 *
 * Invariants pinned here:
 *  - events show ONE AT A TIME; dismissing promotes the next (source §15
 *    "تُجمع الإنجازات المتزامنة في نافذة واحدة بالتتابع");
 *  - the server claim (`try_claim_celebration`) gates enqueue — a false claim
 *    (already celebrated elsewhere / a network hiccup) shows nothing;
 *  - the same key never queues twice within a session, even racing;
 *  - the quiz suppression gate holds promotion until cleared, then pumps (§15
 *    "لا يظهر قبل إعلان نتيجة الاختبار").
 */
import type { CelebrationEvent } from '@/api/types';

const mockTryClaim = jest.fn<Promise<boolean>, [string]>();
jest.mock('@/api/celebrations', () => ({
  tryClaimCelebration: (key: string) => mockTryClaim(key),
}));

// Import AFTER the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { useCelebrationStore } from '@/stores/celebrationStore';

const ev = (key: string, over: Partial<CelebrationEvent> = {}): CelebrationEvent => ({
  key,
  level: 'medium',
  titleAr: 'عنوان',
  bodyAr: 'وصف',
  ...over,
});

const reset = () =>
  useCelebrationStore.setState({ queue: [], current: null, suppressed: false });

beforeEach(() => {
  mockTryClaim.mockReset();
  mockTryClaim.mockResolvedValue(true); // default: claim succeeds
  reset();
});

describe('celebrationStore', () => {
  it('shows a claimed event and clears when dismissed', async () => {
    await useCelebrationStore.getState().celebrate(ev('badge:completed_1'));
    expect(useCelebrationStore.getState().current?.key).toBe('badge:completed_1');

    useCelebrationStore.getState().dismissCurrent();
    expect(useCelebrationStore.getState().current).toBeNull();
  });

  it('shows concurrent events one at a time, in order', async () => {
    await useCelebrationStore.getState().celebrate(ev('a'));
    await useCelebrationStore.getState().celebrate(ev('b'));

    // First is current, second waits in the queue.
    expect(useCelebrationStore.getState().current?.key).toBe('a');
    expect(useCelebrationStore.getState().queue.map((e) => e.key)).toEqual(['b']);

    useCelebrationStore.getState().dismissCurrent();
    expect(useCelebrationStore.getState().current?.key).toBe('b');
    expect(useCelebrationStore.getState().queue).toHaveLength(0);
  });

  it('shows nothing when the server claim is rejected', async () => {
    mockTryClaim.mockResolvedValue(false);
    await useCelebrationStore.getState().celebrate(ev('already-celebrated'));
    expect(useCelebrationStore.getState().current).toBeNull();
    expect(useCelebrationStore.getState().queue).toHaveLength(0);
  });

  it('never enqueues the same key twice in a session', async () => {
    await useCelebrationStore.getState().celebrate(ev('dup'));
    await useCelebrationStore.getState().celebrate(ev('dup'));
    // The second call is short-circuited BEFORE claiming (dedup guard).
    expect(mockTryClaim).toHaveBeenCalledTimes(1);
    expect(useCelebrationStore.getState().current?.key).toBe('dup');
    expect(useCelebrationStore.getState().queue).toHaveLength(0);
  });

  it('holds promotion while suppressed, then pumps on release', async () => {
    useCelebrationStore.getState().setSuppressed(true);
    await useCelebrationStore.getState().celebrate(ev('mid-quiz'));

    // Claimed + queued, but NOT shown while a quiz is in progress.
    expect(useCelebrationStore.getState().current).toBeNull();
    expect(useCelebrationStore.getState().queue.map((e) => e.key)).toEqual(['mid-quiz']);

    useCelebrationStore.getState().setSuppressed(false);
    expect(useCelebrationStore.getState().current?.key).toBe('mid-quiz');
  });

  it('enqueueClaimed skips the server claim', () => {
    useCelebrationStore.getState().enqueueClaimed(ev('preclaimed'));
    expect(mockTryClaim).not.toHaveBeenCalled();
    expect(useCelebrationStore.getState().current?.key).toBe('preclaimed');
  });
});
