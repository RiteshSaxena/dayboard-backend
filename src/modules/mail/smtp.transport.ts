import { LogLevel, WorkerMailer } from "worker-mailer";
import type { RuntimeContext } from "../../core/runtime/runtime-context";
import type { OutgoingEmail } from "./mail.types";

export class SmtpTransport {
  constructor(private readonly runtime: RuntimeContext) {}

  async send(email: OutgoingEmail): Promise<void> {
    const { env } = this.runtime;
    const security: string = env.SMTP_SECURITY;

    await WorkerMailer.send(
      {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT),
        secure: security === "tls",
        startTls: security === "starttls",
        credentials: {
          username: env.SMTP_USERNAME,
          password: env.SMTP_PASSWORD,
        },
        authType: ["plain", "login"],
        logLevel: LogLevel.ERROR,
        socketTimeoutMs: 15_000,
        responseTimeoutMs: 15_000,
      },
      {
        from: env.EMAIL_FROM,
        reply: env.EMAIL_REPLY_TO,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
    );
  }
}
