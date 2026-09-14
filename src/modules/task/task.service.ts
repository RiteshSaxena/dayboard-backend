import { conflict, notFound } from "../../core/http/api-error";
import { makeCursor, parseCursor } from "../../core/http/request";
import { createId } from "../../core/security/crypto";
import { now } from "../../core/utils/text";
import type { Task } from "../../database/schema";
import type { ActivityService } from "../activity/activity.service";
import type { AuthActor } from "../auth/auth.types";
import type { AuthorizationService } from "../authorization/authorization.service";
import type { OrgRepository } from "../org/org.repository";
import type { TaskRepository } from "./task.repository";

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly authorization: AuthorizationService,
    private readonly orgRepository: OrgRepository,
    private readonly activity: ActivityService,
  ) {}

  async list(actor: AuthActor, projectId: string, filter: { status?: Task["status"]; archived?: string; cursor?: string }) {
    await this.authorization.requireProject(actor, projectId);
    const rows = await this.repository.list(projectId, {
      status: filter.status,
      archived: filter.archived === undefined ? undefined : filter.archived === "true",
      cursor: parseCursor(filter.cursor),
    });
    const hasMore = rows.length > 200;
    const items = rows.slice(0, 200);
    return { items, cursor: hasMore ? makeCursor(items.at(-1)) : null };
  }

  async create(actor: AuthActor, projectId: string, input: { title: string; description: string; dueDate?: string | null; assigneeId?: string | null; status: Task["status"] }) {
    const { project } = await this.authorization.requireProject(actor, projectId, "member");
    await this.validateAssignee(project.orgId, input.assigneeId);
    const timestamp = now();
    const task: Task = {
      id: createId(), projectId, title: input.title, description: input.description, status: input.status,
      assigneeId: input.assigneeId ?? null, dueDate: input.dueDate ?? null, position: timestamp,
      createdBy: actor.user.id, completedAt: input.status === "done" ? timestamp : null, archivedAt: null,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    await this.repository.create(task);
    await this.activity.record({ orgId: project.orgId, projectId, taskId: task.id, actorId: actor.user.id, kind: "task.created", payload: task });
    return task;
  }

  async update(actor: AuthActor, id: string, input: { title?: string; description?: string; dueDate?: string | null; assigneeId?: string | null; projectId?: string }) {
    const current = await this.authorization.requireTask(actor, id, "member");
    let targetProjectId = current.task.projectId;
    if (input.projectId && input.projectId !== current.task.projectId) {
      const target = await this.authorization.requireProject(actor, input.projectId, "member");
      if (target.project.orgId !== current.project.orgId) throw conflict("Tasks cannot be moved across organizations");
      targetProjectId = input.projectId;
    }
    await this.validateAssignee(current.project.orgId, input.assigneeId);
    const task = await this.repository.update(id, { ...input, projectId: targetProjectId, updatedAt: now() });
    if (!task) throw notFound("Task");
    await this.activity.record({ orgId: current.project.orgId, projectId: targetProjectId, taskId: id, actorId: actor.user.id, kind: "task.updated", payload: task });
    return task;
  }

  async move(actor: AuthActor, id: string, status: Task["status"]) {
    const current = await this.authorization.requireTask(actor, id, "member");
    const timestamp = now();
    const task = await this.repository.update(id, {
      status, position: timestamp, completedAt: status === "done" ? timestamp : null, archivedAt: null, updatedAt: timestamp,
    });
    if (!task) throw notFound("Task");
    await this.activity.record({ orgId: current.project.orgId, projectId: task.projectId, taskId: id, actorId: actor.user.id, kind: "task.updated", payload: task });
    return task;
  }

  async archive(actor: AuthActor, id: string) {
    const current = await this.authorization.requireTask(actor, id, "member");
    if (current.task.status !== "done") throw conflict("Only completed tasks can be archived");
    const task = await this.repository.update(id, { archivedAt: now(), updatedAt: now() });
    if (!task) throw notFound("Task");
    await this.activity.record({ orgId: current.project.orgId, projectId: task.projectId, taskId: id, actorId: actor.user.id, kind: "task.updated", payload: task });
    return task;
  }

  async unarchive(actor: AuthActor, id: string) {
    const current = await this.authorization.requireTask(actor, id, "member");
    const task = await this.repository.update(id, { archivedAt: null, updatedAt: now() });
    if (!task) throw notFound("Task");
    await this.activity.record({ orgId: current.project.orgId, projectId: task.projectId, taskId: id, actorId: actor.user.id, kind: "task.updated", payload: task });
    return task;
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    const current = await this.authorization.requireTask(actor, id, "member");
    const timestamp = now();
    const task = await this.repository.update(id, { deletedAt: timestamp, updatedAt: timestamp });
    if (task) await this.activity.record({ orgId: current.project.orgId, projectId: task.projectId, taskId: id, actorId: actor.user.id, kind: "task.deleted", payload: task });
  }

  async restore(actor: AuthActor, id: string) {
    const row = await this.repository.findAny(id);
    if (!row || row.project.deletedAt) throw notFound("Task");
    await this.authorization.requireOrg(actor, row.project.orgId, "member");
    if (!row.task.deletedAt) throw conflict("Task is not deleted");
    const task = await this.repository.update(id, { deletedAt: null, updatedAt: now() });
    if (!task) throw notFound("Task");
    await this.activity.record({ orgId: row.project.orgId, projectId: task.projectId, taskId: id, actorId: actor.user.id, kind: "task.restored", payload: task });
    return task;
  }

  async archiveDone(actor: AuthActor, projectId: string) {
    const { project } = await this.authorization.requireProject(actor, projectId, "member");
    const count = await this.repository.archiveDone(projectId, now());
    await this.activity.record({ orgId: project.orgId, projectId, actorId: actor.user.id, kind: "task.archive_done", payload: { count } });
    return { count };
  }

  async mine(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.repository.mine(orgId, actor.user.id);
  }

  private async validateAssignee(orgId: string, assigneeId: string | null | undefined): Promise<void> {
    if (!assigneeId) return;
    if (!(await this.orgRepository.findMembership(orgId, assigneeId))) throw conflict("Assignee is not a member of this organization", "assigneeId");
  }
}
