/**
 * app/admin/settings.tsx — the «البث المباشر» rollout control (V23 P7,
 * app_config.live_enabled, migration 0145).
 *
 * Invariants:
 *  - three calm choices «متوقف» / «للمشرفين فقط» / «للجميع», each with its line;
 *  - the saved level is the selected one; a missing row / unknown value = «متوقف»;
 *  - «متوقف» and «للمشرفين فقط» save at once through set_app_config (the same
 *    useSetAppConfig the other settings use) with key `live_enabled`;
 *  - «للجميع» asks first — «إلغاء» saves nothing; «إتاحة للجميع» saves 'all';
 *  - a failed save goes back to the previous level and says so in Arabic.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/hooks/useAdminGuard', () => ({ useAdminOnly: () => 'admin' }));

type MutateOpts = { onSuccess?: () => void; onError?: (e: unknown) => void };
const mockSettings = {
  config: {} as Record<string, string> | undefined,
  save: { mutate: jest.fn(), isPending: false },
};
jest.mock('@/hooks/useAppContent', () => ({
  useAdminConfig: () => ({ data: mockSettings.config }),
  useSetAppConfig: () => mockSettings.save,
}));

import AdminSettings from '../../app/admin/settings';

const radio = (label: string) => screen.getByRole('radio', { name: new RegExp(label) });
const liveSaves = () =>
  mockSettings.save.mutate.mock.calls.filter(([vars]) => (vars as { key: string }).key === 'live_enabled');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(Date.parse('2026-09-29T18:00:00Z'));
  mockSettings.config = { live_enabled: 'off' };
  mockSettings.save = {
    mutate: jest.fn((_vars: unknown, opts?: MutateOpts) => opts?.onSuccess?.()),
    isPending: false,
  };
});
afterEach(() => {
  jest.useRealTimers();
});

test('three choices, each with its explanatory line', async () => {
  await render(<AdminSettings />);
  expect(screen.getByText('البث المباشر')).toBeTruthy();
  expect(screen.getByText('متوقف')).toBeTruthy();
  expect(screen.getByText('للمشرفين فقط')).toBeTruthy();
  expect(screen.getByText('للجميع')).toBeTruthy();
  expect(screen.getByText('لا يظهر البث المباشر لأحد، ولا يمكن فتح مجلس جديد.')).toBeTruthy();
  expect(screen.getByText(/يراه المشرفون والناشرون والمشايخ وحدهم/)).toBeTruthy();
  expect(screen.getByText('يظهر لجميع الطلاب والزوار، ويصلهم إشعار عند بدء كل مجلس.')).toBeTruthy();
});

test('the saved level is selected', async () => {
  mockSettings.config = { live_enabled: 'staff' };
  await render(<AdminSettings />);
  expect(radio('للمشرفين فقط')).toBeChecked();
  expect(radio('متوقف')).not.toBeChecked();
  expect(radio('للجميع')).not.toBeChecked();
});

test.each([
  ['a missing row', {}],
  ['an unknown value', { live_enabled: 'yes' }],
])('%s reads as «متوقف»', async (_label, config) => {
  mockSettings.config = config;
  await render(<AdminSettings />);
  expect(radio('متوقف')).toBeChecked();
  expect(radio('للجميع')).not.toBeChecked();
});

test('«للمشرفين فقط» saves at once through set_app_config', async () => {
  await render(<AdminSettings />);
  await fireEvent.press(screen.getByText('للمشرفين فقط'));
  expect(liveSaves()).toEqual([[{ key: 'live_enabled', value: 'staff' }, expect.any(Object)]]);
  expect(screen.queryByText('إتاحة البث المباشر للجميع؟')).toBeNull();
  expect(radio('للمشرفين فقط')).toBeChecked();
  expect(screen.getByText('تم الحفظ')).toBeTruthy();
});

test('«متوقف» saves at once too (turning it off needs no confirmation)', async () => {
  mockSettings.config = { live_enabled: 'all' };
  await render(<AdminSettings />);
  await fireEvent.press(screen.getByText('متوقف'));
  expect(liveSaves()).toEqual([[{ key: 'live_enabled', value: 'off' }, expect.any(Object)]]);
});

test('«للجميع» asks first: «إلغاء» saves nothing', async () => {
  await render(<AdminSettings />);
  await fireEvent.press(screen.getByText('للجميع'));
  expect(screen.getByText('إتاحة البث المباشر للجميع؟')).toBeTruthy();
  expect(screen.getByText('سيظهر البث المباشر لجميع الطلاب والزوار، ويصلهم إشعار عند بدء كل مجلس.')).toBeTruthy();
  expect(liveSaves()).toEqual([]);

  await fireEvent.press(screen.getByText('إلغاء'));
  expect(liveSaves()).toEqual([]);
  expect(screen.queryByText('إتاحة البث المباشر للجميع؟')).toBeNull();
  expect(radio('متوقف')).toBeChecked();
});

test('«للجميع» → «إتاحة للجميع» saves all', async () => {
  mockSettings.config = { live_enabled: 'staff' };
  await render(<AdminSettings />);
  await fireEvent.press(screen.getByText('للجميع'));
  await fireEvent.press(screen.getByText('إتاحة للجميع'));
  expect(liveSaves()).toEqual([[{ key: 'live_enabled', value: 'all' }, expect.any(Object)]]);
  expect(radio('للجميع')).toBeChecked();
  expect(screen.queryByText('إتاحة البث المباشر للجميع؟')).toBeNull();
});

test('a failed save goes back to the previous level and says so', async () => {
  mockSettings.save.mutate = jest.fn((_vars: unknown, opts?: MutateOpts) => opts?.onError?.(new Error('boom')));
  mockSettings.config = { live_enabled: 'staff' };
  await render(<AdminSettings />);
  await fireEvent.press(screen.getByText('متوقف'));
  expect(screen.getByText('تعذّر حفظ إعداد البث المباشر، أعد المحاولة.')).toBeTruthy();
  expect(radio('للمشرفين فقط')).toBeChecked();
  expect(radio('متوقف')).not.toBeChecked();
});

test('nothing can be chosen before the settings have loaded', async () => {
  mockSettings.config = undefined;
  await render(<AdminSettings />);
  await fireEvent.press(screen.getByText('للمشرفين فقط'));
  expect(liveSaves()).toEqual([]);
});
