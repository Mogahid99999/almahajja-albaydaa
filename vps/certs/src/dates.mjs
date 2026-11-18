// One issue date, one wording: Umm al-Qura in Arabic digits, Makkah time.
const ZONE = 'Asia/Riyadh';

export function formatIssueDate(issuedAt) {
  const parts = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date(issuedAt));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}هـ`;
}
