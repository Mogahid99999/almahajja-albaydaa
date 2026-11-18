/**
 * Where «المصحف» opens: the reader when it can be read right away (the Madinah
 * pack is ready, or the reader chose the simplified font, or there is no pack
 * to download — web, or no pack source configured), otherwise
 * the one-time «تجهيز المصحف للقراءة» screen.
 */
import type { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { usePackStore } from './pack';
import { useMushafStore } from './store';

export function canReadNow(): boolean {
  if (Platform.OS === 'web') return true;
  const state = usePackStore.getState().status.state;
  return state === 'ready' || state === 'unsupported' || useMushafStore.getState().preferSimple;
}

// The reader's search button opens the index with its search box focused. The
// index may already be the screen underneath (reached by going back), so the
// request travels as a one-shot flag rather than a route param.
let searchRequested = false;
export function requestIndexSearch() {
  searchRequested = true;
}
export function takeIndexSearchRequest(): boolean {
  const r = searchRequested;
  searchRequested = false;
  return r;
}

export function openMushafReader(router: Pick<ReturnType<typeof useRouter>, 'push'>, page?: number) {
  if (!canReadNow()) {
    router.push('/mushaf/prepare');
    return;
  }
  router.push(page ? { pathname: '/mushaf/read', params: { page: String(page) } } : '/mushaf/read');
}
