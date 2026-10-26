/**
 * «وردك اليومي» card on رحلتي العلمية — setup, edit, «بدون هدف يومي»,
 * today's progress and the quiet completion, all from the device-local wird
 * store. «ابدأ / تابع وردك» opens the reader at the last position (no page
 * param: the reading position stays the one source of where to continue).
 */
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/outboxQueue', () => ({ enqueueWirdDay: jest.fn(async () => {}), localDay: () => '2026-10-26' }));
jest.mock('@/lib/outbox', () => ({ flushOutbox: jest.fn(async () => {}) }));
jest.mock('@/mushaf/open', () => ({
  openMushafReader: (router: { push: (p: string) => void }) => router.push('/mushaf/read'),
}));

import { WirdCard } from '@/components/journey/WirdCard';
import { EMPTY_WIRD, useWirdStore } from '@/mushaf/wird';

beforeEach(() => {
  mockPush.mockClear();
  useWirdStore.setState({ ...EMPTY_WIRD });
});

test('first time: set a 5-page wird', async () => {
  const view = await render(<WirdCard />);
  await fireEvent.press(view.getByText('حدّد وردك'));
  await fireEvent.press(view.getByText('٥ صفحات'));
  await fireEvent.press(view.getByText('اعتمد ٥ صفحات يومياً'));
  expect(useWirdStore.getState()).toMatchObject({ goal: 5, configured: true });
  expect(view.getByText('اقرأ ٥ صفحات اليوم')).toBeTruthy();
  expect(view.getByText('٠ من ٥')).toBeTruthy();
  await fireEvent.press(view.getByText('ابدأ وردك'));
  expect(mockPush).toHaveBeenCalledWith('/mushaf/read');
});

test('a custom goal must be a whole number of pages within range', async () => {
  const view = await render(<WirdCard />);
  await fireEvent.press(view.getByText('حدّد وردك'));
  await fireEvent.press(view.getByText('عدد آخر'));
  await fireEvent.changeText(view.getByLabelText('عدد الصفحات في اليوم'), '٩٩');
  expect(view.getByText('اختر عدد الصفحات')).toBeTruthy();
  await fireEvent.press(view.getByText('اختر عدد الصفحات'));
  expect(useWirdStore.getState().configured).toBe(false);
  await fireEvent.changeText(view.getByLabelText('عدد الصفحات في اليوم'), '٢٠');
  await fireEvent.press(view.getByText('اعتمد ٢٠ صفحة يومياً'));
  expect(useWirdStore.getState().goal).toBe(20);
});

test('progress during the day, then edit the goal', async () => {
  useWirdStore.setState({ goal: 5, configured: true, day: '2026-10-26', pages: [3, 4] });
  const view = await render(<WirdCard />);
  expect(view.getByText('٢ من ٥')).toBeTruthy();
  expect(view.getByText('تابع وردك')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('تعديل الورد اليومي'));
  await fireEvent.press(view.getByText('١٠ صفحات'));
  await fireEvent.press(view.getByText('اعتمد ١٠ صفحات يومياً'));
  expect(view.getByText('٢ من ١٠')).toBeTruthy();
});

test('yesterday’s pages do not show today', async () => {
  useWirdStore.setState({ goal: 2, configured: true, day: '2026-10-25', pages: [3, 4], doneDay: '2026-10-25' });
  const view = await render(<WirdCard />);
  expect(view.getByText('٠ من ٢')).toBeTruthy();
  expect(view.getByText('ابدأ وردك')).toBeTruthy();
  expect(view.queryByText('أتممت وردك اليومي 🤍')).toBeNull();
});

test('completed: a quiet word of thanks, reading continues', async () => {
  useWirdStore.setState({ goal: 2, configured: true, day: '2026-10-26', pages: [3, 4, 5], doneDay: '2026-10-26' });
  const view = await render(<WirdCard />);
  expect(view.getByText('أتممت وردك اليومي 🤍')).toBeTruthy();
  expect(view.getByText('تقبّل الله منك وزادك علماً وهدى.')).toBeTruthy();
  expect(view.getByText('متابعة القراءة')).toBeTruthy();
});

test('«بدون هدف يومي»: no tracking, one quiet line that can set a wird later', async () => {
  useWirdStore.setState({ goal: 5, configured: true });
  const view = await render(<WirdCard />);
  await fireEvent.press(view.getByLabelText('تعديل الورد اليومي'));
  await fireEvent.press(view.getByText('بدون هدف يومي — أقرأ دون تتبّع'));
  expect(useWirdStore.getState()).toMatchObject({ goal: null, configured: true });
  expect(view.getByText('المصحف · بلا ورد يومي')).toBeTruthy();
  expect(view.getByText('حدّد ورداً')).toBeTruthy();
});
