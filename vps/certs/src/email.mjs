// The email a student receives when a certificate is issued. Email clients ignore <style>
// blocks and web fonts unevenly (Gmail strips both in places), so everything is inline,
// table-laid, and falls back to system Arabic fonts. No script, no remote CSS.
import { createHmac, timingSafeEqual } from 'node:crypto';
import Mustache from 'mustache';

// Caption that travels with the shared image (WhatsApp and Telegram keep it; Facebook drops it).
// No link: the QR code printed on the certificate verifies it.
export const shareCaption = (title) => `الحمد لله، أتممت دراسة «${title}» عبر تطبيق المَحجّة البَيْضَاء.`;

// Durable links in the email. Each purpose has its own signature, so a share link never opens the PDF.
// Revocation still applies: the routes serve only valid certificates.
export const emailLinkSig = (secret, purpose, id) =>
  createHmac('sha256', secret).update(`email:${purpose}\n${id}`).digest('hex');
export function validEmailLink(secret, purpose, id, sig) {
  if (!/^[0-9a-f]{64}$/.test(sig ?? '')) return false;
  return timingSafeEqual(Buffer.from(emailLinkSig(secret, purpose, id), 'hex'), Buffer.from(sig, 'hex'));
}

const SERIF = "Amiri,'Traditional Arabic','Times New Roman',serif";
const SANS = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";

const HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{subject}}</title>
</head>
<body style="margin:0;padding:0;background:#f3ecdd;" dir="rtl">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3ecdd;">{{preheader}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3ecdd;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:600px;background:#fbf7ed;border:1px solid #cbb98e;border-radius:16px;">

<tr><td align="center" style="padding:30px 28px 0;">
  <img src="{{base}}/assets/email-logo.png" width="44" height="52" alt="" style="display:block;border:0;">
  <div style="font-family:${SERIF};font-size:24px;font-weight:700;color:#1f4a42;line-height:1.5;margin-top:8px;">المَحجّة البَيْضَاء</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
    <td style="width:46px;border-top:1px solid #cbb98e;font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding:0 12px;font-family:${SANS};font-size:13px;letter-spacing:.5px;color:#8a6a3a;white-space:nowrap;">شهادة إتمام</td>
    <td style="width:46px;border-top:1px solid #cbb98e;font-size:0;line-height:0;">&nbsp;</td>
  </tr></table>
</td></tr>

<tr><td align="center" style="padding:18px 32px 0;">
  <h1 style="margin:0;font-family:${SERIF};font-size:28px;line-height:1.6;color:#2b2723;font-weight:700;">{{greeting}}</h1>
  <p style="margin:10px 0 0;font-family:${SANS};font-size:16px;line-height:2;color:#4d463b;">{{body}}</p>
</td></tr>

<tr><td align="center" style="padding:24px 24px 0;">
  <a href="{{verify_url}}" style="display:block;text-decoration:none;">
    <img src="{{image_url}}" width="552" alt="شهادة إتمام «{{title}}»" style="display:block;width:100%;max-width:552px;height:auto;border:1px solid #e3d8bf;border-radius:10px;">
  </a>
</td></tr>

<tr><td style="padding:20px 32px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e3d8bf;">
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e3d8bf;font-family:${SANS};font-size:13px;color:#6b6253;width:38%;">المادة</td>
      <td style="padding:12px 0;border-bottom:1px solid #e3d8bf;font-family:${SERIF};font-size:19px;font-weight:700;color:#1f4a42;line-height:1.6;">{{title}}</td>
    </tr>
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e3d8bf;font-family:${SANS};font-size:13px;color:#6b6253;">تاريخ الإصدار</td>
      <td style="padding:12px 0;border-bottom:1px solid #e3d8bf;font-family:${SANS};font-size:15px;color:#2b2723;">{{date}}</td>
    </tr>
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e3d8bf;font-family:${SANS};font-size:13px;color:#6b6253;">رقم الشهادة</td>
      <td dir="ltr" style="padding:12px 0;border-bottom:1px solid #e3d8bf;font-family:${SANS};font-size:15px;color:#2b2723;text-align:right;">{{id}}</td>
    </tr>
  </table>
</td></tr>

<tr><td align="center" style="padding:26px 32px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="#1f4a42" style="border-radius:10px;">
      <a href="{{download_url}}" style="display:inline-block;padding:14px 34px;font-family:${SANS};font-size:16px;font-weight:700;color:#fbf7ed;text-decoration:none;border-radius:10px;">تحميل الشهادة (PDF)</a>
    </td>
  </tr></table>
  <p style="margin:10px 0 0;font-family:${SANS};font-size:13px;line-height:1.8;color:#6b6253;">الشهادة مرفقة أيضًا بهذه الرسالة.</p>
