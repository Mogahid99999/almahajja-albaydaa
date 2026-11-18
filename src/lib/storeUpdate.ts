/**
 * Store update prompt (owner, 2026-11-18): the app finds out by itself that the
 * store has a newer version — nothing is typed in the admin panel — and offers
 * it in a popup that never blocks the app.
 *
 * - Android asks Google Play (In-App Updates, modules/store-update), which
 *   compares the installed build with the published one.
 * - iOS reads the published version from the App Store lookup and compares it
 *   with the installed one.
 *
 * Every failure (offline, not installed from the store, an old iOS the new
 * version doesn't support) means «no update»: the prompt must never get in the
 * way.
 */
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { playUpdates } from '../../modules/store-update';
import { compareVersions } from './version';

export type StoreUpdate = { available: boolean; storeUrl: string | null };

const NONE: StoreUpdate = { available: false, storeUrl: null };
const LOOKUP_TIMEOUT_MS = 8000;
const APP_STORE_ID = '6791291132';

const installedVersion = Constants.expoConfig?.version ?? '0.0.0';
const androidPackage = Constants.expoConfig?.android?.package ?? 'com.riwaqalilm.app';
const iosBundleId = Constants.expoConfig?.ios?.bundleIdentifier ?? 'com.riwaqalilm.app';

export async function checkStoreUpdate(): Promise<StoreUpdate> {
  try {
    if (Platform.OS === 'android') {
      if (!playUpdates) return NONE;
      const info = await playUpdates.check();
      return info.available ? { available: true, storeUrl: playStoreUrl() } : NONE;
    }
    if (Platform.OS === 'ios') return await checkAppStore();
  } catch {
    // fall through
  }
  return NONE;
}

/** Android: Play's own update screen when it can run, else the Play page. iOS: the App Store page. */
export async function openStoreUpdate(update: StoreUpdate): Promise<void> {
  if (Platform.OS === 'android') {
    const started = await playUpdates?.start().catch(() => false);
    if (started) return;
    await Linking.openURL(`market://details?id=${androidPackage}`).catch(() =>
      Linking.openURL(playStoreUrl()),
    );
    return;
  }
  await Linking.openURL(update.storeUrl ?? `https://apps.apple.com/app/id${APP_STORE_ID}`).catch(() => {});
}

function playStoreUrl() {
  return `https://play.google.com/store/apps/details?id=${androidPackage}`;
}

type LookupResult = { version?: string; trackViewUrl?: string; minimumOsVersion?: string };

/**
 * The lookup answers per storefront: try the phone's own country first (the app
 * may not be listed in the default US one), then the default.
 */
async function checkAppStore(): Promise<StoreUpdate> {
  const countries = [deviceCountry(), null].filter((c, i, all) => all.indexOf(c) === i);
  for (const country of countries) {
    const result = await lookup(country);
    if (result?.version) return decideIos(result, installedVersion, String(Platform.Version));
  }
  return NONE;
}

/** Pure: is the App Store version newer than ours, and can this iOS install it? */
export function decideIos(result: LookupResult, installed: string, osVersion: string): StoreUpdate {
  if (!result.version || compareVersions(installed, result.version) >= 0) return NONE;
  if (result.minimumOsVersion && compareVersions(osVersion, result.minimumOsVersion) < 0) return NONE;
  return { available: true, storeUrl: result.trackViewUrl ?? null };
}

async function lookup(country: string | null): Promise<LookupResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const params = `bundleId=${encodeURIComponent(iosBundleId)}${country ? `&country=${country}` : ''}&t=${Date.now()}`;
    const res = await fetch(`https://itunes.apple.com/lookup?${params}`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: LookupResult[] };
    return body.results?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function deviceCountry(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale; // e.g. «ar-SA»
    const region = locale.split(/[-_]/).find((part, i) => i > 0 && /^[A-Za-z]{2}$/.test(part));
    return region ? region.toLowerCase() : null;
  } catch {
    return null;
  }
}
