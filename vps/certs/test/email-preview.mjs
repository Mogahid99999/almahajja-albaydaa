// Local preview of the certificate email: renders sample certificates with the worker's code,
// builds both emails (male/female) and wraps them in one self-contained review page.
// Usage: node test/email-preview.mjs <output dir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { renderCertificate } from '../src/render.mjs';
import { certificateEmail, shareCaption } from '../src/email.mjs';
import { sharePage } from '../src/share-page.mjs';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const template = fs.readFileSync(new URL('../templates/v3.html', import.meta.url), 'utf8');
const logo = 'data:image/png;base64,' + fs.readFileSync(new URL('../assets/email-logo.png', import.meta.url)).toString('base64');
const id = 'MAH-7K3F-Q9XW-2MTC';
const verifyUrl = `https://almahajja.app/c/${id}`;
const students = {
  m: { student_name: 'أحمد محمد عبدالله', gender: 'male', to: 'ahmad@example.com' },
  f: { student_name: 'فاطمة أحمد', gender: 'female', to: 'fatima@example.com' },
};

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const docs = {};
let pdfKb = 0;
let share = '';
for (const [k, s] of Object.entries(students)) {
  const r = await renderCertificate(b, template, {
    id, issued_at: '2026-11-09T10:00:00Z',
    snapshot: { student_name: s.student_name, gender: s.gender, title: 'كِتَابُ التَّوْحِيدِ', author_line: 'للإمام محمد بن عبد الوهاب رحمه الله', presenter_line: 'بشرح فضيلة الشيخ النذير محمد فرح', custom_text: null, verification_url: verifyUrl },
  });
  pdfKb = Math.round(r.pdf.length / 1024);
  const e = certificateEmail({
    id, studentName: s.student_name, gender: s.gender, title: 'كتاب التوحيد', date: r.issueDateText, verifyUrl,
    downloadUrl: `https://certs.almahajja.app/d/${id}`, imageUrl: 'data:image/jpeg;base64,' + r.preview.toString('base64'),
    shareUrl: `https://certs.almahajja.app/s/${id}`, base: 'https://certs.almahajja.app',
  });
  if (k === 'm') {
    // The share page as a phone shows it (share.js does not run here, so its button is shown directly).
    const img = 'data:image/jpeg;base64,' + r.preview.toString('base64');
    share = sharePage({ id, sig: 'x', title: 'كتاب التوحيد', caption: shareCaption('كتاب التوحيد') })
      .replace(/<script[^>]*><\/script>/, '').replace(/src="[^"]*image[^"]*"/, `src="${img}"`).replace(/ hidden>/, '>')
      .replace(/href="[^"]*save[^"]*"/, 'href="#"').replace(/url\(\/fonts[^)]*\)/g, 'local(x)');
  }
  // Links open outside the preview frame, as they would from a mail app.
  docs[k] = e.html.replace(/src="[^"]*email-logo\.png"/, `src="${logo}"`).replace('<head>', '<head><base target="_blank">');
  fs.writeFileSync(path.join(out, `email-${k}.html`), docs[k]);
  fs.writeFileSync(path.join(out, `email-${k}.txt`), `${e.subject}\n\n${e.text}`);
}
await b.close();

