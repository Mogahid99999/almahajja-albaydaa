/**
 * «اختر القسم» on the staff «البث المباشر» screen (owner 2026-09-29: the old
 * full-screen dropdown with flat rows — «حسن ال ui»). A bottom sheet with a
 * search box and the tree: each row names its parent path and its own lecture
 * count, so staging's two «العقيدة» roots (each with an «التوحيد») are told
 * apart, and each section is listed exactly once.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';

jest.mock('@/hooks/useSections', () => ({
  useSectionsFlat: () => ({
    isLoading: false,
    data: [
      { id: 'a1', title: 'العقيدة', parentId: null, depth: 0, path: ['العقيدة'], order: 0 },
      { id: 'a1t', title: 'التوحيد', parentId: 'a1', depth: 1, path: ['العقيدة', 'التوحيد'], order: 0 },
      { id: 'a2', title: 'العقيدة', parentId: null, depth: 0, path: ['العقيدة'], order: 1 },
      { id: 'a2t', title: 'التوحيد', parentId: 'a2', depth: 1, path: ['العقيدة', 'التوحيد'], order: 1 },
      { id: 'w', title: 'دروس النساء', parentId: null, depth: 0, path: ['دروس النساء'], order: 2 },
    ],
  }),
}));
jest.mock('@/hooks/useAdmin', () => ({
  useAdminLectures: () => ({
    data: [
      { sectionId: 'a1t' },
      ...Array.from({ length: 4 }, () => ({ sectionId: 'a2t' })),
      ...Array.from({ length: 15 }, () => ({ sectionId: 'a2' })),
    ],
  }),
}));

import { SectionPicker } from '@/components/admin/live/SectionPickerSheet';

const onChange = jest.fn();

async function openPicker(value: string | null = null) {
  await render(<SectionPicker value={value} onChange={onChange} />);
  await fireEvent.press(screen.getByText('اختر القسم...'));
}

test('opens a sheet: title, search, each section once with its path and counts', async () => {
  await openPicker();
  expect(screen.getByText('اختر القسم')).toBeTruthy();
  expect(screen.getByLabelText('ابحث في الأقسام')).toBeTruthy();

  const rows = screen.getAllByRole('button').filter((b) => /محاضر|قسم فرعي|لا محاضرات/.test(b.props.accessibilityLabel ?? ''));
  expect(rows).toHaveLength(5); // not rendered twice
  // The two «العقيدة» roots are distinguishable.
  expect(screen.getByLabelText('العقيدة، لا محاضرات · قسم فرعي واحد · رقم الترتيب ٠')).toBeTruthy();
  expect(screen.getByLabelText('العقيدة، ١٥ محاضرة · قسم فرعي واحد · رقم الترتيب ١')).toBeTruthy();
  // Children show their parent path under the title.
  const child = screen.getByLabelText('العقيدة › التوحيد، ٤ محاضرات · رقم الترتيب ١');
  expect(within(child).getByText('العقيدة')).toBeTruthy();
  expect(within(child).getByText('التوحيد')).toBeTruthy();
});

test('search narrows the list (diacritics ignored), and a tap selects + closes', async () => {
  await openPicker();
  await fireEvent.changeText(screen.getByLabelText('ابحث في الأقسام'), 'التّوحيد');
  expect(screen.queryByText('دروس النساء')).toBeNull();
  expect(screen.getAllByText('التوحيد')).toHaveLength(2);

  await fireEvent.changeText(screen.getByLabelText('ابحث في الأقسام'), 'فقه');
  expect(screen.getByText('لا يوجد قسم بهذا الاسم')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('ابحث في الأقسام'), 'التوحيد');
  await fireEvent.press(screen.getByLabelText('العقيدة › التوحيد، ٤ محاضرات · رقم الترتيب ١'));
  expect(onChange).toHaveBeenCalledWith('a2t');
  expect(screen.queryByText('اختر القسم')).toBeNull();
});

test('the field shows the chosen section with its parent path; the row is marked selected', async () => {
  await render(<SectionPicker value="a2t" onChange={onChange} />);
  const field = screen.getByLabelText('القسم: العقيدة › التوحيد');
  expect(within(field).getByText('التوحيد')).toBeTruthy();
  expect(within(field).getByText('العقيدة')).toBeTruthy();

  await fireEvent.press(field);
  const row = screen.getByLabelText('العقيدة › التوحيد، ٤ محاضرات · رقم الترتيب ١');
  expect(row.props.accessibilityState).toMatchObject({ selected: true });
});
