import type { RuntimeContext } from '../../core/runtime/runtime-context';
import { renderEmail } from './email-template';
import { SmtpTransport } from './smtp.transport';

const NOTIFICATION_FOOTER =
  'You received this because of activity on a Dayboard task. You can turn these emails off in your notification settings.';

export class MailService {
  private readonly transport: SmtpTransport;

  constructor(private readonly runtime: RuntimeContext) {
    this.transport = new SmtpTransport(runtime);
  }

  sendVerification(input: { name: string; email: string; token: string }): void {
    const email = renderEmail(input.email, {
      subject: 'Confirm your email for Dayboard',
      preheader: 'Confirm your email to finish setting up Dayboard.',
      heading: 'Confirm your email',
      paragraphs: [
        `${input.name}, confirm that ${input.email} is yours and your board is ready to sync.`,
      ],
      ctaLabel: 'Confirm email',
      ctaUrl: `${this.runtime.env.APP_URL}/verify/${encodeURIComponent(input.token)}`,
      footer:
        'This link works for 24 hours. If you did not create a Dayboard account, you can ignore this email.',
    });
    this.schedule(email);
  }

  sendReset(input: { email: string; token: string }): void {
    const email = renderEmail(input.email, {
      subject: 'Reset your Dayboard password',
      preheader: 'Use this link to choose a new password.',
      heading: 'Reset your password',
      paragraphs: [`We received a request to reset the password for ${input.email}.`],
      ctaLabel: 'Choose a new password',
      ctaUrl: `${this.runtime.env.APP_URL}/reset/${encodeURIComponent(input.token)}`,
      footer:
        'This link works for one hour and can be used once. If you did not ask for this, your password is unchanged and you can ignore this email.',
    });
    this.schedule(email);
  }

  sendPasswordChanged(input: { email: string; date: string; browser: string; city: string }): void {
    const email = renderEmail(input.email, {
      subject: 'Your Dayboard password was changed',
      preheader: 'Your Dayboard password was changed.',
      heading: 'Your password was changed',
      paragraphs: [
        `The password for ${input.email} was changed on ${input.date} from ${input.browser} in ${input.city}. Other devices have been signed out.`,
        'If this was you, there is nothing to do. If it was not, reset your password now and reply to this email so we can help.',
      ],
      ctaLabel: 'Secure my account',
      ctaUrl: `${this.runtime.env.APP_URL}/forgot-password`,
      footer: 'You received this security notice because your Dayboard password changed.',
    });
    this.schedule(email);
  }

  sendInvite(input: {
    email: string;
    inviter: string;
    inviterEmail: string;
    org: string;
    role: string;
    token: string;
  }): void {
    const article = this.roleArticle(input.role);
    const email = renderEmail(input.email, {
      subject: `${input.inviter} invited you to ${input.org} on Dayboard`,
      preheader: `Join ${input.org} on Dayboard.`,
      heading: `${input.inviter} invited you to ${input.org}`,
      paragraphs: [
        `${input.inviter} (${input.inviterEmail}) added you as ${article} of ${input.org}. Accept to see the team's projects, tasks, and notes.`,
      ],
      ctaLabel: `Join ${input.org}`,
      ctaUrl: `${this.runtime.env.APP_URL}/invite/${encodeURIComponent(input.token)}`,
      footer:
        'The invitation expires in 7 days. If you were not expecting it, you can ignore this email.',
    });
    this.schedule(email);
  }

  sendMemberJoined(input: {
    to: string;
    name: string;
    email: string;
    org: string;
    role: string;
    orgId: string;
  }): void {
    const article = this.roleArticle(input.role);
    const email = renderEmail(input.to, {
      subject: `${input.name} joined ${input.org}`,
      preheader: `${input.name} accepted your invitation.`,
      heading: `${input.name} joined ${input.org}`,
      paragraphs: [
        `${input.name} (${input.email}) accepted your invitation and is now ${article}.`,
      ],
      ctaLabel: `Open ${input.org}`,
      ctaUrl: `${this.runtime.env.APP_URL}/orgs/${input.orgId}`,
      footer: `You received this because you invited someone to ${input.org}.`,
    });
    this.schedule(email);
  }

  sendWelcome(input: { email: string; name: string }): void {
    const email = renderEmail(input.email, {
      subject: 'Welcome to Dayboard',
      preheader: 'Your Dayboard is ready.',
      heading: 'Your board is ready',
      paragraphs: [
        `${input.name}, your email is confirmed.`,
        'Type a task and press Enter. Words like "tomorrow" or "fri" become due dates, and #project files it.',
        'Notes live beside the board, save as you type, and can be pinned.',
        'Create an org from the sidebar to invite people and share projects.',
      ],
      ctaLabel: 'Open Dayboard',
      ctaUrl: this.runtime.env.APP_URL,
      footer: 'You received this because you confirmed your Dayboard account.',
    });
    this.schedule(email);
  }

  sendTaskAssigned(input: {
    to: string;
    assigner: string;
    taskTitle: string;
    projectName: string;
    dueDate: string | null;
    orgId: string;
  }): void {
    const title = this.shortTitle(input.taskTitle);
    const email = renderEmail(input.to, {
      subject: `${input.assigner} assigned you "${title}"`,
      preheader: `${input.assigner} assigned you a task in ${input.projectName}.`,
      heading: `${input.assigner} assigned you a task`,
      paragraphs: [
        `"${input.taskTitle}" in ${input.projectName}.`,
        ...(input.dueDate ? [`It is due on ${input.dueDate}.`] : []),
      ],
      ctaLabel: 'Open board',
      ctaUrl: `${this.runtime.env.APP_URL}/orgs/${input.orgId}`,
      footer: NOTIFICATION_FOOTER,
    });
    this.schedule(email);
  }

  sendTaskComment(input: {
    to: string;
    kind: 'mention' | 'comment';
    author: string;
    taskTitle: string;
    projectName: string;
    excerpt: string;
    orgId: string;
  }): void {
    const title = this.shortTitle(input.taskTitle);
    const action = input.kind === 'mention' ? 'mentioned you on' : 'commented on';
    const email = renderEmail(input.to, {
      subject: `${input.author} ${action} "${title}"`,
      preheader: input.excerpt,
      heading: `${input.author} ${action} a task`,
      paragraphs: [`On "${input.taskTitle}" in ${input.projectName}:`, input.excerpt],
      ctaLabel: 'Open board',
      ctaUrl: `${this.runtime.env.APP_URL}/orgs/${input.orgId}`,
      footer: NOTIFICATION_FOOTER,
    });
    this.schedule(email);
  }

  private shortTitle(title: string): string {
    return title.length > 80 ? `${title.slice(0, 79)}…` : title;
  }

  private schedule(email: ReturnType<typeof renderEmail>): void {
    const delivery = this.transport.send(email).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: 'email send failed',
          recipient: email.to,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    this.runtime.executionCtx.waitUntil(delivery);
  }

  private roleArticle(role: string): string {
    if (role === 'admin') return 'an admin';
    if (role === 'guest') return 'a guest';
    return 'a member';
  }
}
