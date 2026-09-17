import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/database';
import {
  comments,
  memberships,
  notes,
  projectStages,
  projects,
  taskTypes,
  tasks,
  type Comment,
  type Membership,
  type Note,
  type Project,
  type ProjectStage,
  type Task,
  type TaskType,
} from '../../database/schema';
import { ApiError, forbidden, notFound } from '../../core/http/api-error';
import type { AuthActor } from '../auth/auth.types';

export type Role = Membership['role'];
const roleRank: Record<Role, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export class AuthorizationService {
  constructor(private readonly db: DrizzleDB) {}

  requireVerified(actor: AuthActor): void {
    if (!actor.user.emailVerifiedAt) {
      throw new ApiError(403, 'unverified', 'Verify your email to use this feature');
    }
  }

  async requireOrg(actor: AuthActor, orgId: string, minimum: Role = 'guest'): Promise<Membership> {
    if (!actor.user.emailVerifiedAt && Date.now() - actor.user.createdAt > 7 * 86_400_000) {
      throw new ApiError(403, 'unverified', 'Verify your email to continue using Dayboard');
    }
    const membership = await this.db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, orgId), eq(memberships.userId, actor.user.id)),
    });
    if (!membership) throw notFound('Organization');
    if (roleRank[membership.role] < roleRank[minimum]) throw forbidden();
    return membership;
  }

  async requireProject(
    actor: AuthActor,
    projectId: string,
    minimum: Role = 'guest',
  ): Promise<{ project: Project; membership: Membership }> {
    const project = await this.db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
    });
    if (!project) throw notFound('Project');
    const membership = await this.requireOrg(actor, project.orgId, minimum);
    return { project, membership };
  }

  async requireTask(
    actor: AuthActor,
    taskId: string,
    minimum: Role = 'guest',
  ): Promise<{ task: Task; project: Project; membership: Membership }> {
    const row = await this.db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!row[0]) throw notFound('Task');
    const membership = await this.requireOrg(actor, row[0].project.orgId, minimum);
    return { ...row[0], membership };
  }

  async requireNote(
    actor: AuthActor,
    noteId: string,
    minimum: Role = 'guest',
  ): Promise<{ note: Note; project: Project; membership: Membership }> {
    const row = await this.db
      .select({ note: notes, project: projects })
      .from(notes)
      .innerJoin(projects, eq(notes.projectId, projects.id))
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!row[0]) throw notFound('Note');
    const membership = await this.requireOrg(actor, row[0].project.orgId, minimum);
    return { ...row[0], membership };
  }

  async requireStage(
    actor: AuthActor,
    stageId: string,
    minimum: Role = 'guest',
  ): Promise<{ stage: ProjectStage; project: Project; membership: Membership }> {
    const row = await this.db
      .select({ stage: projectStages, project: projects })
      .from(projectStages)
      .innerJoin(projects, eq(projectStages.projectId, projects.id))
      .where(and(eq(projectStages.id, stageId), isNull(projects.deletedAt)))
      .limit(1);
    if (!row[0]) throw notFound('Stage');
    const membership = await this.requireOrg(actor, row[0].project.orgId, minimum);
    return { ...row[0], membership };
  }

  async requireTaskType(
    actor: AuthActor,
    taskTypeId: string,
    minimum: Role = 'guest',
  ): Promise<{ taskType: TaskType; membership: Membership }> {
    const taskType = await this.db.query.taskTypes.findFirst({
      where: eq(taskTypes.id, taskTypeId),
    });
    if (!taskType) throw notFound('Task type');
    const membership = await this.requireOrg(actor, taskType.orgId, minimum);
    return { taskType, membership };
  }

  async requireComment(
    actor: AuthActor,
    commentId: string,
    minimum: Role = 'guest',
  ): Promise<{ comment: Comment; task: Task; project: Project; membership: Membership }> {
    const row = await this.db
      .select({ comment: comments, task: tasks, project: projects })
      .from(comments)
      .innerJoin(tasks, eq(comments.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(comments.id, commentId),
          isNull(comments.deletedAt),
          isNull(tasks.deletedAt),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!row[0]) throw notFound('Comment');
    const membership = await this.requireOrg(actor, row[0].project.orgId, minimum);
    return { ...row[0], membership };
  }

  canManageRole(actorRole: Role, targetRole: Role): boolean {
    return roleRank[actorRole] > roleRank[targetRole];
  }
}
