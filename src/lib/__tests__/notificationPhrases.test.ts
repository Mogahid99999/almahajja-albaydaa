/**
 * src/lib/notificationPhrases.ts — round-robin phrase picker.
 * The rotation cursor persists in AsyncStorage so consecutive notifications of
 * the same type never repeat the same sentence (PLAN_V3 §11).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { PHRASE_BANK, pickPhrase } from '../notificationPhrases';

beforeEach(() => {
  void AsyncStorage.clear();
});

describe('rotation', () => {
  test('cycles through the whole bank in order, then wraps', async () => {
    const bank = PHRASE_BANK.resume_general;
    const picks: string[] = [];
    for (let i = 0; i < bank.length + 1; i++) picks.push(await pickPhrase('resume_general'));
    expect(picks.slice(0, bank.length)).toEqual(bank);
    expect(picks[bank.length]).toBe(bank[0]); // wraparound
  });

  test('never repeats the same phrase back-to-back for multi-phrase banks', async () => {
    let prev = await pickPhrase('daily');
    for (let i = 0; i < 6; i++) {
      const next = await pickPhrase('daily');
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  test('rotations are independent per event', async () => {
    await pickPhrase('resume_general');
    await pickPhrase('resume_general');
    // completion's cursor is untouched by resume_general's advances.
    expect(await pickPhrase('completion')).toBe(PHRASE_BANK.completion[0]);
  });

  test('single-phrase banks always return their one phrase', async () => {
    expect(await pickPhrase('goal_done')).toBe(PHRASE_BANK.goal_done[0]);
    expect(await pickPhrase('goal_done')).toBe(PHRASE_BANK.goal_done[0]);
  });
});

describe('placeholder interpolation', () => {
  test('replaces every occurrence of each bracketed token', async () => {
    const phrase = await pickPhrase('series', {
      '[اسم السلسلة]': 'الأصول الثلاثة',
      '[عدد]': 4,
    });
    expect(phrase).not.toContain('[اسم السلسلة]');
    expect(phrase).not.toContain('[عدد]');
    expect(phrase).toContain('الأصول الثلاثة');
  });

  test('numeric vars are stringified', async () => {
    const phrase = await pickPhrase('new_lecture', { '[اسم القسم]': 'العقيدة' });
    expect(phrase).toBe('أُضيف درس جديد في العقيدة');
  });
});

describe('phrase bank hygiene', () => {
  test('every bank is non-empty and all phrases are Arabic', () => {
    for (const [event, bank] of Object.entries(PHRASE_BANK)) {
      expect(bank.length).toBeGreaterThan(0);
      for (const phrase of bank) {
        // Calm Arabic-first product: no English may leak into a notification.
        expect({ event, phrase, arabic: /[؀-ۿ]/.test(phrase) }).toEqual(
          expect.objectContaining({ arabic: true }),
        );
        expect(/[a-zA-Z]/.test(phrase)).toBe(false);
      }
    }
  });
});
