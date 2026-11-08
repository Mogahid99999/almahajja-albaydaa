import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildView, fillTemplate } from '../src/render.mjs';
import { formatIssueDate } from '../src/dates.mjs';
import { CERTIFICATE_ID_RE, verificationPage } from '../src/verify-page.mjs';
import { RateLimiter } from '../src/rate-limit.mjs';

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
