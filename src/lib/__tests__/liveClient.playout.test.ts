/**
 * src/lib/liveClient.ts recreatePlayout — the staging echo regression
 * (2026-09-30): a listener's WebRTC playout track is created as USAGE_MEDIA;
 * switching to the speaking profile only changed the attributes field, so the
 * running track stayed media and the hardware echo canceller had no reference
 * for it → a moderator's loudspeaker fed the sheikh back into the room
 * (+0.7–0.85 s in the recording). The fix re-creates the track: every remote
 * audio track is unsubscribed, the removals are awaited (WebRTC stops playout
 * when its last receive stream goes), then everything is subscribed again.
 * Fake publications stand in for livekit-client (the SDK never loads in Jest).
 */
import type * as LK from 'livekit-client';

import { recreatePlayout } from '@/lib/liveClient';

type FakePub = {
  isSubscribed: boolean;
  track: object | undefined;
  setSubscribed: jest.Mock;
};

/** A subscribed audio publication whose SDP removal lands `removeAfterMs` after an unsubscribe (null = never). */
function pub(removeAfterMs: number | null = 300, subscribed = true): FakePub {
  const p: FakePub = {
    isSubscribed: subscribed,
    track: subscribed ? {} : undefined,
    setSubscribed: jest.fn((on: boolean) => {
      if (on) return; // re-subscribing lands later; not needed here
      if (removeAfterMs === null) return;
      setTimeout(() => {
        p.track = undefined;
        p.isSubscribed = false;
      }, removeAfterMs);
    }),
  };
  return p;
}

function room(...participants: FakePub[][]): LK.Room {
  return {
    remoteParticipants: new Map(
      participants.map((pubs, i) => [
        `p${i}`,
        { audioTrackPublications: new Map(pubs.map((x, j) => [`t${i}-${j}`, x])) },
      ]),
    ),
  } as unknown as LK.Room;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-30T12:00:00Z'));
});
afterEach(() => {
  jest.useRealTimers();
});

test('the echo fix: every remote audio track goes, playout stops, then all come back (new track, new attributes)', async () => {
  const host = pub(300);
  const speaker = pub(500);
  const done = recreatePlayout(room([host], [speaker]));

  expect(host.setSubscribed).toHaveBeenCalledWith(false);
  expect(speaker.setSubscribed).toHaveBeenCalledWith(false);

  // Not before the LAST removal landed: one receive stream left keeps the old track playing.
  await jest.advanceTimersByTimeAsync(450);
  expect(host.setSubscribed).not.toHaveBeenCalledWith(true);
  expect(speaker.setSubscribed).not.toHaveBeenCalledWith(true);

  await jest.advanceTimersByTimeAsync(400);
  await done;
  expect(host.setSubscribed).toHaveBeenLastCalledWith(true);
  expect(speaker.setSubscribed).toHaveBeenLastCalledWith(true);
});

test('nothing subscribed (paused / nobody publishes) → nothing to re-create', async () => {
  const idle = pub(300, false);
  await recreatePlayout(room([idle]));
  expect(idle.setSubscribed).not.toHaveBeenCalled();
});

test('a removal that never lands (weak network) still ends subscribed again, after the 4 s cap', async () => {
  const stuck = pub(null);
  const done = recreatePlayout(room([stuck]));
  await jest.advanceTimersByTimeAsync(3900);
  expect(stuck.setSubscribed).not.toHaveBeenCalledWith(true);
  await jest.advanceTimersByTimeAsync(400);
  await done;
  expect(stuck.setSubscribed).toHaveBeenLastCalledWith(true);
});
