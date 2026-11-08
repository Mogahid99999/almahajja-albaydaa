// Turns one certificate (template version + snapshot) into a PDF and a preview image.
// All layout decisions live in the template (including its shrink-to-fit script), so
// a new design is a new template row, not a new build.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import Mustache from 'mustache';
import QRCode from 'qrcode';
import { formatIssueDate } from './dates.mjs';

const require = createRequire(import.meta.url);
const ORIGIN = 'http://certificate.local';

// /fonts/<package>/<file> → node_modules/@fontsource/<package>/files/<file>
export async function readFont(pkg, file) {
  if (!/^[a-z0-9-]+$/.test(pkg) || !/^[a-z0-9-]+\.woff2$/.test(file)) return null;
  try {
    const dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`));
    return await fs.readFile(path.join(dir, 'files', file));
  } catch {
    return null;
  }
}

export async function buildView(cert) {
  const s = cert.snapshot;
  const url = s.verification_url;
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#16352f', light: '#0000' } });
  return {
    student_name: s.student_name,
    is_female: s.gender === 'female',
    title: s.title,
    author_line: s.author_line,
    presenter_line: s.presenter_line,
    custom_text: s.custom_text,
    certificate_id: cert.id,
    issue_date_text: formatIssueDate(cert.issued_at),
    verification_url: url,
    verification_url_display: url.replace(/^https?:\/\//, ''),
    qr_svg: qr,
  };
}

export function fillTemplate(html, view) {
  return Mustache.render(html, view);   // {{x}} is HTML-escaped; only {{{qr_svg}}} is raw
}

export async function renderCertificate(browser, templateHtml, cert) {
  const view = await buildView(cert);
  const html = fillTemplate(templateHtml, view);
  const context = await browser.newContext({
    viewport: { width: 1123, height: 794 },
    deviceScaleFactor: 2,
    javaScriptEnabled: true,
  });
  try {
    const page = await context.newPage();
    // Nothing leaves the renderer: only the page itself and bundled fonts are served.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === `${ORIGIN}/`) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      if (url.startsWith('data:')) return route.continue();
      const m = url.match(/^http:\/\/certificate\.local\/fonts\/([^/]+)\/([^/?#]+)$/);
      if (m) {
        const body = await readFont(m[1], m[2]);
        if (body) return route.fulfill({ contentType: 'font/woff2', body });
      }
      return route.abort();
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
    await page.waitForFunction('window.__certificateReady === true', null, { timeout: 20000 });
    const preview = await page.screenshot({ type: 'jpeg', quality: 88, fullPage: false });
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
    const layout = await page.evaluate(() => window.__certificateLayout || null);
    return { pdf, preview, issueDateText: view.issue_date_text, layout };
  } finally {
    await context.close();
  }
}
