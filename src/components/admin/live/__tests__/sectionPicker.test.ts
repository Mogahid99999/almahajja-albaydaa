/**
 * The live section picker's rows (owner 2026-09-29): staging has two root
 * sections both named «العقيدة», each with an «التوحيد». The owner read the
 * list as «العقيدة، التوحيد، العقيدة، التوحيد» and thought it was rendered
 * twice — it is not (each id appears once), but every row must now say which
 * one it is: its parent path, its own lecture count, and «رقم الترتيب» when the
 * very same path exists twice.
 */
import type { FlatSectionNode } from '@/api/types';

import { directLectureCounts, foldArabic, orderSectionTree, sectionPickerRows } from '../sectionPicker';

const node = (id: string, title: string, parentId: string | null, path: string[], order: number): FlatSectionNode => ({
  id,
  title,
  parentId,
  depth: path.length - 1,
  path,
  order,
});

// The staging tree, in the RPC's order.
const STAGING: FlatSectionNode[] = [
  node('a1', 'العقيدة', null, ['العقيدة'], 0),
  node('a1t', 'التوحيد', 'a1', ['العقيدة', 'التوحيد'], 0),
  node('a2', 'العقيدة', null, ['العقيدة'], 1),
  node('a2t', 'التوحيد', 'a2', ['العقيدة', 'التوحيد'], 1),
  node('w', 'دروس النساء', null, ['دروس النساء'], 2),
];

test('each section once, children right under their own parent', () => {
  // Same order + title on both roots used to interleave their children.
  const tied = STAGING.map((n) => ({ ...n, order: 0 }));
  const shuffled = [tied[0], tied[2], tied[1], tied[3], tied[4], tied[1]]; // + a duplicate row
  const ids = orderSectionTree(shuffled).map((n) => n.id);
  expect(ids).toHaveLength(5);
  expect(new Set(ids).size).toBe(5);
  expect(ids.indexOf('a1t')).toBe(ids.indexOf('a1') + 1);
  expect(ids.indexOf('a2t')).toBe(ids.indexOf('a2') + 1);
});

test('the two «العقيدة» rows are told apart by their counts and رقم الترتيب', () => {
  const counts = directLectureCounts([
    { sectionId: 'a1t' },
    { sectionId: 'a2t' },
    { sectionId: 'a2t' },
    { sectionId: 'a2t' },
    { sectionId: 'a2t' },
    ...Array.from({ length: 15 }, () => ({ sectionId: 'a2' })),
    { sectionId: null },
  ]);
  const rows = sectionPickerRows(STAGING, counts);
  expect(rows.map((r) => r.title)).toEqual(['العقيدة', 'التوحيد', 'العقيدة', 'التوحيد', 'دروس النساء']);
  expect(rows[0]).toMatchObject({ parentPath: null, meta: 'لا محاضرات · قسم فرعي واحد · رقم الترتيب ٠' });
  expect(rows[1]).toMatchObject({ parentPath: 'العقيدة', meta: 'محاضرة واحدة · رقم الترتيب ٠' });
  expect(rows[2]).toMatchObject({ parentPath: null, meta: '١٥ محاضرة · قسم فرعي واحد · رقم الترتيب ١' });
  expect(rows[3]).toMatchObject({ parentPath: 'العقيدة', meta: '٤ محاضرات · رقم الترتيب ١' });
  // A unique path needs no رقم الترتيب.
  expect(rows[4]).toMatchObject({ parentPath: null, meta: 'لا محاضرات' });
});

test('search matches the title or an ancestor, ignoring diacritics / hamza forms', () => {
  expect(sectionPickerRows(STAGING, null, 'التّوحيد').map((r) => r.id)).toEqual(['a1t', 'a2t']);
  expect(sectionPickerRows(STAGING, null, 'النساء').map((r) => r.id)).toEqual(['w']);
  expect(sectionPickerRows(STAGING, null, 'عقيده').map((r) => r.id)).toEqual(['a1', 'a1t', 'a2', 'a2t']);
  expect(sectionPickerRows(STAGING, null, 'فقه')).toEqual([]);
  expect(foldArabic('أُصول')).toBe('اصول');
});

test('no lecture list (e.g. still loading) → no count, the rest stays', () => {
  const rows = sectionPickerRows(STAGING, null);
  expect(rows[1].meta).toBe('رقم الترتيب ٠');
  expect(rows[4].meta).toBeNull();
});
