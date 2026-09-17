import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';
import { conflict, notFound } from '../../core/http/api-error';
import { makeCursor, parseCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { memberships, projects, tasks, type Project, type Task } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import { stageAssignment, type StageCategory, type StageService } from '../stage/stage.service';
import type { TaskTypeService } from '../task-type/task-type.service';

const PAGE_SIZE = 200;
const MAX_SUBTASKS = 100;
const CATEGORIES: StageCategory[] = ['todo', 'doing', 'done'];

interface TaskInput {
  title: string;
  description: string;
  dueDate?: string | null;
  assigneeId?: string | null;
  typeId?: string | null;
  stageId?: string;
  status?: Task['status'];
}

export type SubtaskCounts = Map<string, { total: number; done: number }>;

export function countSubtasks(rows: Pick<Task, 'parentId' | 'status'>[]): SubtaskCounts {
  const counts: SubtaskCounts = new Map();
  for (const row of rows) {
    if (!row.parentId) continue;
    const current = counts.get(row.parentId) ?? { total: 0, done: 0 };
    current.total += 1;
    if (row.status === 'done') current.done += 1;
    counts.set(row.parentId, current);
  }
  return counts;
}

export function withSubtaskCounts<T extends Task>(parents: T[], counts: SubtaskCounts) {
  return parents.map((task) => ({
    ...task,
    subtaskCount: counts.get(task.id)?.total ?? 0,
    subtaskDoneCount: counts.get(task.id)?.done ?? 0,
  }));
}

export class TaskService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
    private readonly stages: StageService,
    private readonly taskTypes: TaskTypeService,
  ) {}

  /** Lists top-level tasks; subtasks are fetched through their parent. */
  async list(
    actor: AuthActor,
    projectId: string,
    filter: {
      status?: Task['status'];
      stageId?: string;
      typeId?: string;
      archived?: string;
      cursor?: string;
    },
  ) {
    await this.authorization.requireProject(actor, projectId);
    const conditions: SQL[] = [
      eq(tasks.projectId, projectId),
      isNull(tasks.parentId),
      isNull(tasks.deletedAt),
    ];
    if (filter.status) conditions.push(eq(tasks.status, filter.status));
    if (filter.stageId) conditions.push(eq(tasks.stageId, filter.stageId));
    if (filter.typeId) conditions.push(eq(tasks.typeId, filter.typeId));
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
      limit: PAGE_SIZE + 1,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    const counts = await this.subtaskCounts(projectId);
    return {
      items: withSubtaskCounts(items, counts),
      cursor: hasMore ? makeCursor(items.at(-1)) : null,
    };
  }

  async create(actor: AuthActor, projectId: string, input: TaskInput) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'member');
    return this.insertTask(actor, project, input, null);
  }

  async listSubtasks(actor: AuthActor, parentId: string) {
    await this.authorization.requireTask(actor, parentId);
    return this.db.query.tasks.findMany({
      where: and(eq(tasks.parentId, parentId), isNull(tasks.deletedAt)),
      orderBy: [asc(tasks.position), asc(tasks.id)],
    });
  }

  async createSubtask(actor: AuthActor, parentId: string, input: TaskInput) {
    const { task: parent, project } = await this.authorization.requireTask(
      actor,
      parentId,
      'member',
    );
    if (parent.parentId) throw conflict('Subtasks cannot have their own subtasks');
    if (parent.archivedAt) throw conflict('Unarchive the parent task before adding subtasks');
    const [existing] = await this.db
      .select({ value: count() })
      .from(tasks)
      .where(and(eq(tasks.parentId, parentId), isNull(tasks.deletedAt)));
    if ((existing?.value ?? 0) >= MAX_SUBTASKS) {
      throw conflict('This task has reached its subtask limit');
    }
    return this.insertTask(actor, project, input, parent.id);
  }

  async update(
    actor: AuthActor,
    id: string,
    input: {
      title?: string;
      description?: string;
      dueDate?: string | null;
      assigneeId?: string | null;
      typeId?: string | null;
      projectId?: string;
    },
  ) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    const { projectId: requestedProjectId, ...fields } = input;
    await this.validateAssignee(current.project.orgId, input.assigneeId);
    await this.taskTypes.requireInOrg(current.project.orgId, input.typeId);
    const timestamp = now();
    let patch: SQLiteUpdateSetSource<typeof tasks> = { ...fields, updatedAt: timestamp };
    const subtaskUpdates = [];

    if (requestedProjectId && requestedProjectId !== current.task.projectId) {
      if (current.task.parentId) {
        throw conflict('Subtasks move with their parent task', 'projectId');
      }
      const target = await this.authorization.requireProject(actor, requestedProjectId, 'member');
      if (target.project.orgId !== current.project.orgId)
        throw conflict('Tasks cannot be moved across organizations');
      const stageFor = await this.stages.mapForProject(requestedProjectId);
      patch = {
        ...patch,
        projectId: requestedProjectId,
        ...stageAssignment(stageFor(current.task.status), timestamp),
      };
      for (const category of CATEGORIES) {
        subtaskUpdates.push(
          this.db
            .update(tasks)
            .set({
              projectId: requestedProjectId,
              ...stageAssignment(stageFor(category), timestamp),
              updatedAt: timestamp,
            })
            .where(and(eq(tasks.parentId, id), eq(tasks.status, category))),
        );
      }
    }

    await this.db.batch([
      this.db.update(tasks).set(patch).where(eq(tasks.id, id)),
      ...subtaskUpdates,
    ]);
    return this.recordUpdate(actor, current.project, id);
  }

  async move(actor: AuthActor, id: string, input: { stageId?: string; status?: Task['status'] }) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    const stage = await this.stages.resolveForTask(current.task.projectId, input);
    const timestamp = now();
    if (current.task.parentId) {
      // Subtasks keep their list position and follow the parent's archive state.
      await this.db
        .update(tasks)
        .set({ ...stageAssignment(stage, timestamp), updatedAt: timestamp })
        .where(eq(tasks.id, id));
    } else {
      await this.db.batch([
        this.db
          .update(tasks)
          .set({
            ...stageAssignment(stage, timestamp),
            position: timestamp,
            archivedAt: null,
            updatedAt: timestamp,
          })
          .where(eq(tasks.id, id)),
        this.db
          .update(tasks)
          .set({ archivedAt: null, updatedAt: timestamp })
          .where(and(eq(tasks.parentId, id), isNotNull(tasks.archivedAt))),
      ]);
    }
    return this.recordUpdate(actor, current.project, id);
  }

  async archive(actor: AuthActor, id: string) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    if (current.task.parentId) throw conflict('Subtasks are archived with their parent task');
    if (current.task.status !== 'done') throw conflict('Only completed tasks can be archived');
    const timestamp = now();
    await this.db.batch([
      this.db
        .update(tasks)
        .set({ archivedAt: timestamp, updatedAt: timestamp })
        .where(eq(tasks.id, id)),
      this.db
        .update(tasks)
        .set({ archivedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(tasks.parentId, id), isNull(tasks.archivedAt))),
    ]);
    return this.recordUpdate(actor, current.project, id);
  }

  async unarchive(actor: AuthActor, id: string) {
    const current = await this.authorization.requireTask(actor, id, 'member');
    if (current.task.parentId) throw conflict('Subtasks are unarchived with their parent task');
    const timestamp = now();
    await this.db.batch([
      this.db.update(tasks).set({ archivedAt: null, updatedAt: timestamp }).where(eq(tasks.id, id)),
      this.db
        .update(tasks)
        .set({ archivedAt: null, updatedAt: timestamp })
        .where(and(eq(tasks.parentId, id), isNotNull(tasks.archivedAt))),
    ]);
    return this.recordUpdate(actor, current.project, id);
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    const current = await this.authorization.requireTask(actor, id, 'member');
    const timestamp = now();
    // Subtasks share the parent's deletedAt so restoring the parent restores exactly these.
    await this.db.batch([
      this.db
        .update(tasks)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(eq(tasks.id, id)),
      this.db
        .update(tasks)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(and(eq(tasks.parentId, id), isNull(tasks.deletedAt))),
    ]);
    const task = await this.findTaskById(id);
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
    const { deletedAt } = row.task;
    if (!deletedAt) throw conflict('Task is not deleted');
    if (row.task.parentId) {
      const parent = await this.findTaskById(row.task.parentId);
      if (!parent || parent.deletedAt) throw conflict('Restore the parent task first');
    }
    const timestamp = now();
    await this.db.batch([
      this.db.update(tasks).set({ deletedAt: null, updatedAt: timestamp }).where(eq(tasks.id, id)),
      this.db
        .update(tasks)
        .set({ deletedAt: null, updatedAt: timestamp })
        .where(and(eq(tasks.parentId, id), eq(tasks.deletedAt, deletedAt))),
    ]);
    const task = await this.findTaskById(id);
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

  /** Archives done top-level tasks and their subtasks. `count` covers top-level tasks only. */
  async archiveDone(actor: AuthActor, projectId: string) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'member');
    const timestamp = now();
    const archivedParents = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.parentId),
          eq(tasks.archivedAt, timestamp),
        ),
      );
    const [parents] = await this.db.batch([
      this.db
        .update(tasks)
        .set({ archivedAt: timestamp, updatedAt: timestamp })
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.parentId),
            eq(tasks.status, 'done'),
            isNull(tasks.archivedAt),
            isNull(tasks.deletedAt),
          ),
        ),
      this.db
        .update(tasks)
        .set({ archivedAt: timestamp, updatedAt: timestamp })
        .where(
          and(
            inArray(tasks.parentId, archivedParents),
            isNull(tasks.archivedAt),
            isNull(tasks.deletedAt),
          ),
        ),
    ]);
    const archived = parents.meta.changes;
    await this.activity.record({
      orgId: project.orgId,
      projectId,
      actorId: actor.user.id,
      kind: 'task.archive_done',
      payload: { count: archived },
    });
    return { count: archived };
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
          // done work stays listed until it is archived, so clients can show progress
          isNull(tasks.archivedAt),
          isNull(tasks.deletedAt),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(desc(tasks.position));
    return rows.map((row) => row.task);
  }

  private async insertTask(
    actor: AuthActor,
    project: Project,
    input: TaskInput,
    parentId: string | null,
  ) {
    await this.validateAssignee(project.orgId, input.assigneeId);
    await this.taskTypes.requireInOrg(project.orgId, input.typeId);
    const stage = await this.stages.resolveForTask(project.id, input);
    const timestamp = now();
    const task: Task = {
      id: createId(),
      projectId: project.id,
      parentId,
      stageId: stage.id,
      typeId: input.typeId ?? null,
      title: input.title,
      description: input.description,
      status: stage.category,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      position: timestamp,
      createdBy: actor.user.id,
      completedAt: stage.category === 'done' ? timestamp : null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(tasks).values(task);
    await this.activity.record({
      orgId: project.orgId,
      projectId: project.id,
      taskId: task.id,
      actorId: actor.user.id,
      kind: 'task.created',
      payload: task,
    });
    return task;
  }

  private async recordUpdate(actor: AuthActor, project: Project, id: string) {
    const task = await this.findTaskById(id);
    if (!task) throw notFound('Task');
    await this.activity.record({
      orgId: project.orgId,
      projectId: task.projectId,
      taskId: id,
      actorId: actor.user.id,
      kind: 'task.updated',
      payload: task,
    });
    return task;
  }

  private async subtaskCounts(projectId: string): Promise<SubtaskCounts> {
    const rows = await this.db
      .select({
        parentId: tasks.parentId,
        total: count(),
        done: sql<number>`coalesce(sum(case when ${tasks.status} = 'done' then 1 else 0 end), 0)`,
      })
      .from(tasks)
      .where(
        and(eq(tasks.projectId, projectId), isNotNull(tasks.parentId), isNull(tasks.deletedAt)),
      )
      .groupBy(tasks.parentId);
    return new Map(
      rows.flatMap((row) =>
        row.parentId ? [[row.parentId, { total: row.total, done: Number(row.done) }]] : [],
      ),
    );
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

  private async findTaskById(id: string): Promise<Task | null> {
    const task = await this.db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    return task ?? null;
  }
}
