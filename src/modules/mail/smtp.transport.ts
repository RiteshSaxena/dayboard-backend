import { LogLevel, WorkerMailer, type User } from 'worker-mailer';
import type { RuntimeContext } from '../../core/runtime/runtime-context';
import type { OutgoingEmail } from './mail.types';

// worker-mailer uses a string address verbatim in MAIL FROM, so "Name <address>" must be split.
function parseMailbox(value: string): User {
  const match = value.trim().match(/^(.*?)\s*<([^<>\s]+)>$/);
  if (!match?.[2]) return { email: value.trim() };
  const name = match[1]?.trim().replace(/^"(.*)"$/, '$1');
  return name ? { name, email: match[2] } : { email: match[2] };
}

export class SmtpTransport {
  constructor(private readonly runtime: RuntimeContext) {}

  async send(email: OutgoingEmail): Promise<void> {
    const { env } = this.runtime;
    const security: string = env.SMTP_SECURITY;

    await WorkerMailer.send(
      {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT),
        secure: security === 'tls',
        startTls: security === 'starttls',
        credentials: {
          username: env.SMTP_USERNAME,
          password: env.SMTP_PASSWORD,
        },
        authType: ['plain', 'login'],
        logLevel: LogLevel.ERROR,
        socketTimeoutMs: 15_000,
        responseTimeoutMs: 15_000,
      },
      {
        from: parseMailbox(env.EMAIL_FROM),
        reply: parseMailbox(env.EMAIL_REPLY_TO),
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
    );
  }
}
