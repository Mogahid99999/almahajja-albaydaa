/**
 * «البث المباشر» share links on Android (V23, PLAN_LIVE_V23 §9.3, D8) — the three paths.
 *
 *  1. App ≥ 1.1.3 → App Link straight into the room: app.json's verified https
 *     filter for go.almahajja.app/live + an assetlinks.json Android will accept
 *     (a placeholder until the owner pastes the Play app-signing SHA-256 — but
 *     never a malformed fingerprint, e.g. the SHA-1 Play Console shows beside it).
 *  2. App < 1.1.3 (no /live filter) → the go.almahajja.app page: on Android its
 *     primary button is a package-targeted https intent whose fallback is Google
 *     Play («تحديث»), and the Play button reads «حدّث التطبيق أو ثبّته».
 *  3. No app → the same intent falls back to Google Play («تثبيت»).
 * The page never offers riwaqalilm:// — an old app owns that scheme and would
 * open on a route it doesn't have.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import appJson from '../../app.json';
import assetlinks from '../../vps/go-site/public/.well-known/assetlinks.json';

type Page = {
  open: string;
  hint: string;
  play: string;
  playLabel: string;
  appStore: string;
  explain: string;
};
type GoLive = {
  PACKAGE: string;
  PLAY_URL: string;
  normalizeCode: (raw: unknown) => string | null;
  codeFromPath: (pathname: string) => string | null;
  platformOf: (ua: string, maxTouchPoints?: number) => 'android' | 'ios' | 'other';
  androidIntentUrl: (code: string) => string;
  pageFor: (os: string, code: string | null, appStoreUrl?: string) => Page;
};
const goLive = require('../../vps/go-site/public/live.js') as GoLive;

const PLAY = 'https://play.google.com/store/apps/details?id=com.riwaqalilm.app';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

describe('path 1 — the App Link itself', () => {
  test('app.json: a verified https filter for go.almahajja.app/live (BROWSABLE + DEFAULT)', () => {
    expect(appJson.expo.android.package).toBe('com.riwaqalilm.app');
    const filters = appJson.expo.android.intentFilters;
    const live = filters.find((f) => f.data.some((d) => d.host === 'go.almahajja.app'));
    expect(live).toBeDefined();
    expect(live!.action).toBe('VIEW');
    expect(live!.autoVerify).toBe(true);
    expect(live!.data).toEqual([{ scheme: 'https', host: 'go.almahajja.app', pathPrefix: '/live' }]);
    expect([...live!.category].sort()).toEqual(['BROWSABLE', 'DEFAULT']);
  });

  test('assetlinks.json: handle_all_urls for com.riwaqalilm.app, SHA-256 fingerprints only', () => {
    expect(assetlinks).toHaveLength(1);
    const [stmt] = assetlinks;
    expect(stmt.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(stmt.target.namespace).toBe('android_app');
    expect(stmt.target.package_name).toBe('com.riwaqalilm.app');
    const prints = stmt.target.sha256_cert_fingerprints;
    expect(prints.length).toBeGreaterThan(0);
    const SHA256 = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
    for (const fp of prints) {
      // Until the owner pastes the Play «App signing key certificate» SHA-256.
      if (fp === 'REPLACE_WITH_PLAY_APP_SIGNING_SHA256') continue;
      expect(fp).toMatch(SHA256);
    }
    expect(new Set(prints).size).toBe(prints.length);
  });
});

describe('the go.almahajja.app page (vps/go-site/public/live.js)', () => {
  test('the share code comes from /live/{code} only', () => {
    expect(goLive.codeFromPath('/live/ABC234')).toBe('ABC234');
    expect(goLive.codeFromPath('/live/abc-234/')).toBe('ABC234');
    expect(goLive.codeFromPath('/live/ABC23')).toBeNull();
    expect(goLive.codeFromPath('/live/ABC2340')).toBeNull();
    expect(goLive.codeFromPath('/live/code/ABC234')).toBeNull();
    expect(goLive.codeFromPath('/live/%E0%A4%A')).toBeNull();
    expect(goLive.codeFromPath('/')).toBeNull();
  });

  test('platforms: Android, iPhone / iPad (desktop mode), everything else', () => {
    expect(goLive.platformOf(CHROME_ANDROID, 5)).toBe('android');
    expect(goLive.platformOf(IPHONE, 5)).toBe('ios');
    expect(goLive.platformOf(IPAD_DESKTOP_MODE, 5)).toBe('ios');
    expect(goLive.platformOf(IPAD_DESKTOP_MODE, 0)).toBe('other');
    expect(goLive.platformOf(WINDOWS, 0)).toBe('other');
  });

  test('the Android intent: the same https link, our package, Google Play as the fallback', () => {
    expect(goLive.androidIntentUrl('ABC234')).toBe(
      'intent://go.almahajja.app/live/ABC234#Intent;scheme=https;package=com.riwaqalilm.app;' +
        'S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.riwaqalilm.app;end',
    );
    expect(goLive.PLAY_URL).toBe(PLAY);
  });

  test('paths 2 + 3 on Android: open via the intent, else «حدّث التطبيق أو ثبّته من Google Play»', () => {
    const page = goLive.pageFor('android', 'ABC234', 'https://apps.apple.com/app/id1');
    expect(page.open).toBe(goLive.androidIntentUrl('ABC234'));
    expect(page.hint).toBe('إن لم يكن التطبيق على جهازك، أو كان إصداره قديماً، ينقلك هذا الزر إلى Google Play.');
    expect(page.play).toBe(PLAY);
    expect(page.playLabel).toBe('حدّث التطبيق أو ثبّته من Google Play');
    expect(page.appStore).toBe('');
    expect(page.explain).toBe('البث المباشر يحتاج الإصدار ١٫١٫٣ أو أحدث من التطبيق. بعد التحديث افتح الرابط من جديد.');
  });

  test('Android without a valid code: no open button, Google Play stays', () => {
    const page = goLive.pageFor('android', null);
    expect(page.open).toBe('');
    expect(page.hint).toBe('');
    expect(page.play).toBe(PLAY);
  });

  test('desktop: a short note + Google Play, no open button', () => {
    const page = goLive.pageFor('other', 'ABC234');
    expect(page.open).toBe('');
    expect(page.play).toBe(PLAY);
    expect(page.playLabel).toBe('حمّل التطبيق من Google Play');
    expect(page.explain).toBe(
      'افتح هذا الرابط من هاتف أندرويد عليه تطبيق المحجّة البيضاء، أو حمّل التطبيق من Google Play.',
    );
  });

  test('iOS (out of scope): Google Play + a note; the App Store instead once configured', () => {
    const bare = goLive.pageFor('ios', 'ABC234', '');
    expect(bare.open).toBe('');
    expect(bare.play).toBe(PLAY);
    expect(bare.appStore).toBe('');
    expect(bare.explain).toBe('تطبيق المحجّة البيضاء متاح الآن على أجهزة أندرويد من Google Play.');

    const store = goLive.pageFor('ios', 'ABC234', 'https://apps.apple.com/app/id123');
    expect(store.appStore).toBe('https://apps.apple.com/app/id123');
    expect(store.play).toBe('');
    expect(goLive.pageFor('ios', 'ABC234', 'javascript:alert(1)').appStore).toBe('');
  });

  test('never the riwaqalilm:// scheme (an old app would open on a missing route)', () => {
    for (const os of ['android', 'ios', 'other']) {
      const page = goLive.pageFor(os, 'ABC234', 'https://apps.apple.com/app/id1');
      for (const href of [page.open, page.play, page.appStore]) expect(href).not.toMatch(/^riwaqalilm:/);
    }
  });

  test('live.html carries every element live.js fills', () => {
    const html = readFileSync(join(__dirname, '../../vps/go-site/public/live.html'), 'utf8');
    for (const id of ['badge', 'badge-text', 'title', 'sub', 'when', 'open', 'hint', 'play', 'appstore', 'explain']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<script src="\/live\.js(\?v=\w+)?" defer><\/script>/);
  });
});
