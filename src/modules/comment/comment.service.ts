import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { forbidden, notFound } from '../../core/http/api-error';
import { makeTimeCursor, parseTimeCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { comments, users } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

const PAGE_SIZE = 100;
const EXCERPT_LENGTH = 200;

export class CommentService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
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
    return { items, cursor: hasMore ? makeTimeCursor(items.at(-1)) : null };
  }

  async create(actor: AuthActor, taskId: string, body: string) {
    const { task, project } = await this.authorization.requireTask(actor, taskId, 'member');
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
    await this.db.insert(comments).values(comment);
    await this.activity.record({
      orgId: project.orgId,
      projectId: task.projectId,
      taskId,
      actorId: actor.user.id,
      kind: 'comment.created',
      payload: { commentId: comment.id, taskId, excerpt: body.slice(0, EXCERPT_LENGTH) },
    });
    return this.findComment(comment.id);
  }

  async update(actor: AuthActor, id: string, body: string) {
    const { comment } = await this.authorization.requireComment(actor, id, 'member');
    if (comment.authorId !== actor.user.id) {
      throw forbidden('Only the author can edit this comment');
    }
    await this.db.update(comments).set({ body, updatedAt: now() }).where(eq(comments.id, id));
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
    return row;
  }
}
