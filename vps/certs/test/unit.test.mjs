import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildView, fillTemplate } from '../src/render.mjs';
import { formatIssueDate } from '../src/dates.mjs';
import { APP_STORE_URL, CERTIFICATE_ID_RE, GOOGLE_PLAY_URL, storeBadges, verificationPage } from '../src/verify-page.mjs';
import { RateLimiter } from '../src/rate-limit.mjs';
import os from 'node:os';
import path from 'node:path';
import { readStoredFile, removeFile, saveFile, signature, validLink } from '../src/storage.mjs';

const template = fs.readFileSync(new URL('../templates/v1.html', import.meta.url), 'utf8');
const cert = (over = {}) => ({
  id: 'MAH-7K3F-Q9XW-2MTC',
  issued_at: '2026-11-09T10:00:00Z',
  snapshot: {
    student_name: 'أحمد محمد عبدالله', gender: 'male', title: 'كتاب التوحيد',
    author_line: 'للإمام محمد بن عبد الوهاب رحمه الله',
    presenter_line: 'بشرح فضيلة الشيخ النذير محمد فرح', custom_text: null,
    verification_url: 'https://almahajja.app/c/MAH-7K3F-Q9XW-2MTC', ...over,
  },
});
const fill = async (c) => fillTemplate(template, await buildView(c));

test('template: male wording', async () => {
  const h = await fill(cert());
  assert.match(h, /بأن الطالب</);
  assert.match(h, /قد أتمّ بحمد/);
  assert.match(h, /واستوفى/);
  assert.match(h, /ينفعه بما تعلّم/);
  assert.doesNotMatch(h, /الطالبة|أتمّت|استوفت|ينفعها/);
});

test('template: female wording', async () => {
  const h = await fill(cert({ gender: 'female' }));
  assert.match(h, /بأن الطالبة</);
  assert.match(h, /قد أتمّت بحمد/);
  assert.match(h, /واستوفت/);
  assert.match(h, /ينفعها بما تعلّمت، وأن يزيدها/);
});

test('template: no author, no line', async () => {
  const h = await fill(cert({ author_line: null, presenter_line: 'تقديم فضيلة الشيخ' }));
  assert.doesNotMatch(h, /data-slot="author"/);
  assert.match(h, /تقديم فضيلة الشيخ/);
});

test('template: names are escaped', async () => {
  const h = await fill(cert({ student_name: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(h, /<img src=x/);
});

test('template: custom text replaces the default closing', async () => {
  const h = await fill(cert({ custom_text: 'نص خاص' }));
  assert.match(h, /نص خاص/);
  assert.doesNotMatch(h, /سائلين الله/);
});

test('template: the printed link is a real link', async () => {
  assert.match((await fill(cert())).replaceAll('&#x2F;', '/'), /<a data-slot="verify"[^>]*href="https:\/\/almahajja\.app\/c\/MAH-7K3F-Q9XW-2MTC"/);
});

test('issue date is Umm al-Qura in Makkah time', () => {
  // 2026-11-08 22:00 UTC is already the next Gregorian day in Makkah
  assert.notEqual(formatIssueDate('2026-11-08T20:00:00Z'), formatIssueDate('2026-11-08T22:00:00Z'));
  assert.match(formatIssueDate('2026-11-09T10:00:00Z'), /١٤٤٨هـ$/);
});

test('id shape', () => {
  assert.ok(CERTIFICATE_ID_RE.test('MAH-7K3F-Q9XW-2MTC'));
  for (const bad of ['MAH-1448-00127', 'MAH-7K3F-Q9XW-2MTI', "MAH-7K3F-Q9XW-2MT'", '']) assert.ok(!CERTIFICATE_ID_RE.test(bad));
});

test('verification page: valid, revoked, missing', () => {
  const v = verificationPage({ status: 'valid', id: 'MAH-7K3F-Q9XW-2MTC', student_name: 'فاطمة', gender: 'female', title: 'قصص الأنبياء', author: null, presenter_line: 'تقديم الشيخ', issued_at: '2026-11-09T10:00:00Z' });
  assert.match(v, /شهادة موثقة من المَحجّة البَيْضَاء/);
  assert.match(v, /الطالبة/);
  assert.doesNotMatch(v, /<dt>المؤلف/);
  const r = verificationPage({ status: 'revoked' });
  assert.match(r, /لم تعد صالحة/);
  const m = verificationPage(null);
  assert.match(m, /لم نجد شهادة/);
  assert.doesNotMatch(m, /<dl>/);
});

test('rate limit', () => {
  let t = 0;
  const l = new RateLimiter(2, 1000, () => t);
  assert.ok(l.allow('a') && l.allow('a'));
  assert.ok(!l.allow('a'));
  assert.ok(l.allow('b'));
  t = 1000;
  assert.ok(l.allow('a'));
});

const KEY = 'certificates/123e4567-e89b-42d3-a456-426614174000.pdf';

test('files: stored on disk, read back, then removed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-'));
  await saveFile(root, KEY, Buffer.from('pdf'));
  assert.equal((await readStoredFile(root, KEY)).toString(), 'pdf');
  await removeFile(root, KEY);
  assert.equal(await readStoredFile(root, KEY), null);
});

test('files: keys outside the certificate shape are refused', async () => {
  await assert.rejects(saveFile(os.tmpdir(), 'certificates/../../etc/passwd', Buffer.from('x')));
  await assert.rejects(readStoredFile(os.tmpdir(), '../secret.pdf'));
});

test('files: a link holds only for its file, expiry and name, and until it expires', () => {
  const sig = signature('s', KEY, '2000', 'a.pdf');
  assert.equal(validLink('s', KEY, '2000', 'a.pdf', sig, 1000), true);
  assert.equal(validLink('s', KEY, '2000', 'a.pdf', sig, 3000), false);
  assert.equal(validLink('other', KEY, '2000', 'a.pdf', sig, 1000), false);
  assert.equal(validLink('s', KEY, '2001', 'a.pdf', sig, 1000), false);
  assert.equal(validLink('s', KEY, '2000', 'b.pdf', sig, 1000), false);
  assert.equal(validLink('s', KEY, '2000', 'a.pdf', 'zz', 1000), false);
});

const validResult = { status: 'valid', id: 'MAH-7K3F-Q9XW-2MTC', student_name: 'فاطمة', gender: 'female', title: 'قصص الأنبياء', author: null, presenter_line: null, issued_at: '2026-11-09T10:00:00Z' };

test('verify page: both stores in every state, official links, status first', () => {
  for (const [result, status] of [[validResult, 'شهادة صالحة'], [{ status: 'revoked' }, 'شهادة غير صالحة'], [null, 'تعذّر التحقق']]) {
    const h = verificationPage(result).replaceAll('&#x2F;', '/');
    assert.ok(h.includes(GOOGLE_PLAY_URL) && h.includes(APP_STORE_URL));
    assert.ok(h.indexOf(status) < h.indexOf('حمّل تطبيق'), status);
  }
});

test('verify page: the visitor\'s store comes first, the other stays', () => {
  const first = (ua) => storeBadges(ua).indexOf('apps.apple.com') < storeBadges(ua).indexOf('play.google.com') ? 'apple' : 'play';
  assert.equal(first('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'apple');
  assert.equal(first('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 'apple');
  assert.equal(first('Mozilla/5.0 (Linux; Android 15; SM-A546E)'), 'play');
  assert.equal(first('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'play');
});
