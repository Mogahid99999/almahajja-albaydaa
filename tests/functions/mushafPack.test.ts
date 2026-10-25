/**
 * supabase/functions/_shared/mushafPack.ts — the mushaf-pack function may only
 * ever sign objects inside mushaf/<version>/ (page fonts + glyph index).
 */
import { MAX_SIGN, packKey, parsePackRequest } from '../../supabase/functions/_shared/mushafPack';

describe('mushaf-pack request validation', () => {
  it('accepts a manifest request and a bounded sign request', () => {
    expect(parsePackRequest({ action: 'manifest' })).toEqual({ action: 'manifest' });
    expect(
      parsePackRequest({ action: 'sign', version: 'madinah-1405-v1', paths: ['p001.ttf.gz', 'glyphs.json.gz'] }),
    ).toEqual({ action: 'sign', version: 'madinah-1405-v1', paths: ['p001.ttf.gz', 'glyphs.json.gz'] });
  });

  it.each([
    ['path traversal', { action: 'sign', version: 'v1', paths: ['../lectures/a.m4a'] }],
    ['other prefixes', { action: 'sign', version: 'v1', paths: ['answers/x.m4a'] }],
    ['raw keys', { action: 'sign', version: 'v1', paths: ['p001.ttf'] }],
    ['a version escaping its folder', { action: 'sign', version: '../x', paths: ['p001.ttf.gz'] }],
    ['too many paths', { action: 'sign', version: 'v1', paths: Array(MAX_SIGN + 1).fill('p001.ttf.gz') }],
    ['no paths', { action: 'sign', version: 'v1', paths: [] }],
    ['an unknown action', { action: 'list' }],
    ['no body', null],
  ])('rejects %s', (_label, body) => {
    expect(typeof parsePackRequest(body)).toBe('string');
  });

  it('keys stay under mushaf/<version>/', () => {
    expect(packKey('madinah-1405-v1', 'p604.ttf.gz')).toBe('mushaf/madinah-1405-v1/p604.ttf.gz');
  });
});
