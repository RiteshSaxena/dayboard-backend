import { and, asc, eq } from 'drizzle-orm';
import { badRequest, conflict } from '../../core/http/api-error';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { taskTypes, tasks, type TaskType } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

const MAX_TASK_TYPES = 50;

// Colors come from the frontend project palette. Keep in sync with the backfill in
// drizzle/0001_task_types_stages_subtasks_comments.sql.
const STARTER_TASK_TYPES = [
  { name: 'Task', color: '#7788ad' },
  { name: 'Bug', color: '#bc6b73' },
  { name: 'Feature', color: '#617a59' },
  { name: 'Story', color: '#57534e' },
];

/** Task types every new org starts with. */
export function buildStarterTaskTypes(orgId: string, timestamp: number): TaskType[] {
  return STARTER_TASK_TYPES.map((taskType, position) => ({
    id: createId(),
    orgId,
    name: taskType.name,
    color: taskType.color,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export class TaskTypeService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
  ) {}

  async list(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.listTaskTypes(orgId);
  }

  async create(actor: AuthActor, orgId: string, input: { name: string; color: string }) {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const existing = await this.listTaskTypes(orgId);
    if (existing.length >= MAX_TASK_TYPES) {
      throw conflict('This organization has reached its task type limit');
    }
    this.assertUniqueName(existing, input.name);
    const timestamp = now();
    const taskType: TaskType = {
      id: createId(),
      orgId,
      name: input.name,
      color: input.color,
      position: (existing.at(-1)?.position ?? -1) + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(taskTypes).values(taskType);
    await this.activity.record({
      orgId,
      actorId: actor.user.id,
      kind: 'task_type.created',
      payload: taskType,
    });
    return taskType;
  }

  async update(actor: AuthActor, id: string, input: { name?: string; color?: string }) {
    const { taskType } = await this.authorization.requireTaskType(actor, id, 'admin');
    if (input.name !== undefined) {
      const siblings = await this.listTaskTypes(taskType.orgId);
      this.assertUniqueName(
        siblings.filter((sibling) => sibling.id !== id),
        input.name,
      );
    }
    const timestamp = now();
    await this.db
      .update(taskTypes)
      .set({ ...input, updatedAt: timestamp })
      .where(eq(taskTypes.id, id));
    const updated: TaskType = { ...taskType, ...input, updatedAt: timestamp };
    await this.activity.record({
      orgId: taskType.orgId,
      actorId: actor.user.id,
      kind: 'task_type.updated',
      payload: updated,
    });
    return updated;
  }

  async reorder(actor: AuthActor, orgId: string, taskTypeIds: string[]) {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const existing = await this.listTaskTypes(orgId);
    const existingIds = new Set(existing.map((taskType) => taskType.id));
    if (
      new Set(taskTypeIds).size !== taskTypeIds.length ||
      taskTypeIds.length !== existing.length ||
      !taskTypeIds.every((taskTypeId) => existingIds.has(taskTypeId))
    ) {
      throw badRequest(
        'taskTypeIds must list every task type in the organization exactly once',
        'taskTypeIds',
      );
    }
    const timestamp = now();
    const [first, ...rest] = taskTypeIds.map((taskTypeId, position) =>
      this.db
        .update(taskTypes)
        .set({ position, updatedAt: timestamp })
        .where(and(eq(taskTypes.id, taskTypeId), eq(taskTypes.orgId, orgId))),
    );
    if (first) await this.db.batch([first, ...rest]);
    return this.listTaskTypes(orgId);
  }

  /** Deletes the type; tasks that used it become untyped. */
  async remove(actor: AuthActor, id: string): Promise<void> {
    const { taskType } = await this.authorization.requireTaskType(actor, id, 'admin');
    await this.db.batch([
      this.db.update(tasks).set({ typeId: null }).where(eq(tasks.typeId, id)),
      this.db.delete(taskTypes).where(eq(taskTypes.id, id)),
    ]);
    await this.activity.record({
      orgId: taskType.orgId,
      actorId: actor.user.id,
      kind: 'task_type.deleted',
      payload: taskType,
    });
  }

  async requireInOrg(orgId: string, taskTypeId: string | null | undefined): Promise<void> {
    if (!taskTypeId) return;
    const taskType = await this.db.query.taskTypes.findFirst({
      where: and(eq(taskTypes.id, taskTypeId), eq(taskTypes.orgId, orgId)),
    });
    if (!taskType) throw conflict('Task type does not belong to this organization', 'typeId');
  }

  listTaskTypes(orgId: string): Promise<TaskType[]> {
    return this.db.query.taskTypes.findMany({
      where: eq(taskTypes.orgId, orgId),
      orderBy: [asc(taskTypes.position), asc(taskTypes.id)],
    });
  }

  private assertUniqueName(existing: TaskType[], name: string): void {
    const normalized = name.trim().toLowerCase();
    if (existing.some((taskType) => taskType.name.trim().toLowerCase() === normalized)) {
      throw conflict('A task type with this name already exists', 'name');
    }
  }
}
