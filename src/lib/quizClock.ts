/**
 * The time used by a quiz attempt, counted on this device (0174).
 *
 * `consumedMs` only moves forward. Between two samples it grows by the elapsed
 * time since boot, which changing the device clock cannot affect and which keeps
 * counting while the app is closed. After a reboot, or on a build without the
 * native module, it falls back to the wall clock and ignores a clock moved back.
 */
import { elapsedRealtimeMs } from '../../modules/elapsed-clock';

export type ClockSample = { wall: number; elapsed: number | null };

export type QuizClock = {
  limitSec: number | null;
  consumedMs: number;
  lastWall: number;
  lastElapsed: number | null;
};

export function clockSample(): ClockSample {
  return { wall: Date.now(), elapsed: elapsedRealtimeMs() };
}

/** Start from the server's own count, so time before the download is included. */
export function createClock(
  limitSec: number | null,
  serverRemainingSec: number | null,
  sample: ClockSample,
): QuizClock {
  const consumedMs =
    limitSec == null || serverRemainingSec == null
      ? 0
      : Math.max(0, (limitSec - serverRemainingSec) * 1000);
  return { limitSec, consumedMs, lastWall: sample.wall, lastElapsed: sample.elapsed };
}

export function advanceClock(clock: QuizClock, sample: ClockSample): QuizClock {
  const monotonic =
    clock.lastElapsed != null && sample.elapsed != null && sample.elapsed >= clock.lastElapsed;
  const delta = monotonic
    ? sample.elapsed! - clock.lastElapsed!
    : Math.max(0, sample.wall - clock.lastWall);
  return {
    ...clock,
    consumedMs: clock.consumedMs + delta,
    lastWall: sample.wall,
    lastElapsed: sample.elapsed,
  };
}

/** Whole seconds left, rounded up so 00:00 appears only when the time is really over. */
export function remainingSeconds(clock: QuizClock): number | null {
  if (clock.limitSec == null) return null;
  return Math.max(0, Math.ceil((clock.limitSec * 1000 - clock.consumedMs) / 1000));
}

/** While online the server's count wins. */
export function reanchorClock(
  clock: QuizClock,
  serverRemainingSec: number,
  sample: ClockSample,
): QuizClock {
  return createClock(clock.limitSec, serverRemainingSec, sample);
}
