import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '../../core/http/api-error';
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
    const cursor = this.parseCursor(rawCursor);
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
    const last = items.at(-1);
    return {
      items,
      cursor:
        hasMore && last ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id })) : null,
    };
  }

  private parseCursor(raw?: string): { createdAt: number; id: string } | null {
    if (!raw) return null;
    try {
      const parsed = z
        .object({ createdAt: z.number().int(), id: z.string().length(21) })
        .parse(JSON.parse(atob(raw)));
      return parsed;
    } catch {
      throw new ApiError(422, 'validation', 'Invalid cursor', 'cursor');
    }
  }
}