const esc = (s) => JSON.stringify(s).replace(/</g, '\\u003c');
const page = `<title>بريد الشهادة</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600&family=Amiri:wght@700&display=swap">
<style>
/* Layout: a quiet mail-client frame; the real email renders untouched inside it. */
:root{--bg:#efe9dd;--panel:#fbf8f1;--fg:#2b2723;--muted:#6b6253;--line:#ddd2bb;--accent:#1f4a42;--chip:#e9e0cc;
--display:Amiri,'Traditional Arabic',serif;--body:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171b19;--panel:#202624;--fg:#ece6da;--muted:#a59d8e;--line:#36403c;--accent:#8cc5b5;--chip:#2c3532;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#171b19;--panel:#202624;--fg:#ece6da;--muted:#a59d8e;--line:#36403c;--accent:#8cc5b5;--chip:#2c3532;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--body);padding-block:24px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wrap{max-width:880px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
h1{font-family:var(--display);font-size:28px;margin:0;color:var(--accent);text-wrap:balance}
.lead{margin:0;color:var(--muted);line-height:1.9;font-size:15px;max-width:65ch}
.bar{display:flex;flex-wrap:wrap;gap:10px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}
.seg button{font:inherit;font-size:14px;border:0;background:none;color:var(--fg);padding:8px 16px;cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--accent);color:var(--panel)}
.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mail{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.head{padding:16px 18px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
.subj{font-size:18px;font-weight:600;line-height:1.6}
.from{display:flex;gap:12px;align-items:center;min-width:0}
.av{flex:none;width:40px;height:40px;border-radius:50%;background:var(--accent);color:var(--panel);display:grid;place-items:center;font-family:var(--display);font-size:20px}
.who{min-width:0;font-size:14px;line-height:1.6}.who b{font-weight:600}.who span{color:var(--muted);direction:ltr;unicode-bidi:isolate}
.att{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;background:var(--chip);border-radius:8px;padding:6px 12px;font-size:13px;max-width:100%}
.att i{font-style:normal;font-weight:600;color:#b3261e}.att span{direction:ltr;unicode-bidi:isolate;overflow-wrap:anywhere}.att small{color:var(--muted)}
.stage{background:#f3ecdd;display:flex;justify-content:center;overflow-x:auto}
iframe{display:block;border:0;width:100%;max-width:100%;height:1500px;transition:width .2s}
.stage.phone iframe{width:390px}
@media (prefers-reduced-motion:reduce){iframe{transition:none}}
.h2{font-family:var(--display);font-size:22px;margin:12px 0 0;color:var(--accent)}
.notes{font-size:14px;line-height:1.9;color:var(--muted);margin:0;padding-inline-start:20px}
</style>
<div class="wrap">
  <h1>بريد الشهادة كما يصل للطالب</h1>
  <p class="lead">هذه الرسالة تُرسل تلقائيًا بعد صدور الشهادة إلى بريد الطالب المسجّل في حسابه. الصورة عيّنة من القالب الحالي. الروابط تفتح في صفحة جديدة كما في البريد الحقيقي، وروابط التحميل والمشاركة والتحقق هنا تجريبية.</p>
  <div class="bar">
    <div class="seg" role="group" aria-label="الطالب"><button id="g-m" aria-pressed="true">طالب</button><button id="g-f" aria-pressed="false">طالبة</button></div>
    <div class="seg" role="group" aria-label="الجهاز"><button id="d-p" aria-pressed="true">هاتف</button><button id="d-d" aria-pressed="false">حاسوب</button></div>
  </div>
  <article class="mail">
    <div class="head">
      <div class="subj">شهادتك في «كتاب التوحيد» — المَحجّة البَيْضَاء</div>
      <div class="from"><div class="av">م</div><div class="who"><b>المَحجّة البَيْضَاء</b> <span>&lt;no-reply@almahajja.app&gt;</span><br>إلى: <span id="to">${students.m.to}</span></div></div>
      <div class="att"><i>PDF</i><span>certificate-${id}.pdf</span><small>${pdfKb} KB</small></div>
    </div>
    <div class="stage phone" id="stage"><iframe id="f" title="نص الرسالة" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>
  </article>
  <ul class="notes">
    <li>زر «تحميل الشهادة» رابط دائم يفتح ملف PDF، ويتوقف إن أُلغيت الشهادة.</li>
    <li>زر «مشاركة صورة الشهادة» يفتح صفحة المشاركة (أدناه). منها يختار الطالب واتساب أو فيسبوك أو غيرهما من قائمة الهاتف، فتصل الشهادة صورةً لا رابطًا.</li>
    <li>على الحاسوب لا تدعم أغلب المتصفحات مشاركة الصور، فيظهر زر «حفظ الصورة» وحده.</li>
    <li>الطلاب الذين لم يسجّلوا بريدًا لا تصلهم رسالة، وتبقى الشهادة في التطبيق كما هي.</li>
  </ul>
  <h2 class="h2">صفحة المشاركة</h2>
  <p class="lead">تفتح من زر «مشاركة صورة الشهادة» في الرسالة. «مشاركة الصورة» يفتح قائمة المشاركة في الهاتف بالصورة نفسها.</p>
  <div class="stage phone"><iframe id="sp" title="صفحة المشاركة" style="height:760px" sandbox="allow-same-origin"></iframe></div>
</div>
<script>
const docs={m:${esc(docs.m)},f:${esc(docs.f)}};
const to={m:${esc(students.m.to)},f:${esc(students.f.to)}};
const fr=document.getElementById('f'),st=document.getElementById('stage');
let g='m';
function fit(){try{const d=fr.contentDocument;if(d&&d.body)fr.style.height=(d.documentElement.scrollHeight+4)+'px'}catch(e){}}
function show(){fr.srcdoc=docs[g];document.getElementById('to').textContent=to[g]}
fr.addEventListener('load',()=>{fit();setTimeout(fit,300)});
function press(a,b){a.setAttribute('aria-pressed','true');b.setAttribute('aria-pressed','false')}
const gm=document.getElementById('g-m'),gf=document.getElementById('g-f'),dp=document.getElementById('d-p'),dd=document.getElementById('d-d');
gm.onclick=()=>{g='m';press(gm,gf);show()};gf.onclick=()=>{g='f';press(gf,gm);show()};
dp.onclick=()=>{st.classList.add('phone');press(dp,dd);setTimeout(fit,250)};dd.onclick=()=>{st.classList.remove('phone');press(dd,dp);setTimeout(fit,250)};
show();
document.getElementById('sp').srcdoc=${esc(share)};
</script>`;
fs.writeFileSync(path.join(out, 'certificate-email-preview.html'), page);
console.log('preview', Math.round(page.length / 1024) + 'KB', 'pdf', pdfKb + 'KB');
