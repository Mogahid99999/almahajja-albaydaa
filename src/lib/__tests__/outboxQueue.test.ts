/**
 * src/lib/outboxQueue.ts — offline outbox storage.
 *
 * Guards the audited contracts:
 *  - coalescing per (lectureId, day) / per-note / single-goal entries
 *  - the 120-activity cap dropping oldest DAYS first
 *  - clearQueue() at identity boundaries (audit F-025): same array reference,
 *    generation bump so an in-flight flush aborts its stale snapshot
 *  - localDay() is device-local (audit F-043's day-attribution contract)
 */
import type AsyncStorageType from '@react-native-async-storage/async-storage';

// The module keeps a lazily-loaded in-memory mirror — isolate it per test.
// AsyncStorage must be re-required AFTER resetModules so the test observes the
// same mock instance the module under test writes to.
type OutboxModule = typeof import('../outboxQueue');
let outbox: OutboxModule;
let storage: typeof AsyncStorageType;

// The jest mock is CJS (module.exports = mock) — handle both interop shapes.
const requireStorage = (): typeof AsyncStorageType => {
  const mod = require('@react-native-async-storage/async-storage') as
    | typeof AsyncStorageType
    | { default: typeof AsyncStorageType };
  return 'default' in mod ? mod.default : mod;
};

beforeEach(() => {
  jest.resetModules();
  storage = requireStorage();
  outbox = require('../outboxQueue') as OutboxModule;
});

const baseActivity = {
  lectureId: 'lec-1',
  day: '2026-07-15',
  positionSec: 100,
  durationSec: 600,
  deltaSec: 30,
  completed: false,
};

describe('localDay', () => {
  test('formats YYYY-MM-DD from the device-local calendar, zero-padded', () => {
    expect(outbox.localDay(new Date(2026, 6, 5, 23, 59))).toBe('2026-07-05');
    expect(outbox.localDay(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  test('uses local time, not UTC (the F-043 split-brain guard)', () => {
    // 23:30 local is a different UTC day for any UTC+ timezone; localDay must
    // stay on the local calendar day regardless.
    const lateEvening = new Date(2026, 6, 15, 23, 30);
    expect(outbox.localDay(lateEvening)).toBe('2026-07-15');
  });
});

describe('enqueueActivity coalescing', () => {
  test('same (lectureId, day) coalesces: delta accumulates, position takes max, completed sticks', async () => {
    await outbox.enqueueActivity({ ...baseActivity });
    await outbox.enqueueActivity({
      ...baseActivity,
      positionSec: 80, // earlier position must NOT regress the stored one
      deltaSec: 45,
      completed: true,
    });
    await outbox.enqueueActivity({ ...baseActivity, positionSec: 90, completed: false });

    const q = await outbox.loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      kind: 'activity',
      deltaSec: 30 + 45 + 30,
      positionSec: 100,
      completed: true, // once completed, a later un-completed tick can't revoke it
    });
  });

  test('negative deltas are clamped to zero (scrub-guard hygiene)', async () => {
    await outbox.enqueueActivity({ ...baseActivity, deltaSec: -50 });
    const q = await outbox.loadQueue();
    expect((q[0] as { deltaSec: number }).deltaSec).toBe(0);
  });

  test('different day or lecture makes a separate entry', async () => {
    await outbox.enqueueActivity({ ...baseActivity });
    await outbox.enqueueActivity({ ...baseActivity, day: '2026-07-16' });
    await outbox.enqueueActivity({ ...baseActivity, lectureId: 'lec-2' });
    expect(await outbox.loadQueue()).toHaveLength(3);
  });

  test('a zero duration does not clobber a known duration', async () => {
    await outbox.enqueueActivity({ ...baseActivity, durationSec: 600 });
    await outbox.enqueueActivity({ ...baseActivity, durationSec: 0 });
    const q = await outbox.loadQueue();
    expect((q[0] as { durationSec: number }).durationSec).toBe(600);
  });
});

describe('activity cap (120 entries, oldest days dropped first)', () => {
  test('drops the oldest days and keeps notes/goals untouched', async () => {
    await outbox.enqueueNote('lec-note', 'نص الملاحظة');
    await outbox.enqueueGoal('lectures', 3);
    for (let i = 0; i < 125; i++) {
      const day = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
      await outbox.enqueueActivity({ ...baseActivity, lectureId: `lec-${i}`, day });
    }
    const q = await outbox.loadQueue();
    const activities = q.filter((e) => e.kind === 'activity');
    expect(activities).toHaveLength(120);
    // 125 entries over days 01..28 puts 5 entries on each of days 01..13;
    // dropping the 5 oldest must wipe day 01 exactly — nothing newer.
    const days = activities.map((a) => (a as { day: string }).day).sort();
    expect(days[0]).toBe('2026-01-02');
    expect(q.some((e) => e.kind === 'note')).toBe(true);
    expect(q.some((e) => e.kind === 'goal')).toBe(true);
  });
});

describe('note and goal entries (last write wins)', () => {
  test('one note entry per lecture; body replaced in place', async () => {
    await outbox.enqueueNote('lec-1', 'أولى');
    await outbox.enqueueNote('lec-1', 'ثانية');
    await outbox.enqueueNote('lec-2', 'أخرى');
    const q = await outbox.loadQueue();
    const notes = q.filter((e) => e.kind === 'note');
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => (n as { lectureId: string }).lectureId === 'lec-1')).toMatchObject({
      body: 'ثانية',
    });
  });

  test('a single goal entry total', async () => {
    await outbox.enqueueGoal('lectures', 3);
    await outbox.enqueueGoal('minutes', 90);
    const q = await outbox.loadQueue();
    const goals = q.filter((e) => e.kind === 'goal');
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ metric: 'minutes', target: 90 });
  });
});

