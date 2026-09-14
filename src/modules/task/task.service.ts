import { and, desc, eq, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { conflict, notFound } from '../../core/http/api-error';
import { makeCursor, parseCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { memberships, projects, tasks, type Project, type Task } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

export class TaskService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
  ) {}

  async list(
    actor: AuthActor,
    projectId: string,
    filter: { status?: Task['status']; archived?: string; cursor?: string },
  ) {
    await this.authorization.requireProject(actor, projectId);
    const conditions: SQL[] = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
    if (filter.status) conditions.push(eq(tasks.status, filter.status));
    if (filter.archived === 'true') conditions.push(isNotNull(tasks.archivedAt));
    else conditions.push(isNull(tasks.archivedAt));
    const cursor = parseCursor(filter.cursor);
    if (cursor)
      conditions.push(
        or(
          lt(tasks.position, cursor.position),
          and(eq(tasks.position, cursor.position), lt(tasks.id, cursor.id)),
        )!,
      );
    const rows = await this.db.query.tasks.findMany({
      where: and(...conditions),
      orderBy: [desc(tasks.position), desc(tasks.id)],
      limit: 201,
    });
    const hasMore = rows.length > 200;
    const items = rows.slice(0, 200);
    return { items, cursor: hasMore ? makeCursor(items.at(-1)) : null };
  }

  async create(
    actor: AuthActor,
    projectId: string,
    input: {
      title: string;
      description: string;
      dueDate?: string | null;
      assigneeId?: string | null;
      status: Task['status'];
    },
  ) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'member');
    await this.validateAssignee(project.orgId, input.assigneeId);
    const timestamp = now();
    const task: Task = {
      id: createId(),
      projectId,
      title: input.title,
      description: input.description,
      status: input.status,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      position: timestamp,
      createdBy: actor.user.id,
      completedAt: input.status === 'done' ? timestamp : null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(tasks).values(task);
    await this.activity.record({
      orgId: project.orgId,
      projectId,
      taskId: task.id,
      actorId: actor.user.id,
      kind: 'task.created',
      payload: task,
    });
    return task;
  }

  async update(
    actor: AuthActor,
    id: string,
    input: {
      title?: string;
      description?: string;
      dueDate?: string | null;
      assigneeId?: string | null;
      projectId?: string;
    },
  ) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    let targetProjectId = current.task.projectId;
    if (input.projectId && input.projectId !== current.task.projectId) {
      const target = await this.authorization.requireProject(actor, input.projectId, 'member');
      if (target.project.orgId !== current.project.orgId)
        throw conflict('Tasks cannot be moved across organizations');
      targetProjectId = input.projectId;
    }
    await this.validateAssignee(current.project.orgId, input.assigneeId);
    const task = await this.updateTask(id, {
      ...input,
      projectId: targetProjectId,
      updatedAt: now(),
    });
    if (!task) throw notFound('Task');
    await this.activity.record({
      orgId: current.project.orgId,
      projectId: targetProjectId,
      taskId: id,
      actorId: actor.user.id,
      kind: 'task.updated',
      payload: task,
    });
    return task;
  }

  async move(actor: AuthActor, id: string, status: Task['status']) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    const timestamp = now();
    const task = await this.updateTask(id, {
      status,
      position: timestamp,
      completedAt: status === 'done' ? timestamp : null,
      archivedAt: null,
      updatedAt: timestamp,
    });
    if (!task) throw notFound('Task');
    await this.activity.record({
      orgId: current.project.orgId,
      projectId: task.projectId,
      taskId: id,
      actorId: actor.user.id,
      kind: 'task.updated',
      payload: task,
    });
    return task;
  }

  async archive(actor: AuthActor, id: string) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    if (current.task.status !== 'done') throw conflict('Only completed tasks can be archived');
    const task = await this.updateTask(id, {
      archivedAt: now(),
      updatedAt: now(),
    });
    if (!task) throw notFound('Task');
    await this.activity.record({
      orgId: current.project.orgId,
      projectId: task.projectId,
      taskId: id,
      actorId: actor.user.id,
      kind: 'task.updated',
      payload: task,
    });
    return task;
  }

  async unarchive(actor: AuthActor, id: string) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    const task = await this.updateTask(id, {
      archivedAt: null,
      updatedAt: now(),
    });
    if (!task) throw notFound('Task');
    await this.activity.record({
      orgId: current.project.orgId,
      projectId: task.projectId,
      taskId: id,
      actorId: actor.user.id,
      kind: 'task.updated',
      payload: task,
    });
    return task;
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    const current = await this.authorization.requireTask(actor, id, 'member');
    const timestamp = now();
    const task = await this.updateTask(id, {
      deletedAt: timestamp,
      updatedAt: timestamp,
    });
    if (task)
      await this.activity.record({
        orgId: current.project.orgId,
        projectId: task.projectId,
        taskId: id,
        actorId: actor.user.id,
        kind: 'task.deleted',
        payload: task,
      });
  }

  async restore(actor: AuthActor, id: string) {
    const row = await this.findTask(id);
    if (!row || row.project.deletedAt) throw notFound('Task');
    await this.authorization.requireOrg(actor, row.project.orgId, 'member');
    if (!row.task.deletedAt) throw conflict('Task is not deleted');
    const task = await this.updateTask(id, {
      deletedAt: null,
      updatedAt: now(),
    });
    if (!task) throw notFound('Task');
    await this.activity.record({
      orgId: row.project.orgId,
      projectId: task.projectId,
      taskId: id,
      actorId: actor.user.id,
      kind: 'task.restored',
      payload: task,
    });
    return task;
  }

  async archiveDone(actor: AuthActor, projectId: string) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'member');
    const timestamp = now();
    const result = await this.db
      .update(tasks)
      .set({ archivedAt: timestamp, updatedAt: timestamp })
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, 'done'),
          isNull(tasks.archivedAt),
          isNull(tasks.deletedAt),
        ),
      );
    const count = result.meta.changes;
    await this.activity.record({
      orgId: project.orgId,
      projectId,
      actorId: actor.user.id,
      kind: 'task.archive_done',
      payload: { count },
    });
    return { count };
  }

  async mine(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    const rows = await this.db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(projects.orgId, orgId),
          eq(tasks.assigneeId, actor.user.id),
          isNull(tasks.completedAt),
          isNull(tasks.archivedAt),
          isNull(tasks.deletedAt),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(desc(tasks.position));
    return rows.map((row) => row.task);
  }

  private async validateAssignee(
    orgId: string,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;
    const membership = await this.db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, orgId), eq(memberships.userId, assigneeId)),
    });
    if (!membership) throw conflict('Assignee is not a member of this organization', 'assigneeId');
  }

  private async findTask(id: string): Promise<{ task: Task; project: Project } | null> {
    const rows = await this.db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  private async updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    await this.db.update(tasks).set(patch).where(eq(tasks.id, id));
    return (await this.db.query.tasks.findFirst({ where: eq(tasks.id, id) })) ?? null;
  }
}
