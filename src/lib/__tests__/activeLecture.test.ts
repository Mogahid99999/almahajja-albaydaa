import { resolveActiveLectureId } from '@/lib/activeLecture';

/**
 * The lesson-tools-stale-on-auto-advance regression (item 3).
 *
 * On auto-advance the audioController drives the player store's currentLectureId
 * to the NEXT lecture in place (no navigation), so the route `id` goes stale. The
 * tools (ملاحظات · فوائد · أسئلة) must follow the PLAYING lecture, not the route,
 * or they keep showing the previous lecture. `resolveActiveLectureId` is that
 * "playing id wins, route id is the pre-playback fallback" rule.
 */
describe('resolveActiveLectureId', () => {
  it('prefers the currently-playing lecture over the (stale) route id', () => {
    // Route opened lecture A, auto-advance moved playback to lecture B.
    expect(resolveActiveLectureId('lecture-B', 'lecture-A')).toBe('lecture-B');
  });

  it('falls back to the route id before anything is playing (store null)', () => {
    expect(resolveActiveLectureId(null, 'lecture-A')).toBe('lecture-A');
    expect(resolveActiveLectureId(undefined, 'lecture-A')).toBe('lecture-A');
  });

  it('treats an empty playing id as "nothing playing" and uses the route', () => {
    expect(resolveActiveLectureId('', 'lecture-A')).toBe('lecture-A');
  });

  it('returns empty string when neither is known (disables the tool queries)', () => {
    expect(resolveActiveLectureId(null, undefined)).toBe('');
    expect(resolveActiveLectureId('', '')).toBe('');
  });

  it('uses the playing id even when the route id is missing (deep-link edge)', () => {
    expect(resolveActiveLectureId('lecture-B', undefined)).toBe('lecture-B');
  });
});
