import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerPushToken } from '@/api/notifications';
import { ensurePermission, getToken } from '@/lib/notifications';
import { registerPushTokenIfChanged } from '@/lib/pushTokenRegistry';
import { useNotificationsStore } from '@/stores/notificationsStore';

/**
 * Registers this device's push token for the account now signed in. Keyed on
 * the account id, so signing in from a guest session in the same run registers
 * the student at once instead of waiting for the next launch.
 */
export function usePushTokenRegistration(userId: string | undefined): void {
  const setPermission = useNotificationsStore((s) => s.setPermission);
  const setToken = useNotificationsStore((s) => s.setToken);
  const setRegisteredUserId = useNotificationsStore((s) => s.setRegisteredUserId);
  const registeredUserId = useNotificationsStore((s) => s.registeredUserId);

  useEffect(() => {
    if (!userId || registeredUserId === userId) return;
    let cancelled = false;
    (async () => {
      const status = await ensurePermission();
      if (cancelled) return;
      setPermission(status as 'granted' | 'denied' | 'undetermined');
      if (status !== 'granted') return;
      const token = await getToken();
      if (cancelled || !token) return;
      setToken(token);
      try {
        // LOAD V24: only when the token/account changed or the last write is a
        // week old, not an upsert on every cold start.
        await registerPushTokenIfChanged(token, userId, () => registerPushToken(token, Platform.OS));
        if (!cancelled) setRegisteredUserId(userId);
      } catch {
        // Registration failure is non-fatal: the inbox still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, registeredUserId, setPermission, setToken, setRegisteredUserId]);
}
