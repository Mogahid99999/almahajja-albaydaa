/**
 * Per-page Madinah fonts, registered on demand from the verified pack
 * directory: only the page on screen and its neighbours are loaded, never the
 * whole mushaf at once.
 */
import * as Font from 'expo-font';

const loaded = new Set<number>();
const pending = new Map<number, Promise<void>>();

export const qcfFamily = (page: number) => `QCF_P${String(page).padStart(3, '0')}`;
export const isPageFontLoaded = (page: number) => loaded.has(page);

export function ensurePageFont(packUri: string, page: number): Promise<void> {
  if (loaded.has(page)) return Promise.resolve();
  let p = pending.get(page);
  if (!p) {
    const uri = `${packUri.replace(/\/$/, '')}/p${String(page).padStart(3, '0')}.ttf`;
    p = Font.loadAsync({ [qcfFamily(page)]: uri })
      .then(() => {
        loaded.add(page);
      })
      .finally(() => pending.delete(page));
    pending.set(page, p);
  }
  return p;
}
