/**
 * «ورد القرآن اليومي» — the device-side rules (src/mushaf/wird.ts):
 * goal create / edit / remove, each printed page counted once a day,
 * progress adding up across sessions, completion exactly once, a new day
 * resetting the pages only, and the one server fact (the completed day)
 * queued once — offline-safe through the outbox.
 */
const mockEnqueueWirdDay = jest.fn(async (_day: string) => {});
const mockFlush = jest.fn(async () => {});
let mockToday = '2026-10-26';
jest.mock('@/lib/outboxQueue', () => ({
  enqueueWirdDay: (day: string) => mockEnqueueWirdDay(day),
  localDay: () => mockToday,
}));
jest.mock('@/lib/outbox', () => ({ flushOutbox: () => mockFlush() }));

import {
  EMPTY_WIRD,
  creditPage,
  dwellMsFor,
  parseWirdGoal,
  useWirdStore,
  withGoal,
  wirdProgress,
} from '../wird';
import { useMushafStore } from '../store';

const D1 = '2026-10-26';
const D2 = '2026-10-27';

beforeEach(() => {
  mockToday = D1;
  mockEnqueueWirdDay.mockClear();
  mockFlush.mockClear();
  useWirdStore.setState({ ...EMPTY_WIRD });
});

describe('goal', () => {
  test('custom goals: whole pages between 1 and 60, Arabic digits accepted', () => {
    expect(parseWirdGoal('5')).toBe(5);
    expect(parseWirdGoal('١٢')).toBe(12);
    expect(parseWirdGoal(' 60 ')).toBe(60);
    for (const bad of ['0', '61', '-3', '2.5', '', 'abc', '1e1']) expect(parseWirdGoal(bad)).toBeNull();
  });

  test('create, edit and remove the goal; today’s pages are kept', () => {
    const st = useWirdStore.getState();
    st.setGoal(5);
    expect(useWirdStore.getState()).toMatchObject({ goal: 5, configured: true });
    useWirdStore.getState().credit(10);
    useWirdStore.getState().setGoal(10);
    expect(wirdProgress(useWirdStore.getState(), D1)).toEqual({ goal: 10, count: 1, done: false });
    useWirdStore.getState().setGoal(null);
    expect(useWirdStore.getState()).toMatchObject({ goal: null, configured: true, pages: [10] });
    expect(wirdProgress(useWirdStore.getState(), D1).done).toBe(false);
  });

  test('raising the goal after finishing shows the new remainder, without a second completion', () => {
    useWirdStore.getState().setGoal(2);
    useWirdStore.getState().credit(1);
    expect(useWirdStore.getState().credit(2)).toBe(true);
    useWirdStore.getState().setGoal(4);
    expect(wirdProgress(useWirdStore.getState(), D1)).toEqual({ goal: 4, count: 2, done: false });
    useWirdStore.getState().credit(3);
    expect(useWirdStore.getState().credit(4)).toBe(false); // already completed once today
    expect(wirdProgress(useWirdStore.getState(), D1).done).toBe(true);
    expect(mockEnqueueWirdDay).toHaveBeenCalledTimes(1);
  });

  test('lowering the goal under what was read today completes it (once)', () => {
    let s = withGoal(EMPTY_WIRD, 5, D1).next;
    s = creditPage(s, 1, D1).next;
    s = creditPage(s, 2, D1).next;
    const lowered = withGoal(s, 2, D1);
    expect(lowered.completedNow).toBe(true);
    expect(withGoal(lowered.next, 1, D1).completedNow).toBe(false);
  });
});

