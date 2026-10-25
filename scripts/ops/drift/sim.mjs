// Reproduce the sheikh's phone: a publisher whose audio clock runs DRIFT slow (10 ms of
// audio every 10 ms × (1 + DRIFT) of wall time), recorded by the production egress into a
// local file on the VPS. Room has no prd_/stg_ prefix → the media workers ignore it.
// Usage: node sim.mjs <repo .env> <label> [drift=0.02] [seconds=360]
import fs from 'node:fs';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { AccessToken, EgressClient, EncodedFileOutput, EncodedFileType, RoomServiceClient } from 'livekit-server-sdk';

const [envFile, label, driftArg, secArg] = process.argv.slice(2);
const DRIFT = Number(driftArg ?? 0.02);
const SECONDS = Number(secArg ?? 360);
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const WS = env.LIVEKIT_URL;
const HTTP = WS.replace(/^ws/, 'http');
const KEY = env.LIVEKIT_API_KEY, SECRET = env.LIVEKIT_API_SECRET;
const room = `zz_drift_${label}_${Date.now().toString(36)}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const rooms = new RoomServiceClient(HTTP, KEY, SECRET);
await rooms.createRoom({ name: room, emptyTimeout: 120, departureTimeout: 30 });
const at = new AccessToken(KEY, SECRET, { identity: 'zz_drift_pub', ttl: '1h' });
at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: false });
const lkRoom = new Room();
await lkRoom.connect(WS, await at.toJwt(), { autoSubscribe: false, dynacast: false });

const RATE = 48000, FRAME = 480; // 10 ms
const source = new AudioSource(RATE, 1, 0); // no internal queue: WE pace the "capture clock"
const track = LocalAudioTrack.createAudioTrack('drift', source);
const opts = new TrackPublishOptions();
opts.source = TrackSource.SOURCE_MICROPHONE;
await lkRoom.localParticipant.publishTrack(track, opts);
log('published in', room, `drift=${DRIFT * 100}%`, `${SECONDS}s`);

const egress = new EgressClient(HTTP, KEY, SECRET);
await new Promise((r) => setTimeout(r, 1500));
const info = await egress.startRoomCompositeEgress(
  room,
  new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath: `/home/egress/tmp/${room}.ogg` }),
  { audioOnly: true },
);
log('egress', info.egressId);

// A continuous, speech-like tone (220 Hz with a slow swell) — any silence in the file = a drop.
let n = 0;
const t0 = performance.now();
const frames = Math.round((SECONDS * 1000) / 10);
for (let f = 0; f < frames; f++) {
  const pcm = new Int16Array(FRAME);
  for (let i = 0; i < FRAME; i++, n++) {
    const t = n / RATE;
    pcm[i] = Math.round(9000 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.7 * t)) * Math.sin(2 * Math.PI * 220 * t));
  }
  await source.captureFrame(new AudioFrame(pcm, RATE, 1, FRAME));
  const target = t0 + (f + 1) * 10 * (1 + DRIFT);
  const wait = target - performance.now();
  if (wait > 1) await new Promise((r) => setTimeout(r, wait));
  if (f % 6000 === 0 && f > 0) log(`sent ${(f / 100).toFixed(0)} s of audio in ${((performance.now() - t0) / 1000).toFixed(0)} s wall`);
}
log(`done: ${(frames / 100).toFixed(0)} s of audio in ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
await egress.stopEgress(info.egressId).catch((e) => log('stop', e.message));
await new Promise((r) => setTimeout(r, 4000));
await lkRoom.disconnect();
await rooms.deleteRoom(room).catch(() => undefined);
console.log(JSON.stringify({ room, egressId: info.egressId, file: `${room}.ogg` }));
process.exit(0);
