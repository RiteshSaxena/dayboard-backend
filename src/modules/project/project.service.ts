import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError, conflict, notFound } from '../../core/http/api-error';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { notes, projects, tasks, type Project } from '../../database/schema';
import type { AuthActor } from '../auth/auth.types';
import type { ActivityService } from '../activity/activity.service';
import type { AuthorizationService } from '../authorization/authorization.service';

export class ProjectService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
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
    const project = {
      id: createId(),
      orgId,
      name: input.name,
      color: input.color,
      position: timestamp,
      archivedAt: null,
      createdBy: actor.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(projects).values(project);
    await this.activity.record({
      orgId,
      projectId: project.id,
      actorId: actor.user.id,
      kind: 'project.created',
      payload: project,
    });
    return project;
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
    const projectRows = await this.db.query.projects.findMany({
      where: and(
        eq(projects.orgId, orgId),
        isNull(projects.deletedAt),
        isNull(projects.archivedAt),
      ),
      orderBy: [desc(projects.position), desc(projects.id)],
    });
    if (projectRows.length === 0) return { projects: [], tasks: [], notes: [] };
    const ids = projectRows.map((project) => project.id);
    const [taskRows, noteRows] = await Promise.all([
      this.db.query.tasks.findMany({
        where: and(
          inArray(tasks.projectId, ids),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
        ),
        orderBy: [desc(tasks.position), desc(tasks.id)],
      }),
      this.db.query.notes.findMany({
        where: and(inArray(notes.projectId, ids), isNull(notes.deletedAt)),
        orderBy: [desc(notes.pinned), desc(notes.position), desc(notes.id)],
      }),
    ]);
    return { projects: projectRows, tasks: taskRows, notes: noteRows };
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
