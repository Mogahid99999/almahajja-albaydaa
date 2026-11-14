// almahajja-certs: renders issued certificates and serves the public verification page.
// One instance per environment; the environment is only its env vars.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { readFont, renderCertificate } from './render.mjs';
import { CERTIFICATE_ID_RE, STORE_BADGES, verificationPage } from './verify-page.mjs';
import { RateLimiter } from './rate-limit.mjs';
import { contentType, readStoredFile, removeFile, saveFile, validLink } from './storage.mjs';
import { certificateEmail, emailLinkSig, shareCaption, validEmailLink } from './email.mjs';
import { SHARE_JS, sharePage } from './share-page.mjs';
import { formatIssueDate } from './dates.mjs';

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const SUPABASE_URL = need('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = need('SUPABASE_SERVICE_ROLE_KEY');
const FILES_DIR = need('FILES_DIR');
const FILES_SECRET = need('FILES_SECRET');
const PORT = Number(process.env.PORT || 8080);
const POLL_MS = Number(process.env.POLL_MS || 10000);
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
// Certificate emails: off unless the public base is set. The Resend key stays an Edge Function
// secret (send-certificate-email); this service only builds the message.
const PUBLIC_BASE = (process.env.PUBLIC_BASE || '').replace(/\/$/, '');
const EMAIL_FUNCTION = process.env.EMAIL_FUNCTION_URL || `${SUPABASE_URL}/functions/v1/send-certificate-email`;
const LOGO_PNG = await fs.readFile(new URL('../assets/email-logo.png', import.meta.url));

async function rpc(name, args = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const templates = new Map();   // published versions are immutable, so this never goes stale
async function template(version) {
  if (!templates.has(version)) {
    const html = await rpc('get_certificate_template', { p_version: version });
    if (!html) throw new Error(`template ${version} not found`);
    templates.set(version, html);
  }
  return templates.get(version);
}

let browser = null;
async function getBrowser() {
  if (!browser?.isConnected()) {
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  }
  return browser;
}

async function renderOne(cert) {
  try {
    const out = await renderCertificate(await getBrowser(), await template(cert.template_version), cert);
    if (out.layout && !out.layout.ok) throw new Error(`layout: ${JSON.stringify(out.layout)}`);
    const token = randomUUID();   // never derived from the public certificate id
    const pdfKey = `certificates/${token}.pdf`;
    const previewKey = `certificates/${token}.jpg`;
    await saveFile(FILES_DIR, pdfKey, out.pdf);
    await saveFile(FILES_DIR, previewKey, out.preview);
    await rpc('complete_certificate_render', { p_id: cert.id, p_pdf_key: pdfKey, p_preview_key: previewKey, p_issue_date_text: out.issueDateText });
    console.log('rendered', cert.id, Math.round(out.pdf.length / 1024), 'KB');
  } catch (e) {
    console.error('render failed', cert.id, e.message);
    await rpc('fail_certificate_render', { p_id: cert.id, p_error: String(e.message) }).catch(() => {});
  }
}

async function emailOne(m) {
  try {
    const s = m.snapshot ?? {};
    const [pdf, preview] = await Promise.all([readStoredFile(FILES_DIR, m.pdf_key), readStoredFile(FILES_DIR, m.preview_key)]);
    if (!pdf || !preview) throw new Error('files missing');
    const link = (kind, purpose) => `${PUBLIC_BASE}/${kind}/${m.id}?sig=${emailLinkSig(FILES_SECRET, purpose, m.id)}`;
    const e = certificateEmail({
      id: m.id, studentName: s.student_name, gender: s.gender, title: s.title,
      date: m.issue_date_text || formatIssueDate(m.issued_at), verifyUrl: s.verification_url,
      downloadUrl: link('d', 'download'), shareUrl: link('s', 'share'),
      imageUrl: 'cid:certificate-preview', base: PUBLIC_BASE,
    });
    const r = await fetch(EMAIL_FUNCTION, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: m.email, subject: e.subject, html: e.html.replace(/src="[^"]*email-logo\.png"/, 'src="cid:almahajja-logo"'), text: e.text,
        idempotency_key: `certificate-email/${m.id}`,
        attachments: [
          { filename: `certificate-${m.id}.pdf`, content: pdf.toString('base64') },
          { filename: `certificate-${m.id}.jpg`, content: preview.toString('base64'), content_id: 'certificate-preview' },
          { filename: 'almahajja.png', content: LOGO_PNG.toString('base64'), content_id: 'almahajja-logo' },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`send ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await rpc('complete_certificate_email', { p_id: m.id, p_error: null });
    console.log('emailed', m.id);
  } catch (e) {
    console.error('email failed', m.id, e.message);
    await rpc('complete_certificate_email', { p_id: m.id, p_error: String(e.message) }).catch(() => {});
  }
}

let stopping = false;
async function tick() {
  const claimed = await rpc('claim_certificate_renders', { p_limit: 3 });
  for (const cert of claimed ?? []) await renderOne(cert);
  if (PUBLIC_BASE) {
    const mails = await rpc('claim_certificate_emails', { p_limit: 5 });
    for (const m of mails ?? []) await emailOne(m);
  }
  const gone = await rpc('take_void_certificate_files', { p_limit: 20 });
  for (const f of gone ?? []) {
    for (const key of [f.pdf_key, f.preview_key]) {
      if (key) await removeFile(FILES_DIR, key).catch((e) => console.error('delete failed', e.message));
    }
  }
  return (claimed ?? []).length;
}
async function loop() {
  while (!stopping) {
    let busy = 0;
    try { busy = await tick(); } catch (e) { console.error('tick', e.message); }
    if (!busy) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const limiter = new RateLimiter(Number(process.env.VERIFY_PER_MINUTE || 30), 60000);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'",
    ...headers,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '');
    if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });

    const font = url.pathname.match(/^\/fonts\/([^/]+)\/([^/]+)$/);
    if (font) {
      const body = await readFont(font[1], font[2]);
      if (!body) return send(res, 404, '');
      return send(res, 200, body, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    const asset = STORE_BADGES[url.pathname];
    if (asset) {
      return send(res, 200, await fs.readFile(new URL(`../assets/${asset.file}`, import.meta.url)), {
        'Content-Type': asset.type,
        'Cache-Control': 'public, max-age=604800',
      });
    }

    if (url.pathname === '/assets/share.js') {
      return send(res, 200, SHARE_JS, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    }

    // Durable links from the certificate email: /d/{id} (PDF), /s/{id} (share page), /s/{id}/image.
    const em = url.pathname.match(/^\/(d|s)\/([^/]+?)(\/image)?\/?$/);
    if (em && !(em[1] === 'd' && em[3])) {
      const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
      if (!limiter.allow(ip)) return send(res, 429, verificationPage(null), { 'Retry-After': '60' });
      let id = '';
      try { id = decodeURIComponent(em[2]).toUpperCase(); } catch { /* malformed */ }
      const purpose = em[1] === 'd' ? 'download' : 'share';
      if (!CERTIFICATE_ID_RE.test(id) || !validEmailLink(FILES_SECRET, purpose, id, url.searchParams.get('sig'))) {
        return send(res, 403, '', { 'Content-Type': 'text/plain' });
      }
      const f = await rpc('certificate_email_files', { p_id: id });
      if (!f) return send(res, 410, verificationPage({ status: 'revoked' }));   // revoked or void
      if (em[1] === 'd' || em[3]) {
        const key = em[1] === 'd' ? f.pdf_key : f.preview_key;
        const body = await readStoredFile(FILES_DIR, key);
        if (!body) return send(res, 404, '', { 'Content-Type': 'text/plain' });
        const name = `certificate-${id}.${em[1] === 'd' ? 'pdf' : 'jpg'}`;
        const attach = em[1] === 'd' || url.searchParams.get('save') === '1';
        return send(res, 200, body, {
          'Content-Type': contentType(key),
          'Cache-Control': 'private, max-age=300',
          'Content-Disposition': `${attach ? 'attachment' : 'inline'}; filename="${name}"`,
        });
      }
      return send(res, 200, sharePage({ id, sig: url.searchParams.get('sig'), title: f.title, caption: shareCaption(f.title) }), {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'",
      });
    }

    if (url.pathname.startsWith('/files/')) {
      const key = url.pathname.slice('/files/'.length);
      const name = url.searchParams.get('name') ?? '';
      if (!validLink(FILES_SECRET, key, url.searchParams.get('exp') ?? '', name, url.searchParams.get('sig'))) {
        return send(res, 403, '', { 'Content-Type': 'text/plain' });
      }
      const body = await readStoredFile(FILES_DIR, key);
      if (!body) return send(res, 404, '', { 'Content-Type': 'text/plain' });
      return send(res, 200, body, {
        'Content-Type': contentType(key),
        ...(name ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}),
      });
    }

    const m = url.pathname.match(/^\/c\/([^/]+)\/?$/);
    const page = (result) => verificationPage(result, { userAgent: req.headers['user-agent'] });
    if (!m) return send(res, 404, page(null));

    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');
    if (!limiter.allow(ip)) return send(res, 429, page(null), { 'Retry-After': '60' });

    let id = '';
    try { id = decodeURIComponent(m[1]).toUpperCase(); } catch { /* malformed: not found */ }
    if (!CERTIFICATE_ID_RE.test(id)) return send(res, 404, page(null));

    const result = await rpc('verify_certificate', { p_id: id });
    return send(res, result ? 200 : 404, page(result));
  } catch (e) {
    console.error('request', e.message);
    return send(res, 503, verificationPage(null));
  }
});

server.listen(PORT, () => console.log('almahajja-certs listening', PORT));
loop();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    stopping = true;
    server.close();
    await browser?.close().catch(() => {});
    process.exit(0);
  });
}