</td></tr>

<tr><td align="center" style="padding:26px 32px 0;">
  <div style="border-top:1px solid #e3d8bf;padding-top:22px;font-family:${SERIF};font-size:20px;font-weight:700;color:#1f4a42;line-height:1.6;">مشاركة الشهادة</div>
  <p style="margin:4px 0 14px;font-family:${SANS};font-size:14px;line-height:1.9;color:#5c5343;">{{share_hint}}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" style="border:1px solid #1f4a42;border-radius:10px;">
      <a href="{{share_url}}" style="display:inline-block;padding:12px 28px;font-family:${SANS};font-size:16px;font-weight:700;color:#1f4a42;text-decoration:none;">مشاركة صورة الشهادة</a>
    </td>
  </tr></table>
  <p style="margin:18px 0 0;font-family:${SANS};font-size:13px;line-height:1.8;color:#6b6253;">رابط التحقق من الشهادة<br>
    <a href="{{verify_url}}" dir="ltr" style="color:#1f4a42;text-decoration:underline;word-break:break-all;">{{verify_label}}</a></p>
</td></tr>

<tr><td align="center" style="padding:28px 32px 30px;">
  <p style="margin:0;font-family:${SERIF};font-size:18px;line-height:1.9;color:#1f4a42;">{{dua}}</p>
</td></tr>

</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:18px 24px 0;font-family:${SANS};font-size:12px;line-height:1.9;color:#7a705f;">
  وصلتك هذه الرسالة لأن شهادة صدرت باسم حسابك في تطبيق المَحجّة البَيْضَاء.<br>
  <a href="{{download_page}}" style="color:#7a705f;text-decoration:underline;">حمّل التطبيق</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const TEXT = `{{greeting}}

{{body}}

المادة: {{title}}
تاريخ الإصدار: {{date}}
رقم الشهادة: {{id}}

تحميل الشهادة (PDF): {{download_url}}
الشهادة مرفقة أيضًا بهذه الرسالة.

مشاركة صورة الشهادة: {{share_url}}

رابط التحقق من الشهادة: {{verify_url}}

{{dua}}

— المَحجّة البَيْضَاء
`;

/**
 * @param {object} c
 * @param {string} c.id            MAH-XXXX-XXXX-XXXX
 * @param {string} c.studentName
 * @param {'male'|'female'|null} c.gender
 * @param {string} c.title
 * @param {string} c.date          issue date as printed on the certificate
 * @param {string} c.verifyUrl     the URL printed on the certificate
 * @param {string} c.downloadUrl   durable signed PDF link
 * @param {string} c.imageUrl      the preview image (cid: reference to the inline attachment)
 * @param {string} c.shareUrl      durable signed share page
 * @param {string} c.base          public base of this service (logo)
 */
export function certificateEmail(c) {
  const f = c.gender === 'female';
  const view = {
    id: c.id,
    title: c.title,
    date: c.date,
    verify_url: c.verifyUrl,
    download_url: c.downloadUrl,
    image_url: c.imageUrl,
    base: c.base.replace(/\/$/, ''),
    subject: `شهادتك في «${c.title}» — المَحجّة البَيْضَاء`,
    preheader: `${f ? 'صدرت شهادتكِ' : 'صدرت شهادتك'} في «${c.title}»، وهي جاهزة للتحميل والمشاركة.`,
    greeting: `بارك الله ${f ? 'لكِ' : 'لك'} يا ${c.studentName}`,
    body: f
      ? `أتممتِ بحمد الله دراسة «${c.title}»، وصدرت شهادتكِ من المَحجّة البَيْضَاء.`
      : `أتممتَ بحمد الله دراسة «${c.title}»، وصدرت شهادتك من المَحجّة البَيْضَاء.`,
    // Shared as the image itself (the phone's share sheet on /s/{id}), never as a link card.
    share_hint: f
      ? 'تفتح صفحة فيها صورة شهادتكِ، ومنها تشاركينها صورةً في واتساب أو فيسبوك أو غيرهما.'
      : 'تفتح صفحة فيها صورة شهادتك، ومنها تشاركها صورةً في واتساب أو فيسبوك أو غيرهما.',
    share_url: c.shareUrl,
    verify_label: c.verifyUrl.replace(/^https?:\/\//, ''),
    dua: f ? 'نسأل الله أن ينفعكِ بما تعلّمتِ، وأن يزيدكِ علمًا وهدًى.' : 'نسأل الله أن ينفعك بما تعلّمت، وأن يزيدك علمًا وهدًى.',
    download_page: 'https://almahajja.app/download',
  };
  return {
    subject: view.subject,
    html: Mustache.render(HTML, view),
    text: Mustache.render(TEXT, view, {}, { escape: (s) => s }),
  };
}