describe('counting pages', () => {
  test('a page counts once a day — returning to it changes nothing', () => {
    let s = withGoal(EMPTY_WIRD, 5, D1).next;
    const a = creditPage(s, 300, D1);
    expect(a.credited).toBe(true);
    s = a.next;
    const again = creditPage(s, 300, D1);
    expect(again.credited).toBe(false);
    expect(again.next.pages).toEqual([300]);
  });

  test('out-of-range pages never count', () => {
    const s = withGoal(EMPTY_WIRD, 5, D1).next;
    for (const p of [0, 605, 1.5, NaN]) expect(creditPage(s, p, D1).credited).toBe(false);
  });

  test('two pages in the morning + three in the evening (app closed between) = 5', async () => {
    useWirdStore.getState().setGoal(5);
    useWirdStore.getState().credit(1);
    useWirdStore.getState().credit(2);
    // The app is killed: only what was persisted survives — rehydrate from storage.
    const persisted = JSON.parse(JSON.stringify(useWirdStore.getState()));
    useWirdStore.setState({ ...EMPTY_WIRD });
    useWirdStore.setState(persisted);
    expect(useWirdStore.getState().credit(3)).toBe(false);
    expect(useWirdStore.getState().credit(4)).toBe(false);
    expect(useWirdStore.getState().credit(2)).toBe(false); // read again — no change
    expect(useWirdStore.getState().credit(5)).toBe(true); // the fifth page completes it
    expect(wirdProgress(useWirdStore.getState(), D1)).toEqual({ goal: 5, count: 5, done: true });
  });

  test('completion happens once: later pages keep counting, no second event', () => {
    useWirdStore.getState().setGoal(2);
    useWirdStore.getState().credit(7);
    expect(useWirdStore.getState().credit(8)).toBe(true);
    expect(useWirdStore.getState().credit(9)).toBe(false);
    expect(useWirdStore.getState().credit(10)).toBe(false);
    expect(useWirdStore.getState().pages).toHaveLength(4);
    expect(mockEnqueueWirdDay).toHaveBeenCalledTimes(1);
    expect(mockEnqueueWirdDay).toHaveBeenCalledWith(D1);
  });

  test('no goal: nothing is ever completed or sent', () => {
    useWirdStore.getState().setGoal(null);
    for (let p = 1; p <= 12; p++) expect(useWirdStore.getState().credit(p)).toBe(false);
    expect(mockEnqueueWirdDay).not.toHaveBeenCalled();
  });

  test('the same printed page counts once whatever the mode or font size', () => {
    // The wird only ever sees the printed page number (1–604): the Madinah print,
    // the simplified text and the enlarged reflow all report the same page.
    useWirdStore.getState().setGoal(5);
    for (const _mode of ['print', 'simple', 'flex-1.4', 'flex-1.9']) useWirdStore.getState().credit(187);
    expect(useWirdStore.getState().pages).toEqual([187]);
  });
});

describe('a new day', () => {
  test('resets today’s pages only: goal, reading position, bookmarks and settings stay', () => {
    useMushafStore.setState({ lastPage: 250, bookmarks: [12, 250], fontLevel: 2 });
    useWirdStore.getState().setGoal(2);
    useWirdStore.getState().credit(250);
    useWirdStore.getState().credit(251);
    expect(wirdProgress(useWirdStore.getState(), D1).done).toBe(true);

    mockToday = D2;
    expect(wirdProgress(useWirdStore.getState(), D2)).toEqual({ goal: 2, count: 0, done: false });
    // Yesterday's pages count again today.
    expect(useWirdStore.getState().credit(251)).toBe(false);
    expect(useWirdStore.getState().credit(250)).toBe(true);
    expect(useWirdStore.getState()).toMatchObject({ goal: 2, day: D2 });
    expect(useMushafStore.getState()).toMatchObject({ lastPage: 250, bookmarks: [12, 250], fontLevel: 2 });
    expect(mockEnqueueWirdDay.mock.calls.map((c) => c[0])).toEqual([D1, D2]);
  });
});

describe('reading time per page', () => {
  test('short pages need less, never under 8 s; a full page at most 25 s', () => {
    expect(dwellMsFor(1)).toBe(8000); // الفاتحة
    for (const p of [2, 50, 187, 300, 450, 604]) {
      expect(dwellMsFor(p)).toBeGreaterThanOrEqual(8000);
      expect(dwellMsFor(p)).toBeLessThanOrEqual(25000);
    }
    expect(dwellMsFor(300)).toBeGreaterThan(15000); // a full 15-line page
  });
});
