import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
} from 'drizzle-orm';
import { badRequest, forbidden, notFound } from '../../core/http/api-error';
import { makeTimeCursor, parseTimeCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import {
  commentMentions,
  comments,
  memberships,
  projects,
  tasks,
  users,
} from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { NotificationService } from '../notification/notification.service';
import { MAX_MENTIONS, parseMentions } from './mentions';

const PAGE_SIZE = 100;
const MENTIONS_PAGE_SIZE = 50;
const EXCERPT_LENGTH = 200;

type CommentRow = Awaited<ReturnType<CommentService['selectComments']>>[number];

export class CommentService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
  ) {}

  async list(actor: AuthActor, taskId: string, rawCursor?: string) {
    await this.authorization.requireTask(actor, taskId);
    const cursor = parseTimeCursor(rawCursor);
    const conditions: SQL[] = [eq(comments.taskId, taskId), isNull(comments.deletedAt)];
    if (cursor)
      conditions.push(
        or(
          gt(comments.createdAt, cursor.createdAt),
          and(eq(comments.createdAt, cursor.createdAt), gt(comments.id, cursor.id)),
        )!,
      );
    const rows = await this.selectComments()
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(PAGE_SIZE + 1);
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    return {
      items: await this.withMentions(taskId, items),
      cursor: hasMore ? makeTimeCursor(items.at(-1)) : null,
    };
  }

  async create(actor: AuthActor, taskId: string, body: string) {
    const { task, project } = await this.authorization.requireTask(actor, taskId, 'member');
    const mentionedUserIds = await this.resolveMentions(project.orgId, body);
    const timestamp = now();
    const comment = {
      id: createId(),
      taskId,
      authorId: actor.user.id,
      body,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.batch([
      this.db.insert(comments).values(comment),
      ...this.mentionInserts(comment.id, mentionedUserIds),
    ]);
    await this.activity.record({
      orgId: project.orgId,
      projectId: task.projectId,
      taskId,
      actorId: actor.user.id,
      kind: 'comment.created',
      payload: {
        commentId: comment.id,
        taskId,
        excerpt: body.slice(0, EXCERPT_LENGTH),
        mentionedUserIds,
      },
    });
    this.notifications.commentPosted({
      actor,
      task,
      body,
      newlyMentionedUserIds: mentionedUserIds,
      isNew: true,
    });
    return this.findComment(comment.id);
  }

  async update(actor: AuthActor, id: string, body: string) {
    const { comment, task, project } = await this.authorization.requireComment(actor, id, 'member');
    if (comment.authorId !== actor.user.id) {
      throw forbidden('Only the author can edit this comment');
    }
    const mentionedUserIds = await this.resolveMentions(project.orgId, body);
    const previous = await this.db
      .select({ userId: commentMentions.userId })
      .from(commentMentions)
      .where(eq(commentMentions.commentId, id));
    await this.db.batch([
      this.db.update(comments).set({ body, updatedAt: now() }).where(eq(comments.id, id)),
      this.db.delete(commentMentions).where(eq(commentMentions.commentId, id)),
      ...this.mentionInserts(id, mentionedUserIds),
    ]);
    // Only people who were not already mentioned hear about an edit.
    const alreadyMentioned = new Set(previous.map((row) => row.userId));
    this.notifications.commentPosted({
      actor,
      task,
      body,
      newlyMentionedUserIds: mentionedUserIds.filter((userId) => !alreadyMentioned.has(userId)),
      isNew: false,
    });
    return this.findComment(id);
  }

  /** Authors can delete their own comments; admins and owners can delete any comment. */
  async remove(actor: AuthActor, id: string): Promise<void> {
    const { comment, task, project, membership } = await this.authorization.requireComment(
      actor,
      id,
    );
    const isModerator = membership.role === 'owner' || membership.role === 'admin';
    if (comment.authorId !== actor.user.id && !isModerator) throw forbidden();
    const timestamp = now();
    await this.db
      .update(comments)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(eq(comments.id, id));
    await this.activity.record({
      orgId: project.orgId,
      projectId: task.projectId,
      taskId: task.id,
      actorId: actor.user.id,
      kind: 'comment.deleted',
      payload: { commentId: id, taskId: task.id },
    });
  }

  /**
   * Comments that mention the caller, newest first, across every org they still belong to.
   * Excludes the caller's own comments and anything deleted.
   */
  async mentionsFor(actor: AuthActor, rawCursor?: string, orgId?: string) {
    const cursor = parseTimeCursor(rawCursor);
    const conditions: SQL[] = [
      eq(commentMentions.userId, actor.user.id),
      ne(comments.authorId, actor.user.id),
      isNull(comments.deletedAt),
      isNull(tasks.deletedAt),
      isNull(projects.deletedAt),
    ];
    if (orgId) conditions.push(eq(projects.orgId, orgId));
    if (cursor)
      conditions.push(
        or(
          lt(comments.createdAt, cursor.createdAt),
          and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.id)),
        )!,
      );
    const rows = await this.db
      .select({
        comment: {
          id: comments.id,
          taskId: comments.taskId,
          body: comments.body,
          createdAt: comments.createdAt,
          updatedAt: comments.updatedAt,
        },
        author: { id: users.id, name: users.name, avatarUrl: users.avatarUrl },
        task: {
          id: tasks.id,
          title: tasks.title,
          projectId: tasks.projectId,
          parentId: tasks.parentId,
        },
        project: { id: projects.id, name: projects.name, orgId: projects.orgId },
      })
      .from(commentMentions)
      .innerJoin(comments, eq(commentMentions.commentId, comments.id))
      .innerJoin(tasks, eq(comments.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(
        memberships,
        and(eq(memberships.orgId, projects.orgId), eq(memberships.userId, commentMentions.userId)),
      )
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(MENTIONS_PAGE_SIZE + 1);
    const hasMore = rows.length > MENTIONS_PAGE_SIZE;
    const items = rows.slice(0, MENTIONS_PAGE_SIZE).map((row) => ({
      comment: { ...row.comment, author: row.author },
      task: row.task,
      project: row.project,
    }));
    return { items, cursor: hasMore ? makeTimeCursor(items.at(-1)?.comment) : null };
  }

  /** Mentioned people must be current org members, and a comment can mention at most 20. */
  private async resolveMentions(orgId: string, body: string): Promise<string[]> {
    const userIds = parseMentions(body);
    if (userIds.length > MAX_MENTIONS) {
      throw badRequest(`A comment can mention at most ${MAX_MENTIONS} people`, 'body');
    }
    if (userIds.length === 0) return [];
    const memberRows = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, userIds)));
    const memberIds = new Set(memberRows.map((row) => row.userId));
    if (userIds.some((userId) => !memberIds.has(userId))) {
      throw badRequest('Mentioned people must be members of this organization', 'body');
    }
    return userIds;
  }

  // At most 20 rows of two columns, so one insert stays under D1's 100 bound-parameter limit.
  private mentionInserts(commentId: string, userIds: string[]) {
    return userIds.length === 0
      ? []
      : [this.db.insert(commentMentions).values(userIds.map((userId) => ({ commentId, userId })))];
  }

  /** Adds `mentions`: the mentioned people who are still members, in body order. */
  private async withMentions(taskId: string, items: CommentRow[]) {
    const [first] = items;
    const last = items.at(-1);
    if (!first || !last) return [];
    // Filter by the page's time range rather than an `IN (...)` list of comment IDs.
    const rows = await this.db
      .select({
        commentId: commentMentions.commentId,
        user: { id: users.id, name: users.name, avatarUrl: users.avatarUrl },
      })
      .from(commentMentions)
      .innerJoin(comments, eq(commentMentions.commentId, comments.id))
      .innerJoin(users, eq(commentMentions.userId, users.id))
      .where(
        and(
          eq(comments.taskId, taskId),
          gte(comments.createdAt, Math.min(first.createdAt, last.createdAt)),
          lte(comments.createdAt, Math.max(first.createdAt, last.createdAt)),
        ),
      );
    const byComment = new Map<string, Map<string, (typeof rows)[number]['user']>>();
    for (const row of rows) {
      const people = byComment.get(row.commentId) ?? new Map();
      people.set(row.user.id, row.user);
      byComment.set(row.commentId, people);
    }
    return items.map((item) => {
      const people = byComment.get(item.id);
      return {
        ...item,
        mentions: parseMentions(item.body).flatMap((userId) => {
          const person = people?.get(userId);
          return person ? [person] : [];
        }),
      };
    });
  }

  private selectComments() {
    return this.db
      .select({
        id: comments.id,
        taskId: comments.taskId,
        body: comments.body,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        author: { id: users.id, name: users.name, avatarUrl: users.avatarUrl },
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id));
  }

  private async findComment(id: string) {
    const [row] = await this.selectComments().where(eq(comments.id, id)).limit(1);
    if (!row) throw notFound('Comment');
    const [withMentions] = await this.withMentions(row.taskId, [row]);
    if (!withMentions) throw notFound('Comment');
    return withMentions;
  }
}
