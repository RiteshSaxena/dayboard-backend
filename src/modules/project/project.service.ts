import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { ApiError, conflict, notFound } from '../../core/http/api-error';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { notes, projectStages, projects, tasks, type Project } from '../../database/schema';
import type { AuthActor } from '../auth/auth.types';
import type { ActivityService } from '../activity/activity.service';
import type { AuthorizationService } from '../authorization/authorization.service';
import { buildStarterStages } from '../stage/stage.service';
import { countSubtasks, withSubtaskCounts } from '../task/task.service';
import type { TaskTypeService } from '../task-type/task-type.service';

/** First color of the frontend project palette (`PROJECT_COLORS` in frontend/src/lib/board-data.ts). */
const DEFAULT_PROJECT_COLOR = '#617a59';

export function buildProject(input: {
  orgId: string;
  createdBy: string;
  name: string;
  color: string;
  timestamp: number;
}): Project {
  return {
    id: createId(),
    orgId: input.orgId,
    name: input.name,
    color: input.color,
    position: input.timestamp,
    archivedAt: null,
    createdBy: input.createdBy,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    deletedAt: null,
  };
}

/** The project every personal board starts with. */
export function buildDefaultProject(orgId: string, createdBy: string, timestamp: number): Project {
  return buildProject({
    orgId,
    createdBy,
    name: 'Default',
    color: DEFAULT_PROJECT_COLOR,
    timestamp,
  });
}

export class ProjectService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
    private readonly taskTypes: TaskTypeService,
  ) {}

  async list(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.listProjects(orgId);
  }

  async board(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.getBoard(orgId);
  }

  async create(actor: AuthActor, orgId: string, input: { name: string; color: string }) {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const projectCount = await this.countProjects(orgId);
    if (projectCount >= 200) {
      throw new ApiError(409, 'conflict', 'This organization has reached its project limit');
    }
    const timestamp = now();
    const project = buildProject({ orgId, createdBy: actor.user.id, ...input, timestamp });
    const stages = buildStarterStages(project.id, timestamp);
    await this.db.batch([
      this.db.insert(projects).values(project),
      this.db.insert(projectStages).values(stages),
    ]);
    await this.activity.record({
      orgId,
      projectId: project.id,
      actorId: actor.user.id,
      kind: 'project.created',
      payload: project,
    });
    return { ...project, stages };
  }

  async update(
    actor: AuthActor,
    id: string,
    input: {
      name?: string;
      color?: string;
      position?: number;
      archived?: boolean;
    },
  ) {
    await this.authorization.requireProject(actor, id, 'admin');
    const timestamp = now();
    const { archived, ...rest } = input;
    const project = await this.updateProject(id, {
      ...rest,
      ...(archived === undefined ? {} : { archivedAt: archived ? timestamp : null }),
      updatedAt: timestamp,
    });
    if (!project) throw notFound('Project');
    await this.activity.record({
      orgId: project.orgId,
      projectId: id,
      actorId: actor.user.id,
      kind: 'project.updated',
      payload: project,
    });
    return project;
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    await this.authorization.requireProject(actor, id, 'admin');
    const timestamp = now();
    const project = await this.updateProject(id, {
      deletedAt: timestamp,
      updatedAt: timestamp,
    });
    if (project)
      await this.activity.record({
        orgId: project.orgId,
        projectId: id,
        actorId: actor.user.id,
        kind: 'project.deleted',
        payload: project,
      });
  }

  async restore(actor: AuthActor, id: string) {
    const project = await this.findProject(id);
    if (!project) throw notFound('Project');
    if (!project.deletedAt) throw conflict('Project is not deleted');
    await this.authorization.requireOrg(actor, project.orgId, 'admin');
    const timestamp = now();
    const restored = await this.updateProject(id, {
      deletedAt: null,
      updatedAt: timestamp,
    });
    if (!restored) throw notFound('Project');
    await this.activity.record({
      orgId: restored.orgId,
      projectId: id,
      actorId: actor.user.id,
      kind: 'project.restored',
      payload: restored,
    });
    return restored;
  }

  private async countProjects(orgId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));
    return rows[0]?.value ?? 0;
  }

  private listProjects(orgId: string): Promise<Project[]> {
    return this.db.query.projects.findMany({
      where: and(eq(projects.orgId, orgId), isNull(projects.deletedAt)),
      orderBy: [desc(projects.position), desc(projects.id)],
    });
  }

  private async getBoard(orgId: string) {
    // Every child query filters through a join on the org instead of an `IN (...)` list of
    // project IDs: D1 allows at most 100 bound parameters per query.
    const boardProject = and(
      eq(projects.orgId, orgId),
      isNull(projects.deletedAt),
      isNull(projects.archivedAt),
    );
    const [projectRows, taskTypeRows, stageRows, taskRows, noteRows] = await Promise.all([
      this.db.query.projects.findMany({
        where: boardProject,
        orderBy: [desc(projects.position), desc(projects.id)],
      }),
      this.taskTypes.listTaskTypes(orgId),
      this.db
        .select({ stage: projectStages })
        .from(projectStages)
        .innerJoin(projects, eq(projectStages.projectId, projects.id))
        .where(boardProject)
        .orderBy(asc(projectStages.position), asc(projectStages.id)),
      this.db
        .select({ task: tasks })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(boardProject, isNull(tasks.deletedAt), isNull(tasks.archivedAt)))
        .orderBy(desc(tasks.position), desc(tasks.id)),
      this.db
        .select({ note: notes })
        .from(notes)
        .innerJoin(projects, eq(notes.projectId, projects.id))
        .where(and(boardProject, isNull(notes.deletedAt)))
        .orderBy(desc(notes.pinned), desc(notes.position), desc(notes.id)),
    ]);
    const allTasks = taskRows.map((row) => row.task);
    return {
      projects: projectRows,
      stages: stageRows.map((row) => row.stage),
      taskTypes: taskTypeRows,
      // subtasks are board cards too (linked by parentId); parents also carry their subtask counts
      tasks: withSubtaskCounts(allTasks, countSubtasks(allTasks)),
      notes: noteRows.map((row) => row.note),
    };
  }

  private async findProject(id: string): Promise<Project | null> {
    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, id),
    });
    return project ?? null;
  }

  private async updateProject(id: string, patch: Partial<Project>): Promise<Project | null> {
    await this.db.update(projects).set(patch).where(eq(projects.id, id));
    return this.findProject(id);
  }
}
