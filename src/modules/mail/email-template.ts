import type { EmailContent, OutgoingEmail } from './mail.types';

// SVG logo. Gmail, Outlook, and Yahoo do not display SVG images in email and show the alt text
// instead; a PNG is available at logo-mark%402x.png in the same bucket.
const LOGO_URL = 'https://dayboard-cdn.s3.ap-south-1.amazonaws.com/logo-mark.svg';

// The app's palette and type: warm cream surfaces, a deep olive accent, Bricolage Grotesque for headings and Inter
// for text. Clients that block web fonts fall back to the system sans-serif.
const COLORS = {
  page: '#f4f2ec',
  card: '#fdfcf9',
  border: '#e5e2da',
  text: '#24231f',
  muted: '#716e66',
  faint: '#a19d94',
  primary: '#2c3528',
  onPrimary: '#fdfcf9',
};
const DISPLAY_FONT = "'Bricolage Grotesque','Inter',-apple-system,'Segoe UI',Arial,sans-serif";
const TEXT_FONT = "'Inter',-apple-system,'Segoe UI',Arial,sans-serif";
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Inter:wght@400;600&display=swap';

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export function renderEmail(to: string, content: EmailContent): OutgoingEmail {
  const subject = escapeHtml(content.subject);
  const ctaUrl = escapeHtml(content.ctaUrl);
  const body = content.paragraphs
    .map((paragraph) => `<p style="margin:0 0 12px;">${escapeHtml(paragraph)}</p>`)
    .join('');

  const c = COLORS;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${subject}</title>
  <link href="${FONTS_URL}" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${c.page};">
  <div style="display:none;max-height:0;overflow:hidden;color:${c.page};">${escapeHtml(content.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page};border-collapse:collapse;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;border-collapse:collapse;">
        <tr><td style="padding:0 8px 24px;">
          <a href="https://dayboard.space" style="color:${c.text};text-decoration:none;font-family:${DISPLAY_FONT};font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:40px;">
            <img src="${LOGO_URL}" width="40" height="40" alt="Dayboard" style="display:inline-block;vertical-align:middle;margin-right:12px;border:0;border-radius:12px;">Dayboard
          </a>
        </td></tr>
        <tr><td style="background:${c.card};border:1px solid ${c.border};border-radius:24px;padding:40px;box-shadow:0 1px 2px rgba(36,35,31,0.06),0 4px 14px -6px rgba(36,35,31,0.12);">
          <h1 style="margin:0 0 16px;font-family:${DISPLAY_FONT};font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.02em;color:${c.text};">${escapeHtml(content.heading)}</h1>
          <div style="font-family:${TEXT_FONT};font-size:15px;line-height:24px;color:${c.text};">${body}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;border-collapse:collapse;"><tr><td style="background:${c.primary};border-radius:12px;">
            <a href="${ctaUrl}" style="display:inline-block;padding:13px 24px;font-family:${TEXT_FONT};font-size:15px;font-weight:600;line-height:20px;color:${c.onPrimary};text-decoration:none;border-radius:12px;">${escapeHtml(content.ctaLabel)}</a>
          </td></tr></table>
          <p style="margin:24px 0 0;padding-top:20px;border-top:1px solid ${c.border};font-family:${TEXT_FONT};font-size:13px;line-height:20px;color:${c.muted};">If the button does not work, copy this link into your browser:<br><a href="${ctaUrl}" style="color:${c.primary};word-break:break-all;">${ctaUrl}</a></p>
        </td></tr>
        <tr><td style="padding:24px 8px 0;font-family:${TEXT_FONT};font-size:12px;line-height:18px;color:${c.faint};">${escapeHtml(content.footer)}<br><a href="https://dayboard.space" style="color:${c.muted};">dayboard.space</a></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((paragraph) => [paragraph, '']),
    content.ctaLabel,
    content.ctaUrl,
    '',
    content.footer,
    'dayboard.space',
  ].join('\n');

  return { to, subject: content.subject, html, text };
}
