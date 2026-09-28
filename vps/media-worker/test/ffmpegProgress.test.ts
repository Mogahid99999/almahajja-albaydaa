import { describe, expect, it } from 'vitest';
import {
  buildTranscodeArgs,
  FfmpegProgressParser,
  parseFfprobeDuration,
  phaseProgress,
  Throttle,
} from '../src/ffmpegProgress.js';
import { summarizeStderr } from '../src/media.js';

const block = (us: string, progress = 'continue') =>
  `frame=0\nfps=0.00\nbitrate=  32.0kbits/s\ntotal_size=4096\nout_time_us=${us}\nout_time_ms=${us}\nout_time=00:00:00.000000\ndup_frames=0\ndrop_frames=0\nspeed=40x\nprogress=${progress}\n`;

describe('FfmpegProgressParser', () => {
  it('turns out_time_us into a fraction of the probed duration', () => {
    const p = new FfmpegProgressParser(30);
    const [u] = p.feed(block('15000000'));
    expect(u).toEqual({ outTimeSec: 15, fraction: 0.5, done: false });
  });

  it('treats out_time_ms as MICROseconds (ffmpeg quirk) when out_time_us is absent', () => {
    const p = new FfmpegProgressParser(10);
    const [u] = p.feed('out_time_ms=2500000\nprogress=continue\n');
    expect(u?.outTimeSec).toBe(2.5);
    expect(u?.fraction).toBe(0.25);
  });

  it('ignores N/A values (fraction null, no crash)', () => {
    const p = new FfmpegProgressParser(30);
    const [u] = p.feed('out_time_us=N/A\nout_time_ms=N/A\nout_time=N/A\nprogress=continue\n');
    expect(u).toEqual({ outTimeSec: null, fraction: null, done: false });
  });

  it('reports fraction 1 and done on progress=end even without a duration', () => {
    const p = new FfmpegProgressParser(null);
    const updates = p.feed(block('1000000') + block('N/A', 'end'));
    expect(updates[0]?.fraction).toBeNull(); // unknown duration → no fraction
    expect(updates[1]).toMatchObject({ fraction: 1, done: true });
  });

  it('buffers lines split across chunks', () => {
    const p = new FfmpegProgressParser(20);
    expect(p.feed('out_time_us=100')).toEqual([]);
    expect(p.feed('00000\nprogr')).toEqual([]);
    const [u] = p.feed('ess=continue\r\n');
    expect(u?.fraction).toBe(0.5);
  });

  it('clamps to 0..1 (negative first block, overshoot past the probed duration)', () => {
    const p = new FfmpegProgressParser(10);
    const [a, b] = p.feed('out_time_us=-23220\nprogress=continue\nout_time_us=10400000\nprogress=continue\n');
    expect(a?.fraction).toBe(0);
    expect(b?.fraction).toBe(1);
  });

  it('parses several blocks from one chunk, in order', () => {
    const p = new FfmpegProgressParser(4);
    const fr = p.feed(block('1000000') + block('2000000') + block('3000000')).map((u) => u.fraction);
    expect(fr).toEqual([0.25, 0.5, 0.75]);
  });
});

describe('parseFfprobeDuration', () => {
  it('parses seconds', () => expect(parseFfprobeDuration('30.024000\n')).toBeCloseTo(30.024));
  it('returns null for N/A, empty and non-positive values', () => {
    expect(parseFfprobeDuration('N/A\n')).toBeNull();
    expect(parseFfprobeDuration('')).toBeNull();
    expect(parseFfprobeDuration('0.000000')).toBeNull();
    expect(parseFfprobeDuration('garbage')).toBeNull();
  });
});

describe('buildTranscodeArgs', () => {
  it('is the unchanged speech profile with -progress pipe:1', () => {
    expect(buildTranscodeArgs({ input: '/t/in.m4a', output: '/t/out.mp3' })).toEqual([
      '-hide_banner', '-nostats', '-y', '-i', '/t/in.m4a', '-vn',
      '-codec:a', 'libmp3lame', '-q:a', '9', '-ac', '1', '-ar', '22050',
      '-progress', 'pipe:1', '/t/out.mp3',
    ]);
  });

  it('adds loudnorm only when asked', () => {
    const args = buildTranscodeArgs({ input: 'i', output: 'o.mp3', loudnorm: true });
    expect(args.slice(args.indexOf('-af'), args.indexOf('-af') + 2)).toEqual(['-af', 'loudnorm=I=-18:TP=-2']);
    expect(args.at(-1)).toBe('o.mp3');
  });
});

describe('phaseProgress', () => {
  it('maps each phase into its own slice and never reaches 1', () => {
    expect(phaseProgress('download', 0)).toBe(0);
    expect(phaseProgress('download', 1)).toBeCloseTo(0.05);
    expect(phaseProgress('transcode', 0.5)).toBeCloseTo(0.5);
    expect(phaseProgress('upload', 1)).toBeCloseTo(0.99);
    expect(phaseProgress('upload', 7)).toBeCloseTo(0.99);
  });
});

describe('Throttle', () => {
  it('passes at most once per interval', () => {
    const t = new Throttle(1000);
    expect(t.tryPass(0)).toBe(true);
    expect(t.tryPass(10)).toBe(false);
    expect(t.tryPass(999)).toBe(false);
    expect(t.tryPass(1000)).toBe(true);
    expect(t.tryPass(1500)).toBe(false);
  });
});

describe('summarizeStderr', () => {
  it('keeps the last meaningful lines on one line', () => {
    const err = 'Input #0, wav\n  Duration: N/A\n\n[in] Invalid data found\nError opening input files\n';
    expect(summarizeStderr(err, 2)).toBe('[in] Invalid data found | Error opening input files');
  });
});
