import { z } from "zod";
import { ApiError } from "../../core/http/api-error";
import { createId } from "../../core/security/crypto";
import { now } from "../../core/utils/text";
import type { AuthActor } from "../auth/auth.types";
import type { AuthorizationService } from "../authorization/authorization.service";
import type { ActivityRepository } from "./activity.repository";

export class ActivityService {
  constructor(private readonly repository: ActivityRepository, private readonly authorization: AuthorizationService) {}

  async record(input: { orgId: string; projectId?: string | null; taskId?: string | null; actorId: string; kind: string; payload: Record<string, unknown> }): Promise<void> {
    await this.repository.create({ id: createId(), orgId: input.orgId, projectId: input.projectId ?? null, taskId: input.taskId ?? null, actorId: input.actorId, kind: input.kind, payload: input.payload, createdAt: now() });
  }

  async list(actor: AuthActor, projectId: string, rawCursor?: string) {
    await this.authorization.requireProject(actor, projectId);
    const cursor = this.parseCursor(rawCursor);
    const rows = await this.repository.list(projectId, cursor);
    const hasMore = rows.length > 200;
    const items = rows.slice(0, 200);
    const last = items.at(-1);
    return { items, cursor: hasMore && last ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id })) : null };
  }

  private parseCursor(raw?: string): { createdAt: number; id: string } | null {
    if (!raw) return null;
    try {
      const parsed = z.object({ createdAt: z.number().int(), id: z.string().length(21) }).parse(JSON.parse(atob(raw)));
      return parsed;
    } catch {
      throw new ApiError(422, "validation", "Invalid cursor", "cursor");
    }
  }
}
