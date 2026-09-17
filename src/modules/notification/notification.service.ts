import { eq } from 'drizzle-orm';
import type { RuntimeContext } from '../../core/runtime/runtime-context';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import {
  memberships,
  notificationPreferences,
  projects,
  users,
  type Task,
} from '../../database/schema';
import type { AuthActor } from '../auth/auth.types';
import { renderMentionsAsText } from '../comment/mentions';
import type { MailService } from '../mail/mail.service';
import type { RateLimitService } from '../security/rate-limit.service';

const EXCERPT_LENGTH = 300;

export interface Preferences {
  emailAssigned: boolean;
  emailComments: boolean;
  emailMentions: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  emailAssigned: true,
  emailComments: true,
  emailMentions: true,
};

interface Member extends Preferences {
  id: string;
  email: string;
  name: string;
  verified: boolean;
}

/**
 * Sends task notification emails. Every public trigger returns immediately; recipients are resolved
 * and emails sent in the background so a slow SMTP server never delays the request.
 *
 * Rules shared by all triggers: never email the person who acted, only email current org members
 * with a verified email, respect their preferences, and send at most a few emails per recipient per
 * task per minute.
 */
export class NotificationService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly runtime: RuntimeContext,
  ) {}

  async getPreferences(actor: AuthActor): Promise<Preferences> {
    const row = await this.db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, actor.user.id),
    });
    if (!row) return { ...DEFAULT_PREFERENCES };
    return {
      emailAssigned: row.emailAssigned,
      emailComments: row.emailComments,
      emailMentions: row.emailMentions,
    };
  }

  async updatePreferences(actor: AuthActor, patch: Partial<Preferences>): Promise<Preferences> {
    const timestamp = now();
    await this.db
      .insert(notificationPreferences)
      .values({ userId: actor.user.id, ...DEFAULT_PREFERENCES, ...patch, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...patch, updatedAt: timestamp },
      });
    return this.getPreferences(actor);
  }

  /** Emails the new assignee when a task is created with, or changed to, someone else. */
  taskAssigned(actor: AuthActor, task: Task, previousAssigneeId: string | null): void {
    const assigneeId = task.assigneeId;
    if (!assigneeId || assigneeId === previousAssigneeId || assigneeId === actor.user.id) return;
    this.dispatch(async () => {
      const context = await this.loadContext(task.projectId);
      if (!context) return;
      const recipient = context.members.get(assigneeId);
      if (!recipient?.emailAssigned || !(await this.canEmail(recipient, task.id))) return;
      this.mail.sendTaskAssigned({
        to: recipient.email,
        assigner: actor.user.name,
        taskTitle: task.title,
        projectName: context.projectName,
        dueDate: task.dueDate,
        orgId: context.orgId,
      });
    });
  }

  /**
   * Emails people about a new or edited comment. Newly mentioned people get a mention email. On a
   * new comment, the task's assignee gets a comment email unless they were already emailed about
   * the mention. Each person gets at most one email per comment.
   */
  commentPosted(input: {
    actor: AuthActor;
    task: Task;
    body: string;
    newlyMentionedUserIds: string[];
    isNew: boolean;
  }): void {
    const { actor, task } = input;
    const mentioned = new Set(input.newlyMentionedUserIds.filter((id) => id !== actor.user.id));
    const assigneeId =
      input.isNew && task.assigneeId && task.assigneeId !== actor.user.id ? task.assigneeId : null;
    if (mentioned.size === 0 && !assigneeId) return;

    this.dispatch(async () => {
      const context = await this.loadContext(task.projectId);
      if (!context) return;
      const names = new Map(
        [...context.members.values()].map((member) => [member.id, member.name]),
      );
      const text = renderMentionsAsText(input.body, names);
      const excerpt = text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;

      const recipientIds = new Set([...mentioned, ...(assigneeId ? [assigneeId] : [])]);
      for (const recipientId of recipientIds) {
        const recipient = context.members.get(recipientId);
        if (!recipient) continue;
        const kind =
          mentioned.has(recipientId) && recipient.emailMentions
            ? 'mention'
            : recipientId === assigneeId && recipient.emailComments
              ? 'comment'
              : null;
        if (!kind || !(await this.canEmail(recipient, task.id))) continue;
        this.mail.sendTaskComment({
          to: recipient.email,
          kind,
          author: actor.user.name,
          taskTitle: task.title,
          projectName: context.projectName,
          excerpt,
          orgId: context.orgId,
        });
      }
    });
  }

  private dispatch(work: () => Promise<void>): void {
    const delivery = work().catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: 'notification failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    this.runtime.executionCtx.waitUntil(delivery);
  }

  private async canEmail(recipient: Member, taskId: string): Promise<boolean> {
    if (!recipient.verified) return false;
    try {
      await this.rateLimit.check('email', `notify:${recipient.id}:${taskId}`);
      return true;
    } catch {
      return false;
    }
  }

  /** Loads the project and every current org member with their preferences (at most 100 rows). */
  private async loadContext(projectId: string) {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project || project.deletedAt) return null;
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
        deletedAt: users.deletedAt,
        emailAssigned: notificationPreferences.emailAssigned,
        emailComments: notificationPreferences.emailComments,
        emailMentions: notificationPreferences.emailMentions,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
      .where(eq(memberships.orgId, project.orgId));
    const members = new Map<string, Member>();
    for (const row of rows) {
      if (row.deletedAt) continue;
      members.set(row.id, {
        id: row.id,
        email: row.email,
        name: row.name,
        verified: Boolean(row.emailVerifiedAt),
        emailAssigned: row.emailAssigned ?? DEFAULT_PREFERENCES.emailAssigned,
        emailComments: row.emailComments ?? DEFAULT_PREFERENCES.emailComments,
        emailMentions: row.emailMentions ?? DEFAULT_PREFERENCES.emailMentions,
      });
    }
    return { projectName: project.name, orgId: project.orgId, members };
  }
}
