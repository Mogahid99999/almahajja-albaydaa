/**
 * Notification labels (feature B) × «البث المباشر» (V23 P5, migration 0142).
 *
 * The three live types are real inbox rows once 0142 is applied, and the label /
 * description / icon Records are what the inbox and PrefsToggles render — a
 * type without an entry would show a blank row. Pins:
 *  - every NOTIFICATION_TYPES entry (incl. live_start / live_reminder /
 *    live_invite) has Arabic copy and an icon;
 *  - only live_start gets a prefs toggle («بث مباشر»): live_invite follows the
 *    buddy_activity pref (server-side) and live_reminder is the student's own
 *    «ذكّرني»;
 *  - the buddy_activity line tells both genders it also covers live invites.
 */
import Feather from '@expo/vector-icons/Feather';

import { NOTIFICATION_TYPES, defaultNotificationEnabled } from '@/api/types';
import {
  NOTIFICATION_TYPE_ORDER,
  buddyActivityDescription,
  notificationTypeDescription,
  notificationTypeIcon,
  notificationTypeLabel,
} from '@/components/notifications/labels';

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

test('the live types are part of NotificationType and default ON (a missing pref row = ON)', () => {
  expect(NOTIFICATION_TYPES).toEqual(expect.arrayContaining(['live_start', 'live_reminder', 'live_invite']));
  for (const t of ['live_start', 'live_reminder', 'live_invite'] as const) {
    expect(defaultNotificationEnabled(t)).toBe(true);
  }
});

test('every notification type has Arabic label + description and a real Feather icon', () => {
  const glyphs = (Feather as unknown as { glyphMap: Record<string, number> }).glyphMap;
  for (const t of NOTIFICATION_TYPES) {
    expect(notificationTypeLabel[t]).toMatch(ARABIC);
    expect(notificationTypeLabel[t]).not.toMatch(/^\s*$/);
    expect(notificationTypeDescription[t]).toMatch(ARABIC);
    expect(glyphs[notificationTypeIcon[t]]).toBeDefined();
  }
});

test('the live labels read as §15 intends — no English leakage', () => {
  expect(notificationTypeLabel.live_start).toBe('بث مباشر');
  expect(notificationTypeLabel.live_reminder).toBe('تذكير بمجلس مباشر');
  expect(notificationTypeLabel.live_invite).toBe('دعوة رفيق إلى بث مباشر');
  for (const t of ['live_start', 'live_reminder', 'live_invite'] as const) {
    expect(notificationTypeLabel[t]).not.toMatch(LATIN);
    expect(notificationTypeDescription[t]).not.toMatch(LATIN);
  }
});

test('only live_start gets its own toggle; invite and reminder have none', () => {
  expect(NOTIFICATION_TYPE_ORDER).toContain('live_start');
  expect(NOTIFICATION_TYPE_ORDER).not.toContain('live_invite');
  expect(NOTIFICATION_TYPE_ORDER).not.toContain('live_reminder');
  // It sits with the other content pushes, right after «اختبار جديد».
  expect(NOTIFICATION_TYPE_ORDER.indexOf('live_start')).toBe(NOTIFICATION_TYPE_ORDER.indexOf('new_quiz') + 1);
});

test('the buddy_activity line (which also gates live invites) is gendered', () => {
  expect(buddyActivityDescription('male')).toBe('عند إتمام رفيقك درساً، أو دعوته لك إلى بث مباشر');
  expect(buddyActivityDescription(null)).toBe('عند إتمام رفيقك درساً، أو دعوته لك إلى بث مباشر');
  expect(buddyActivityDescription('female')).toBe('عند إتمام رفيقتك درساً، أو دعوتها لك إلى بث مباشر');
});
