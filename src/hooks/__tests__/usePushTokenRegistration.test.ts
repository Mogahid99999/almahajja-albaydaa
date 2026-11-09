import { act, renderHook } from '@testing-library/react-native';

import { useNotificationsStore } from '@/stores/notificationsStore';

import { usePushTokenRegistration } from '../usePushTokenRegistration';

const mockRegister = jest.fn(async (_token: string, _platform: string) => {});
jest.mock('@/api/notifications', () => ({
  registerPushToken: (token: string, platform: string) => mockRegister(token, platform),
}));
jest.mock('@/lib/notifications', () => ({
  ensurePermission: async () => 'granted',
  getToken: async () => 'ExponentPushToken[device]',
}));
jest.mock('@/lib/pushTokenRegistry', () => ({
  registerPushTokenIfChanged: async (_t: string, _u: string, register: () => Promise<void>) => register(),
}));

const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });
const mount = (id: string) =>
  renderHook((p: { id?: string }) => usePushTokenRegistration(p.id), { initialProps: { id } });

describe('usePushTokenRegistration', () => {
  beforeEach(() => {
    mockRegister.mockClear();
    useNotificationsStore.setState({ registeredUserId: null, token: null });
  });

  it('registers again when a guest signs in during the same run', async () => {
    const view = await mount('guest');
    await flush();
    expect(mockRegister).toHaveBeenCalledTimes(1);
    await view.rerender({ id: 'student' });
    await flush();
    expect(mockRegister).toHaveBeenCalledTimes(2);
    expect(useNotificationsStore.getState().registeredUserId).toBe('student');
  });

  it('does not register twice for the same account in one run', async () => {
    const view = await mount('student');
    await flush();
    await view.rerender({ id: 'student' });
    await flush();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('registers again after sign-out clears the flag for the same account', async () => {
    await mount('student');
    await flush();
    await act(async () => { useNotificationsStore.getState().setRegisteredUserId(null); });
    await flush();
    expect(mockRegister).toHaveBeenCalledTimes(2);
  });
});
