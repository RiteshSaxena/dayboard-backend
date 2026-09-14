import { ApiError, conflict, notFound } from "../../core/http/api-error";
import { createId } from "../../core/security/crypto";
import { now } from "../../core/utils/text";
import type { AuthActor } from "../auth/auth.types";
import type { ActivityService } from "../activity/activity.service";
import type { AuthorizationService } from "../authorization/authorization.service";
import type { ProjectRepository } from "./project.repository";

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
  ) {}

  async list(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.repository.list(orgId);
  }

  async board(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.repository.board(orgId);
  }

  async create(actor: AuthActor, orgId: string, input: { name: string; color: string }) {
    await this.authorization.requireOrg(actor, orgId, "admin");
    if ((await this.repository.countForOrg(orgId)) >= 200) throw new ApiError(409, "conflict", "This organization has reached its project limit");
    const timestamp = now();
    const project = {
      id: createId(), orgId, name: input.name, color: input.color, position: timestamp, archivedAt: null,
      createdBy: actor.user.id, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    await this.repository.create(project);
    await this.activity.record({ orgId, projectId: project.id, actorId: actor.user.id, kind: "project.created", payload: project });
    return project;
  }

  async update(actor: AuthActor, id: string, input: { name?: string; color?: string; position?: number; archived?: boolean }) {
    await this.authorization.requireProject(actor, id, "admin");
    const timestamp = now();
    const { archived, ...rest } = input;
    const project = await this.repository.update(id, { ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? timestamp : null }), updatedAt: timestamp });
    if (!project) throw notFound("Project");
    await this.activity.record({ orgId: project.orgId, projectId: id, actorId: actor.user.id, kind: "project.updated", payload: project });
    return project;
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    await this.authorization.requireProject(actor, id, "admin");
    const timestamp = now();
    const project = await this.repository.update(id, { deletedAt: timestamp, updatedAt: timestamp });
    if (project) await this.activity.record({ orgId: project.orgId, projectId: id, actorId: actor.user.id, kind: "project.deleted", payload: project });
  }

  async restore(actor: AuthActor, id: string) {
    const project = await this.repository.findAny(id);
    if (!project) throw notFound("Project");
    if (!project.deletedAt) throw conflict("Project is not deleted");
    await this.authorization.requireOrg(actor, project.orgId, "admin");
    const restored = await this.repository.update(id, { deletedAt: null, updatedAt: now() });
    if (!restored) throw notFound("Project");
    await this.activity.record({ orgId: restored.orgId, projectId: id, actorId: actor.user.id, kind: "project.restored", payload: restored });
    return restored;
  }
}
