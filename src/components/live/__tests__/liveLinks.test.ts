/**
 * «البث المباشر» share links (V23 P5, PLAN_LIVE_V23 §9.3, D8).
 *
 * Pins:
 *  - the public link is https://go.almahajja.app/live/{share_code};
 *  - the share message is the §9.3 copy, exactly (a missing section / sheikh
 *    drops only its own part);
 *  - app/+native-intent.tsx: a system link to /live/<code> — from the App Link
 *    host or our riwaqalilm:// scheme — lands on /live/code/<code>, while
 *    /live/<uuid>, /live/green/<uuid> and /live/code/<code> are left alone
 *    (they are real routes), and it never throws;
 *  - the §15 buddy copy is gendered by the viewer (buddies are same-gender).
 */
import { redirectSystemPath } from '../../../../app/+native-intent';
import {
  buddyAbsentLine,
  buddyPresentLine,
  inviteSentLine,
  inviteSheetTitle,
  inviteVerb,
  liveShareLink,
  liveShareMessage,
  liveSystemPath,
} from '@/components/live/liveUi';

const UUID = '3f2b8c1e-9a4d-4e6b-8c2a-1d5e7f9a0b3c';

describe('share link + message', () => {
  test('D8: the link is on go.almahajja.app', () => {
    expect(liveShareLink('ABC234')).toBe('https://go.almahajja.app/live/ABC234');
  });

  test('§9.3 message, exactly', () => {
    expect(
      liveShareMessage(
        { title: 'شرح كتاب التوحيد', sectionTitle: 'العقيدة', sheikhName: 'الشيخ عبد الله' },
        'https://go.almahajja.app/live/ABC234',
      ),
    ).toBe(
      'يُبث الآن: شرح كتاب التوحيد · العقيدة، مع الشيخ عبد الله.\nاستمع في المحجّة البيضاء:\nhttps://go.almahajja.app/live/ABC234',
    );
  });

  test('no sheikh / no section: only that part is dropped', () => {
    const link = 'https://go.almahajja.app/live/ABC234';
    expect(liveShareMessage({ title: 'مجلس', sectionTitle: 'الفقه', sheikhName: null }, link)).toBe(
      `يُبث الآن: مجلس · الفقه.\nاستمع في المحجّة البيضاء:\n${link}`,
    );
    expect(liveShareMessage({ title: 'مجلس', sectionTitle: '', sheikhName: 'الشيخ' }, link)).toBe(
      `يُبث الآن: مجلس، مع الشيخ.\nاستمع في المحجّة البيضاء:\n${link}`,
    );
  });
});

describe('native intent: /live/{code} → /live/code/{code}', () => {
  test.each([
    ['https://go.almahajja.app/live/ABC234', '/live/code/ABC234'],
    ['https://go.almahajja.app/live/ABC234/', '/live/code/ABC234'],
    ['https://go.almahajja.app/live/ABC234?utm_source=wa#x', '/live/code/ABC234'],
    ['https://GO.almahajja.app/live/abc234', '/live/code/ABC234'],
    ['http://go.almahajja.app/live/ABC234', '/live/code/ABC234'],
    ['riwaqalilm://live/ABC234', '/live/code/ABC234'],
    ['riwaqalilm:///live/ABC234', '/live/code/ABC234'],
    ['/live/ABC234', '/live/code/ABC234'],
  ])('%s → %s', (input, expected) => {
    expect(liveSystemPath(input)).toBe(expected);
    expect(redirectSystemPath({ path: input, initial: true })).toBe(expected);
  });

  test.each([
    `https://go.almahajja.app/live/${UUID}`,
    `riwaqalilm://live/${UUID}`,
    `riwaqalilm://live/green/${UUID}`,
    'riwaqalilm://live/code/ABC234',
    'https://go.almahajja.app/live/code/ABC234',
    `/live/${UUID}`,
    `/live/green/${UUID}`,
    'riwaqalilm://live/green',
    'riwaqalilm://live/code',
    'riwaqalilm://player/abc',
    'riwaqalilm:///',
    'https://almahajja.app/live/ABC234',
    'https://go.almahajja.app/',
    'exp+riwaq-al-ilm://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081',
  ])('%s is left untouched', (input) => {
    expect(liveSystemPath(input)).toBe(input);
    expect(redirectSystemPath({ path: input, initial: false })).toBe(input);
  });

  test('a non-code segment still goes to the code screen (which says «لم نجد هذا المجلس»)', () => {
    expect(liveSystemPath('riwaqalilm://live/hello')).toBe('/live/code/hello');
  });

  test('never throws on a malformed escape', () => {
    expect(() => redirectSystemPath({ path: 'riwaqalilm://live/%E0%A4%A', initial: false })).not.toThrow();
    expect(redirectSystemPath({ path: 'riwaqalilm://live/%E0%A4%A', initial: false })).toBe(
      'riwaqalilm://live/%E0%A4%A',
    );
  });
});

describe('§15 buddy copy', () => {
  test('brothers', () => {
    expect(buddyPresentLine('حسن', 'm')).toBe('رفيقك · حسن');
    expect(`${buddyAbsentLine('حسن', 'm')} · ${inviteVerb('m')}`).toBe('رفيقك حسن ليس في الحلقة · ادعُه');
    expect(inviteSheetTitle('m')).toBe('ادعُ رفيقك إلى الحلقة');
  });

  test('sisters', () => {
    expect(buddyPresentLine('مريم', 'f')).toBe('رفيقتك · مريم');
    expect(`${buddyAbsentLine('مريم', 'f')} · ${inviteVerb('f')}`).toBe('رفيقتك مريم ليست في الحلقة · ادعيها');
    expect(inviteSheetTitle('f')).toBe('ادعي رفيقتك إلى الحلقة');
  });

  test('sent', () => {
    expect(inviteSentLine('حسن')).toBe('أُرسلت الدعوة إلى حسن');
  });
});
