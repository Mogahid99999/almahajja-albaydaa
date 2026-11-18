/**
 * Store update prompt (2026-11-18): how the app decides that the store has a
 * newer version. Any failure means «no update» — the prompt never gets in the way.
 */
import { Platform } from 'react-native';

const mockPlay = { check: jest.fn(), start: jest.fn() };
jest.mock('../../../modules/store-update', () => ({
  get playUpdates() {
    return mockPlay;
  },
}));

import { checkStoreUpdate, decideIos } from '../storeUpdate';

describe('iOS: App Store version vs installed', () => {
  test('a newer App Store version is an update', () => {
    expect(decideIos({ version: '1.1.9', trackViewUrl: 'u' }, '1.1.8', '17.4')).toEqual({
      available: true,
      storeUrl: 'u',
    });
  });

  test('same or older (e.g. our build still in review) is not', () => {
    expect(decideIos({ version: '1.1.8' }, '1.1.8', '17.4').available).toBe(false);
    expect(decideIos({ version: '1.1.7' }, '1.1.8', '17.4').available).toBe(false);
  });

  test('not offered when this iPhone is too old for the new version', () => {
    expect(decideIos({ version: '1.2.0', minimumOsVersion: '16.0' }, '1.1.8', '15.8').available).toBe(false);
    expect(decideIos({ version: '1.2.0', minimumOsVersion: '16.0' }, '1.1.8', '16.0').available).toBe(true);
  });
});

describe('Android: asks Google Play', () => {
  const os = Platform.OS;
  beforeAll(() => Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }));
  afterAll(() => Object.defineProperty(Platform, 'OS', { value: os, configurable: true }));

  test('Play says a newer build is published → update', async () => {
    mockPlay.check.mockResolvedValue({ available: true, availableVersionCode: 23 });
    expect((await checkStoreUpdate()).available).toBe(true);
  });

  test('Play says none, or the check fails → no update', async () => {
    mockPlay.check.mockResolvedValue({ available: false });
    expect((await checkStoreUpdate()).available).toBe(false);
    mockPlay.check.mockRejectedValue(new Error('not installed from Play'));
    expect((await checkStoreUpdate()).available).toBe(false);
  });
});
