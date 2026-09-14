import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { memberships, notes, projects, tasks, type Membership, type Note, type Project, type Task } from "../../database/schema";
import { ApiError, forbidden, notFound } from "../../core/http/api-error";
import type { AuthActor } from "../auth/auth.types";

export type Role = Membership["role"];
const roleRank: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export class AuthorizationService {
  constructor(private readonly database: DatabaseService) {}

  requireVerified(actor: AuthActor): void {
    if (!actor.user.emailVerifiedAt) {
      throw new ApiError(403, "unverified", "Verify your email to use this feature");
    }
  }

  async requireOrg(actor: AuthActor, orgId: string, minimum: Role = "guest"): Promise<Membership> {
    if (!actor.user.emailVerifiedAt && Date.now() - actor.user.createdAt > 7 * 86_400_000) {
      throw new ApiError(403, "unverified", "Verify your email to continue using Dayboard");
    }
    const membership = await this.database.db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, orgId), eq(memberships.userId, actor.user.id)),
    });
    if (!membership) throw notFound("Organization");
    if (roleRank[membership.role] < roleRank[minimum]) throw forbidden();
    return membership;
  }

  async requireProject(actor: AuthActor, projectId: string, minimum: Role = "guest"): Promise<{ project: Project; membership: Membership }> {
    const project = await this.database.db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
    });
    if (!project) throw notFound("Project");
    const membership = await this.requireOrg(actor, project.orgId, minimum);
    return { project, membership };
  }

  async requireTask(actor: AuthActor, taskId: string, minimum: Role = "guest"): Promise<{ task: Task; project: Project; membership: Membership }> {
    const row = await this.database.db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!row[0]) throw notFound("Task");
    return { ...row[0], membership: await this.requireOrg(actor, row[0].project.orgId, minimum) };
  }

  async requireNote(actor: AuthActor, noteId: string, minimum: Role = "guest"): Promise<{ note: Note; project: Project; membership: Membership }> {
    const row = await this.database.db
      .select({ note: notes, project: projects })
      .from(notes)
      .innerJoin(projects, eq(notes.projectId, projects.id))
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!row[0]) throw notFound("Note");
    return { ...row[0], membership: await this.requireOrg(actor, row[0].project.orgId, minimum) };
  }

  canManageRole(actorRole: Role, targetRole: Role): boolean {
    return roleRank[actorRole] > roleRank[targetRole];
  }
}
