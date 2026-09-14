import type { EmailContent, OutgoingEmail } from './mail.types';

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

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#fdfcf9;">
  <div style="display:none;max-height:0;overflow:hidden;color:#fdfcf9;">${escapeHtml(content.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfcf9;border-collapse:collapse;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;border-collapse:collapse;">
        <tr><td style="padding:0 4px 20px;">
          <a href="https://dayboard.space" style="color:#24231f;text-decoration:none;font-family:Georgia,serif;font-size:24px;line-height:40px;">
            <img src="https://dayboard.space/brand/logo-mark@2x.png" width="40" height="40" alt="Dayboard" style="display:inline-block;vertical-align:middle;margin-right:12px;border:0;border-radius:10px;">Dayboard
          </a>
        </td></tr>
        <tr><td style="background:#fff;border:1px solid #e5e2da;border-radius:16px;padding:36px 40px;">
          <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;line-height:32px;font-weight:400;color:#24231f;">${escapeHtml(content.heading)}</h1>
          <div style="font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#24231f;">${body}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;border-collapse:collapse;"><tr><td style="background:#2c3528;border-radius:12px;">
            <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;font-family:Arial,sans-serif;font-size:15px;font-weight:500;line-height:20px;color:#fff;text-decoration:none;border-radius:12px;">${escapeHtml(content.ctaLabel)}</a>
          </td></tr></table>
          <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#716e66;">If the button does not work, copy this link into your browser:<br><a href="${ctaUrl}" style="color:#716e66;word-break:break-all;">${ctaUrl}</a></p>
        </td></tr>
        <tr><td style="padding:20px 8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#716e66;">${escapeHtml(content.footer)}<br><a href="https://dayboard.space" style="color:#716e66;">dayboard.space</a></td></tr>
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
