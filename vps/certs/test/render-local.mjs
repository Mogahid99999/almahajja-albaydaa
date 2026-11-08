// Local visual check: renders the hard cases with the same code the worker uses.
// Usage: node test/render-local.mjs <output dir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { renderCertificate } from '../src/render.mjs';

const out = process.argv[2];
const template = fs.readFileSync(new URL('../templates/v1.html', import.meta.url), 'utf8');
const base = {
  student_name: 'أحمد محمد عبدالله', gender: 'male', title: 'كِتَابُ التَّوْحِيدِ',
  author_line: 'للإمام محمد بن عبد الوهاب رحمه الله',
  presenter_line: 'بشرح فضيلة الشيخ النذير محمد فرح', custom_text: null,
  verification_url: 'https://almahajja.app/c/MAH-7K3F-Q9XW-2MTC',
};
const cases = {
  book: {},
  deep: { title: 'العنوان الأصلي', student_name: 'مريم عبد الله' },
  noauthor: { gender: 'female', student_name: 'فاطمة أحمد', title: 'قِصَصُ الأَنْبِيَاءِ', author_line: null, presenter_line: 'تقديم فضيلة الشيخ النذير محمد فرح' },
  longname: { student_name: 'عبد الرحمن بن محمد بن عبد الله بن إبراهيم بن عبد الكريم العبدالكريم الهاشمي القرشي' },
  fatima: { student_name: 'فاطمة أحمد', gender: 'female' },
  longtitle: { title: 'شَرْحُ العَقِيدَةِ الوَاسِطِيَّةِ لِشَيْخِ الإِسْلَامِ ابْنِ تَيْمِيَّةَ رَحِمَهُ اللهُ' },
  verylong: { title: 'الدُّرَرُ البَهِيَّةُ فِي شَرْحِ مَسَائِلِ العَقِيدَةِ وَالتَّوْحِيدِ وَأُصُولِ الدِّينِ عَلَى مَنْهَجِ السَّلَفِ الصَّالِحِ مِنْ أَهْلِ السُّنَّةِ وَالجَمَاعَةِ', student_name: 'عبد الرحمن بن محمد بن عبد الله بن إبراهيم العبدالكريم' },
  custom: { custom_text: 'وقد اجتاز جميع المتطلبات المقررة للبرنامج العلمي، سائلين الله له التوفيق والسداد في العلم والعمل.' },
};
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
for (const [name, over] of Object.entries(cases)) {
  const r = await renderCertificate(b, template, { id: 'MAH-7K3F-Q9XW-2MTC', issued_at: '2026-11-09T10:00:00Z', snapshot: { ...base, ...over } });
  fs.writeFileSync(path.join(out, `${name}.pdf`), r.pdf);
  fs.writeFileSync(path.join(out, `${name}.jpg`), r.preview);
  console.log(name, Math.round(r.pdf.length / 1024) + 'KB', JSON.stringify(r.layout), r.issueDateText);
}
await b.close();
