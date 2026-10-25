/**
 * src/api/schedule.ts (0158) — get_schedule is ONE rpc and its jsonb is
 * shape-checked (a malformed row is dropped, never crashes the screen; only a
 * literal true means «may edit»); moderators' writes go straight to the tables
 * (RLS can_edit_schedule is the gate) with the right columns.
 */
const mockRpc = jest.fn();
const mockCalls: { table: string; op: string; args: unknown[] }[] = [];
function mockChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const op of ['insert', 'update', 'upsert', 'delete', 'eq', 'select']) {
    chain[op] = (...args: unknown[]) => {
      mockCalls.push({ table, op, args });
      return chain;
    };
  }
  chain.single = async () => ({ data: { id: 'new-id' }, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return chain;
}
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (t: string) => mockChain(t),
  },
}));
jest.mock('@/config', () => ({ USE_MOCK: false }));

import { getSchedule, parseSchedule, saveScheduleException, saveScheduleItem } from '@/api/schedule';

beforeEach(() => {
  mockRpc.mockReset();
  mockCalls.length = 0;
});

const ROW = {
  id: 'A',
  title: 'كتاب التوحيد',
  subtitle: '',
  subject: 'العقيدة',
  sheikh_id: 'sh1',
  sheikh_name: 'الشيخ النذير محمد',
  section_id: 'sec1',
  section_title: 'كتاب التوحيد',
  audience: 'female',
  days: [4, 0, 4, 9],
  start_time: '21:30',
  duration_min: 60,
  note: null,
  is_active: true,
  sort_order: 2,
};

test('one rpc, no arguments', async () => {
  mockRpc.mockResolvedValue({ data: { version: '7', items: [], exceptions: [], can_edit: false }, error: null });
  await expect(getSchedule()).resolves.toMatchObject({ version: '7', canEdit: false });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('get_schedule');
});

test('maps a row; days de-duplicated and kept in 0–6; blanks become null', () => {
  const s = parseSchedule({ version: '7', items: [ROW], exceptions: [], can_edit: true });
  expect(s.canEdit).toBe(true);
  expect(s.items[0]).toEqual({
    id: 'A',
    title: 'كتاب التوحيد',
    subtitle: null,
    subject: 'العقيدة',
    sheikhId: 'sh1',
    sheikhName: 'الشيخ النذير محمد',
    sectionId: 'sec1',
    sectionTitle: 'كتاب التوحيد',
    audience: 'female',
    days: [4, 0],
    startTime: '21:30',
    durationMin: 60,
    note: null,
    isActive: true,
    sortOrder: 2,
  });
});

test('fail safe: malformed rows are dropped, «can_edit» only on a literal true', () => {
  const s = parseSchedule({
    items: [ROW, { ...ROW, id: 'bad-time', start_time: '9pm' }, { ...ROW, id: 'no-days', days: [] }, null],
    exceptions: [
      { id: 'e1', item_id: 'A', occurs_on: '2026-10-08', kind: 'cancelled' },
      { id: 'e2', item_id: 'A', occurs_on: '2026-10-11', kind: 'deleted' },
      { id: 'e3', item_id: 'A', occurs_on: 'soon', kind: 'cancelled' },
    ],
    can_edit: 'true',
  });
  expect(s.items.map((i) => i.id)).toEqual(['A']);
  expect(s.exceptions.map((e) => e.id)).toEqual(['e1']);
  expect(s.canEdit).toBe(false);
  expect(parseSchedule(null)).toEqual({ version: null, items: [], exceptions: [], canEdit: false });
});

test('saving a lesson with a sheikhs row leaves the free name empty (the row is the truth)', async () => {
  await saveScheduleItem({
    title: '  كتاب التوحيد ',
    subtitle: ' ',
    subject: null,
    sheikhId: 'sh1',
    sheikhName: 'الشيخ النذير محمد',
    sectionId: null,
    audience: 'all',
    days: [4, 0, 4],
    startTime: '21:30',
    durationMin: null,
    note: null,
    isActive: true,
  });
  const insert = mockCalls.find((c) => c.op === 'insert')!;
  expect(insert.table).toBe('schedule_items');
  expect(insert.args[0]).toMatchObject({ title: 'كتاب التوحيد', subtitle: null, sheikh_id: 'sh1', sheikh_name: null, days: [0, 4] });
});

test('editing updates by id instead of inserting', async () => {
  await saveScheduleItem({
    id: 'A',
    title: 'كتاب التوحيد',
    subtitle: null,
    subject: null,
    sheikhId: null,
    sheikhName: 'شيخ زائر',
    sectionId: null,
    audience: 'male',
    days: [5],
    startTime: '17:00',
    durationMin: 45,
    note: null,
    isActive: false,
  });
  expect(mockCalls.some((c) => c.op === 'insert')).toBe(false);
  expect(mockCalls.find((c) => c.op === 'update')!.args[0]).toMatchObject({ sheikh_name: 'شيخ زائر', is_active: false });
  expect(mockCalls.find((c) => c.op === 'eq')!.args).toEqual(['id', 'A']);
});

test('one date: upsert on (item_id, occurs_on); a cancellation carries no new date/time', async () => {
  await saveScheduleException({ itemId: 'A', occursOn: '2026-10-08', kind: 'cancelled', newDate: '2026-10-09', newTime: '20:00', note: ' ' });
  const up = mockCalls.find((c) => c.op === 'upsert')!;
  expect(up.table).toBe('schedule_exceptions');
  expect(up.args[0]).toEqual({ item_id: 'A', occurs_on: '2026-10-08', kind: 'cancelled', new_date: null, new_time: null, note: null });
  expect(up.args[1]).toEqual({ onConflict: 'item_id,occurs_on' });
});
