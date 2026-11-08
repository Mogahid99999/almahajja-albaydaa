// The public page behind the QR code and the printed link. Server-rendered, no script,
// no client keys. It only says what verify_certificate returned.
import Mustache from 'mustache';
import { formatIssueDate } from './dates.mjs';

export const CERTIFICATE_ID_RE = /^MAH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const LOGO = `<svg role="img" aria-label="شعار المحجة البيضاء" width="44" height="52" viewBox="130 160 252 300"><polygon points="206,171 254,193 254,215 206,192" fill="#b0894f"/><polygon points="258,193 306,171 306,192 258,215" fill="#b0894f"/><polygon points="226,232 286,232 370,450 142,450" fill="#1f4a42"/></svg>`;

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{{page_title}} — المَحجّة البَيْضَاء</title>
<style>
@font-face{font-family:Amiri;font-weight:400;src:url(/fonts/amiri/amiri-arabic-400-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Amiri;font-weight:700;src:url(/fonts/amiri/amiri-arabic-700-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Plex;font-weight:400;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-arabic-400-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Plex;font-weight:400;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-latin-400-normal.woff2) format("woff2");unicode-range:U+0000-00FF;font-display:swap}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f3ecdd;color:#2b2723;font-family:Plex,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
main{width:100%;max-width:520px;background:#fbf7ed;border:1px solid #cbb98e;border-radius:16px;padding:32px 24px;text-align:center}
.brand{font-family:Amiri,serif;font-weight:700;font-size:26px;color:#1f4a42;margin:12px 0 0;line-height:1.5}
.badge{display:inline-block;margin-top:18px;padding:7px 16px;border-radius:99px;font-size:15px;background:#1f4a42;color:#fbf7ed}
.badge.bad{background:#efe4cf;color:#6b4a2b}
h1{font-family:Amiri,serif;font-size:27px;line-height:1.6;color:#2b2723;margin:18px 0 6px}
p.note{color:#5c5343;font-size:15px;line-height:1.9;margin:10px 0 0}
dl{margin:22px 0 0;text-align:right;border-top:1px solid #e3d8bf}
.row{padding:12px 2px;border-bottom:1px solid #e3d8bf}
dt{font-size:13px;color:#6b6253;margin-bottom:3px}
dd{margin:0;font-size:18px;line-height:1.7;overflow-wrap:anywhere}
dd.title{font-family:Amiri,serif;font-size:24px;font-weight:700;color:#1f4a42}
dd.id{direction:ltr;text-align:right;font-size:15px}
</style>
</head>
<body>
<main>
  ${LOGO}
  <div class="brand">المَحجّة البَيْضَاء</div>
  {{#valid}}
  <div class="badge">شهادة صالحة</div>
  <h1>شهادة موثقة من المَحجّة البَيْضَاء</h1>
  <dl>
    <div class="row"><dt>{{student_label}}</dt><dd>{{student_name}}</dd></div>
    <div class="row"><dt>المادة</dt><dd class="title">{{title}}</dd></div>
    {{#author}}<div class="row"><dt>المؤلف</dt><dd>{{author}}</dd></div>{{/author}}
    {{#presenter_line}}<div class="row"><dt>مقدم المادة</dt><dd>{{presenter_line}}</dd></div>{{/presenter_line}}
    <div class="row"><dt>تاريخ الإصدار</dt><dd>{{date}}</dd></div>
    <div class="row"><dt>رقم الشهادة</dt><dd class="id">{{id}}</dd></div>
    <div class="row"><dt>حالة الشهادة</dt><dd>صالحة</dd></div>
  </dl>
  {{/valid}}
  {{#revoked}}
  <div class="badge bad">شهادة غير صالحة</div>
  <h1>هذه الشهادة لم تعد صالحة</h1>
  <p class="note">أُلغيت هذه الشهادة من قِبل المَحجّة البَيْضَاء.</p>
  {{/revoked}}
  {{#missing}}
  <div class="badge bad">تعذّر التحقق</div>
  <h1>لم نجد شهادة بهذا الرقم</h1>
  <p class="note">تأكد من مسح الرمز كاملًا أو من كتابة الرابط كما هو مطبوع على الشهادة.</p>
  {{/missing}}
</main>
</body>
</html>`;

export function verificationPage(result) {
  if (result?.status === 'valid') {
    return Mustache.render(PAGE, {
      page_title: 'شهادة موثقة',
      valid: true,
      student_label: result.gender === 'female' ? 'الطالبة' : 'الطالب',
      student_name: result.student_name,
      title: result.title,
      author: result.author,
      presenter_line: result.presenter_line,
      id: result.id,
      date: result.issue_date_text || formatIssueDate(result.issued_at),
    });
  }
  if (result?.status) return Mustache.render(PAGE, { page_title: 'شهادة غير صالحة', revoked: true });
  return Mustache.render(PAGE, { page_title: 'تعذّر التحقق', missing: true });
}
