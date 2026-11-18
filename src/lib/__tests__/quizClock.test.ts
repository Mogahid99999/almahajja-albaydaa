import { advanceClock, createClock, reanchorClock, remainingSeconds } from '../quizClock';

const at = (wall: number, elapsed: number | null) => ({ wall, elapsed });

describe('quiz clock (0174)', () => {
  const start = () => createClock(600, 600, at(1_000_000, 50_000));

  test('starts from what the server has already counted', () => {
    expect(remainingSeconds(createClock(600, 540, at(0, 0)))).toBe(540);
  });

  test('moving the device clock back gives no extra time', () => {
    const c = advanceClock(start(), at(1_000_000 - 3_600_000, 110_000));
    expect(remainingSeconds(c)).toBe(540);
  });

  test('moving the device clock forward takes no time', () => {
    const c = advanceClock(start(), at(1_000_000 + 3_600_000, 110_000));
    expect(remainingSeconds(c)).toBe(540);
  });

  test('time with the app closed counts, across any number of samples', () => {
    const a = advanceClock(start(), at(1_060_000, 110_000));
    const b = advanceClock(a, at(1_360_000, 410_000));
    expect(remainingSeconds(b)).toBe(240);
  });

  test('after a reboot it falls back to the wall clock', () => {
    const c = advanceClock(start(), at(1_120_000, 2_000));
    expect(remainingSeconds(c)).toBe(480);
  });

  test('with no native clock a clock moved back never adds time', () => {
    const noNative = createClock(600, 600, at(1_000_000, null));
    const c = advanceClock(noNative, at(400_000, null));
    expect(remainingSeconds(c)).toBe(600);
  });

  test('never below zero, and rounds up so zero means really over', () => {
    expect(remainingSeconds(advanceClock(start(), at(0, 50_000 + 599_100)))).toBe(1);
    expect(remainingSeconds(advanceClock(start(), at(0, 50_000 + 900_000)))).toBe(0);
  });

  test('no limit means no countdown', () => {
    expect(remainingSeconds(createClock(null, null, at(0, 0)))).toBeNull();
  });

  test('the server count replaces the local one', () => {
    const c = reanchorClock(advanceClock(start(), at(0, 100_000)), 300, at(5, 100_000));
    expect(remainingSeconds(c)).toBe(300);
  });
});
