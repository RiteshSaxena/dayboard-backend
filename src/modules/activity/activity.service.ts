import { and, desc, eq, lt, or } from 'drizzle-orm';
import { makeTimeCursor, parseTimeCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { activity } from '../../database/schema';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

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
    const cursor = parseTimeCursor(rawCursor);
    const cursorCondition = cursor
      ? or(
          lt(activity.createdAt, cursor.createdAt),
          and(eq(activity.createdAt, cursor.createdAt), lt(activity.id, cursor.id)),
        )
      : undefined;
    const rows = await this.db.query.activity.findMany({
      where: and(eq(activity.projectId, projectId), cursorCondition),
      orderBy: [desc(activity.createdAt), desc(activity.id)],
      limit: 201,
    });
    const hasMore = rows.length > 200;
    const items = rows.slice(0, 200);
    return { items, cursor: hasMore ? makeTimeCursor(items.at(-1)) : null };
  }
}
