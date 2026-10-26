import { nextRate, RATE_PRESETS } from '../PlaybackRateButton';
import { formatRate } from '../rateFormat';

describe('playback-speed pill (owner 2026-10-26)', () => {
  test('each tap steps through the presets and wraps back to ×1', () => {
    let r = 1.0;
    const seen: number[] = [];
    for (let i = 0; i < RATE_PRESETS.length; i++) {
      r = nextRate(r);
      seen.push(r);
    }
    expect(seen).toEqual([1.2, 1.5, 1.8, 2.0, 0.8, 1.0]);
  });

  test('an old slider value (not a preset) jumps to the next faster preset', () => {
    expect(nextRate(1.3)).toBe(1.5);
    expect(nextRate(0.9)).toBe(1.0);
    expect(nextRate(1.9)).toBe(2.0);
  });

  test('the label is Arabic-Indic', () => {
    expect(formatRate(1.5)).toBe('١٫٥×');
  });
});
