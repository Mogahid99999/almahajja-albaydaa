/**
 * supabase/functions/_shared/rawUpload.ts — r2-upload-url kind `lecture_raw`
 * (V23 §5.3): the admin's ORIGINAL file, ≤ 2 GB, opaque `incoming/` key.
 */
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { RAW_CONTENT_TYPE_BY_EXT, RAW_MAX_BYTES as CLIENT_RAW_MAX_BYTES } from '@/api/mediaJobs';
import {
  checkRawUpload,
  RAW_CONTENT_TYPES,
  RAW_MAX_BYTES,
  RAW_URL_TTL_SECONDS,
  rawExtension,
  rawIncomingKey,
} from '../../supabase/functions/_shared/rawUpload';

describe('checkRawUpload', () => {
  test('a normal original passes with its extension', () => {
    expect(checkRawUpload({ fileName: 'المجلس الأول.WAV', contentType: 'audio/wav', size: 10_000 })).toEqual({
      ok: true,
      ext: 'wav',
      contentType: 'audio/wav',
      size: 10_000,
    });
  });

  test('MP4 video is accepted (the worker extracts the audio track)', () => {
    expect(checkRawUpload({ fileName: 'مجلس.mp4', contentType: 'video/mp4', size: 5 }).ok).toBe(true);
  });

  test('exactly 2 GB passes, one byte more is refused', () => {
    expect(checkRawUpload({ fileName: 'a.mp3', contentType: 'audio/mpeg', size: 2 * 1024 ** 3 }).ok).toBe(true);
    expect(checkRawUpload({ fileName: 'a.mp3', contentType: 'audio/mpeg', size: 2 * 1024 ** 3 + 1 })).toEqual({
      ok: false,
      error: 'file too large',
    });
  });

  test.each([
    ['missing size', { fileName: 'a.mp3', contentType: 'audio/mpeg' }],
    ['zero size', { fileName: 'a.mp3', contentType: 'audio/mpeg', size: 0 }],
    ['fractional size', { fileName: 'a.mp3', contentType: 'audio/mpeg', size: 1.5 }],
    ['string size', { fileName: 'a.mp3', contentType: 'audio/mpeg', size: '100' }],
  ])('%s is refused (the size is bound into the signature)', (_l, body) => {
    expect(checkRawUpload(body)).toEqual({ ok: false, error: 'size required' });
  });

  test('non-audio types are refused', () => {
    for (const contentType of ['application/pdf', 'text/html', 'image/png', 'video/webm']) {
      expect(checkRawUpload({ fileName: 'a.bin', contentType, size: 1 }).ok).toBe(false);
    }
  });
});

describe('keys', () => {
  test('the key is opaque — never derived from the admin file name', () => {
    expect(rawIncomingKey('0b7c…uuid', rawExtension('../../lectures/x.mp3'))).toBe('incoming/0b7c…uuid.mp3');
    expect(rawExtension('بدون امتداد')).toBe('bin');
    expect(rawExtension('a.m p3')).toBe('bin');
    expect(rawExtension('a.verylongext')).toBe('bin');
  });
});

test('limits: 2 GB on both sides, URL lives ≥ 2 h', () => {
  expect(RAW_MAX_BYTES).toBe(2 * 1024 ** 3);
  expect(CLIENT_RAW_MAX_BYTES).toBe(RAW_MAX_BYTES);
  expect(RAW_URL_TTL_SECONDS).toBeGreaterThanOrEqual(2 * 3600);
});

test('every content type the admin client can send is one the function accepts', () => {
  for (const type of new Set(Object.values(RAW_CONTENT_TYPE_BY_EXT))) {
    expect(RAW_CONTENT_TYPES).toContain(type);
  }
  expect(RAW_CONTENT_TYPES).toContain('video/mp4');
});
