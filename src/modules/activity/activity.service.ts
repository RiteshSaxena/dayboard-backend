import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { makeTimeCursor, parseTimeCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { activity, tasks } from '../../database/schema';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

const PAGE_SIZE = 200;

export class ActivityService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
  ) {}

  async record(input: {
    orgId: string;
    projectId?: string | null;
    taskId?: string | null;
    actorId: string;
    kind: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(activity).values({
      id: createId(),
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      actorId: input.actorId,
      kind: input.kind,
      payload: input.payload,
      createdAt: now(),
    });
  }

  async list(actor: AuthActor, projectId: string, rawCursor?: string) {
    await this.authorization.requireProject(actor, projectId);
    return this.page(eq(activity.projectId, projectId), rawCursor);
  }

  /**
   * A task's history: task changes and comments. With `includeSubtasks`, also the history of every
   * subtask, including deleted ones.
   */
  async listForTask(
    actor: AuthActor,
    taskId: string,
    options: { cursor?: string; includeSubtasks: boolean },
  ) {
    await this.authorization.requireTask(actor, taskId);
    const subtaskIds = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentId, taskId));
    const condition = options.includeSubtasks
      ? or(eq(activity.taskId, taskId), inArray(activity.taskId, subtaskIds))!
      : eq(activity.taskId, taskId);
    return this.page(condition, options.cursor);
  }

  private async page(condition: SQL, rawCursor?: string) {
    const cursor = parseTimeCursor(rawCursor);
    const cursorCondition = cursor
      ? or(
          lt(activity.createdAt, cursor.createdAt),
          and(eq(activity.createdAt, cursor.createdAt), lt(activity.id, cursor.id)),
        )
      : undefined;
    const rows = await this.db.query.activity.findMany({
      where: and(condition, cursorCondition),
      orderBy: [desc(activity.createdAt), desc(activity.id)],
      limit: PAGE_SIZE + 1,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    return { items, cursor: hasMore ? makeTimeCursor(items.at(-1)) : null };
  }
}
