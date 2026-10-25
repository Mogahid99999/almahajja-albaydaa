/**
 * «لا تنسَ الدعاء» rotates locally through the four approved du'as, one per
 * app session, wrapping around — no server, no tracking.
 */
import { DUAS, nextDuaIndex } from '../DuaCard';

describe('DuaCard rotation', () => {
  it("starts at the first du'a and moves to the next each session, wrapping", () => {
    expect(DUAS).toHaveLength(4);
    expect(nextDuaIndex(null)).toBe(0);
    expect([0, 1, 2, 3].map(nextDuaIndex)).toEqual([1, 2, 3, 0]);
  });

  it("a corrupted stored value falls back to the first du'a", () => {
    expect(nextDuaIndex(Number('x'))).toBe(0);
  });
});