describe('removeQueueEntry / hasPending', () => {
  test('removes exactly the committed entry by reference', async () => {
    await outbox.enqueueActivity({ ...baseActivity });
    await outbox.enqueueNote('lec-1', 'ملاحظة');
    const q = await outbox.loadQueue();
    await outbox.removeQueueEntry(q[0]);
    expect(await outbox.loadQueue()).toHaveLength(1);
    expect(await outbox.hasPending()).toBe(true);
    await outbox.removeQueueEntry((await outbox.loadQueue())[0]);
    expect(await outbox.hasPending()).toBe(false);
  });
});

describe('clearQueue — the identity-boundary contract (audit F-025)', () => {
  test('empties the queue while KEEPING the same array reference', async () => {
    await outbox.enqueueActivity({ ...baseActivity });
    const before = await outbox.loadQueue();
    await outbox.clearQueue();
    const after = await outbox.loadQueue();
    expect(after).toBe(before); // an in-flight flush's reference sees the wipe
    expect(after).toHaveLength(0);
  });

  test('bumps the generation counter so a mid-loop flush can abort', async () => {
    const g0 = outbox.queueGeneration();
    await outbox.clearQueue();
    expect(outbox.queueGeneration()).toBe(g0 + 1);
    await outbox.clearQueue();
    expect(outbox.queueGeneration()).toBe(g0 + 2);
  });
});

describe('persistence across module reload (app restart)', () => {
  // jest.resetModules() also re-instantiates the AsyncStorage mock (fresh empty
  // store), so a "restart" is simulated by carrying the serialized queue over
  // to the NEW storage instance the fresh module will read from.
  const KEY = 'offline-outbox-v1';
  const freshWithStoredValue = async (raw: string): Promise<OutboxModule> => {
    jest.resetModules();
    await requireStorage().setItem(KEY, raw);
    return require('../outboxQueue') as OutboxModule;
  };

  test('queue survives a reload via AsyncStorage', async () => {
    await outbox.enqueueActivity({ ...baseActivity });
    const raw = await storage.getItem(KEY);
    expect(raw).toContain('lec-1'); // enqueue really persisted, not just the mirror
    const fresh = await freshWithStoredValue(raw!);
    const q = await fresh.loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'activity', lectureId: 'lec-1' });
  });

  test('corrupt stored JSON degrades to an empty queue, never a crash', async () => {
    const fresh = await freshWithStoredValue('{not json');
    expect(await fresh.loadQueue()).toEqual([]);
  });

  test('onEnqueue callback fires after every enqueue (arms the flush heartbeat)', async () => {
    const cb = jest.fn();
    outbox.setOnEnqueue(cb);
    await outbox.enqueueActivity({ ...baseActivity });
    await outbox.enqueueNote('lec-1', 'ن');
    await outbox.enqueueGoal('lectures', 3);
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
