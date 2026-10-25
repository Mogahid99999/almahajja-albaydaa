/**
 * src/lib/schedule.ts — «الجدول الأسبوعي» (0158). Everything students see is
 * computed on the device from one cached payload, so the date logic IS the
 * feature: Mecca time (UTC+3) whatever the phone's zone, a date changed alone
 * (أُلغي / أُجّل / تغيّر الموعد) shows on BOTH its days, a hidden lesson is
 * not shown, and the labels are Arabic with Arabic-Indic digits.
 */
import type { Schedule, ScheduleException, ScheduleItem } from '@/api/schedule';
import {
  arClock,
  arDaysLabel,
  arLocalLine,
  arRelative,
  arStatusLine,
  groupBySheikh,
  meccaToday,
  nextOccurrence,
  occurrencesOn,
  startMs,
  upcoming,
} from '@/lib/schedule';

const item = (over: Partial<ScheduleItem> & Pick<ScheduleItem, 'id' | 'title' | 'days' | 'startTime'>): ScheduleItem => ({
  subtitle: null,
  subject: null,
  sheikhId: null,
  sheikhName: 'الشيخ النذير محمد',
  sectionId: null,
  sectionTitle: null,
  audience: 'all',
  durationMin: 60,
  note: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

// 2026-10-05 is a Monday (dow 1); 10-08 Thursday, 10-10 Saturday, 10-11 Sunday.
const TAWHID = item({ id: 'A', title: 'كتاب التوحيد', days: [0, 4], startTime: '21:30', sectionId: 'sec-tawhid' });
const ARBAEEN_TUE = item({ id: 'B', title: 'الأربعون النووية', days: [2], startTime: '21:30' });
const ARBAEEN_FRI = item({ id: 'B2', title: 'الأربعون النووية', days: [5], startTime: '17:00' });
const QISAS = item({ id: 'C', title: 'قصص الأنبياء', days: [0, 1, 2, 3, 4, 6], startTime: '17:00', sheikhName: 'الشيخ معروف محمد بركة' });
const PAUSED = item({ id: 'D', title: 'درس موقوف', days: [1], startTime: '10:00', isActive: false });

const ex = (over: Partial<ScheduleException> & Pick<ScheduleException, 'itemId' | 'occursOn' | 'kind'>): ScheduleException => ({
  id: `${over.itemId}-${over.occursOn}`,
  newDate: null,
  newTime: null,
  note: null,
  ...over,
});

const schedule = (exceptions: ScheduleException[] = []): Schedule => ({
  version: '1',
  items: [TAWHID, ARBAEEN_TUE, ARBAEEN_FRI, QISAS, PAUSED],
  exceptions,
  canEdit: false,
});

/** Mecca wall-clock → epoch ms. */
const mecca = (date: string, hm: string) => startMs(date, hm);

describe('Mecca time', () => {
  test('the day turns at Mecca midnight, not the phone’s or UTC’s', () => {
    // 22:30 UTC on Monday = 01:30 Tuesday in Mecca.
    expect(meccaToday(Date.UTC(2026, 9, 5, 22, 30))).toEqual({ date: '2026-10-06', dow: 2, minutes: 90 });
  });

  test('a lesson time is Mecca time: 21:30 Mecca = 18:30 UTC', () => {
    expect(new Date(mecca('2026-10-05', '21:30')).toISOString()).toBe('2026-10-05T18:30:00.000Z');
  });

  test('«بتوقيتك» only outside Mecca’s zone, with the day shift said', () => {
    expect(arLocalLine('2026-10-05', '21:30', 180)).toBeNull();
    expect(arLocalLine('2026-10-05', '21:30', 0)).toBe('بتوقيتك: ٦:٣٠ مساءً');
    expect(arLocalLine('2026-10-05', '21:30', -300)).toBe('بتوقيتك: ١:٣٠ ظهراً');
    expect(arLocalLine('2026-10-05', '21:30', 480)).toBe('بتوقيتك: ٢:٣٠ ليلاً (اليوم التالي)');
  });
});

describe('occurrencesOn', () => {
  test('a day lists its lessons by time; a hidden lesson only for editors', () => {
    expect(occurrencesOn(schedule(), '2026-10-05').map((o) => o.item.id)).toEqual(['C']);
    expect(occurrencesOn(schedule(), '2026-10-05', { includePaused: true }).map((o) => o.item.id)).toEqual(['D', 'C']);
    expect(occurrencesOn(schedule(), '2026-10-11').map((o) => [o.item.id, o.time])).toEqual([
      ['C', '17:00'],
      ['A', '21:30'],
    ]);
  });

  test('cancelled: still listed that day, not held, with the reason', () => {
    const s = schedule([ex({ itemId: 'A', occursOn: '2026-10-08', kind: 'cancelled', note: 'لسفر الشيخ' })]);
    const [a] = occurrencesOn(s, '2026-10-08').filter((o) => o.item.id === 'A');
    expect(a.status).toBe('cancelled');
    expect(arStatusLine(a)).toBe('لا درس في هذا الموعد — لسفر الشيخ');
  });

  test('postponed to another date: «أُجّل إلى» on its day AND «مؤجَّل من» on the new one', () => {
    const s = schedule([ex({ itemId: 'A', occursOn: '2026-10-11', kind: 'moved', newDate: '2026-10-10', newTime: '20:00' })]);
    const away = occurrencesOn(s, '2026-10-11').find((o) => o.item.id === 'A')!;
    expect(away.status).toBe('moved_away');
    expect(arStatusLine(away)).toBe('أُجّل إلى السبت ١٠ أكتوبر ٨:٠٠ مساءً');
    const into = occurrencesOn(s, '2026-10-10').find((o) => o.item.id === 'A')!;
    expect([into.status, into.time]).toEqual(['moved_in', '20:00']);
    expect(arStatusLine(into)).toBe('مؤجَّل من الأحد ١١ أكتوبر');
  });

  test('another time the same day: held at the new time, the usual one said', () => {
    const s = schedule([ex({ itemId: 'C', occursOn: '2026-10-05', kind: 'moved', newDate: '2026-10-05', newTime: '18:30' })]);
    const [c] = occurrencesOn(s, '2026-10-05');
    expect([c.status, c.time]).toEqual(['time_changed', '18:30']);
    expect(arStatusLine(c)).toBe('تغيّر الموعد هذه المرة (كان ٥:٠٠ عصراً)');
  });
});

describe('upcoming / next', () => {
  test('the next held lesson from now; one in progress still counts', () => {
    const at1600 = mecca('2026-10-05', '16:00');
    expect(nextOccurrence(schedule(), at1600)?.item.id).toBe('C');
    const at1730 = mecca('2026-10-05', '17:30'); // C runs 17:00–18:00
    expect(upcoming(schedule(), at1730, 1).map((o) => o.item.id)).toEqual(['C']);
    const at1800 = mecca('2026-10-05', '18:00');
    expect(nextOccurrence(schedule(), at1800)?.date).toBe('2026-10-06');
  });

  test('a cancelled date is skipped; a postponed one counts on its new date', () => {
    const s = schedule([
      ex({ itemId: 'C', occursOn: '2026-10-05', kind: 'cancelled' }),
      ex({ itemId: 'C', occursOn: '2026-10-06', kind: 'moved', newDate: '2026-10-09', newTime: '17:00' }),
    ]);
    const list = upcoming(s, mecca('2026-10-05', '09:00'), 5).filter((o) => o.item.id === 'C').map((o) => o.date);
    expect(list).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
  });
});

describe('Arabic labels', () => {
  test('clock: 12-hour, Arabic digits, part of the day', () => {
    expect(arClock('21:30')).toEqual({ time: '٩:٣٠', period: 'مساءً' });
    expect(arClock('17:00')).toEqual({ time: '٥:٠٠', period: 'عصراً' });
    expect(arClock('06:15')).toEqual({ time: '٦:١٥', period: 'صباحاً' });
    expect(arClock('12:30')).toEqual({ time: '١٢:٣٠', period: 'ظهراً' });
    expect(arClock('00:45')).toEqual({ time: '١٢:٤٥', period: 'ليلاً' });
  });

  test('days: يومياً · يومياً عدا الجمعة · كل جمعة · Saturday-first list', () => {
    expect(arDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('يومياً');
    expect(arDaysLabel([0, 1, 2, 3, 4, 6])).toBe('يومياً عدا الجمعة');
    expect(arDaysLabel([5])).toBe('كل جمعة');
    expect(arDaysLabel([4, 0])).toBe('الأحد · الخميس');
    expect(arDaysLabel([0, 6])).toBe('السبت · الأحد');
  });

  test('relative: «الآن» while it runs, minutes / hours within 12 h, else nothing', () => {
    const start = mecca('2026-10-05', '21:30');
    const min = 60_000;
    expect(arRelative(start, 60, start + 10 * min)).toBe('الآن');
    expect(arRelative(start, 60, start - 2 * min)).toBe('بعد دقيقتين');
    expect(arRelative(start, 60, start - 5 * min)).toBe('بعد ٥ دقائق');
    expect(arRelative(start, 60, start - 20 * min)).toBe('بعد ٢٠ دقيقة');
    expect(arRelative(start, 60, start - 60 * min)).toBe('بعد ساعة');
    expect(arRelative(start, 60, start - 120 * min)).toBe('بعد ساعتين');
    expect(arRelative(start, 60, start - 13 * 60 * min)).toBeNull();
    expect(arRelative(start, 60, start + 61 * min)).toBeNull();
  });
});

describe('groupBySheikh («حسب الشيخ»)', () => {
  test('by sheikh; one title at two times merges into one row «موعدان»; hidden ones left out', () => {
    const groups = groupBySheikh(schedule().items);
    expect(groups.map((g) => g.sheikh)).toEqual(['الشيخ معروف محمد بركة', 'الشيخ النذير محمد']);
    const nazeer = groups[1].lessons;
    expect(nazeer.map((l) => l.title)).toEqual(['كتاب التوحيد', 'الأربعون النووية']);
    expect(nazeer[0]).toMatchObject({ when: 'الأحد · الخميس', time: '21:30', countLabel: null });
    expect(nazeer[1]).toMatchObject({
      when: 'كل ثلاثاء ٩:٣٠ مساءً · كل جمعة ٥:٠٠ عصراً',
      time: null,
      countLabel: 'موعدان',
    });
    expect(groups.flatMap((g) => g.lessons.map((l) => l.title))).not.toContain('درس موقوف');
  });

  test('lessons with no sheikh named go last, under «دروس أخرى»', () => {
    const groups = groupBySheikh([item({ id: 'X', title: 'مجلس عام', days: [6], startTime: '08:00', sheikhName: null }), QISAS]);
    expect(groups.map((g) => g.sheikh)).toEqual(['الشيخ معروف محمد بركة', 'دروس أخرى']);
  });
});
