/**
 * Where «المصحف» opens: the reader when it can be read right away (the Madinah
 * pack is ready, or the reader chose the simplified font, or web), otherwise
 * the one-time «تجهيز المصحف للقراءة» screen.
 */
import type { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { usePackStore } from './pack';
import { useMushafStore } from './store';

export function canReadNow(): boolean {
  if (Platform.OS === 'web') return true;
  return usePackStore.getState().status.state === 'ready' || useMushafStore.getState().preferSimple;
}

export function openMushafReader(router: Pick<ReturnType<typeof useRouter>, 'push'>, page?: number) {
  if (!canReadNow()) {
    router.push('/mushaf/prepare');
    return;
  }
  router.push(page ? { pathname: '/mushaf/read', params: { page: String(page) } } : '/mushaf/read');
}
