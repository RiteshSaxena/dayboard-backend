import { conflict, notFound } from "../../core/http/api-error";
import { makeCursor, parseCursor } from "../../core/http/request";
import { createId } from "../../core/security/crypto";
import { now } from "../../core/utils/text";
import type { Note } from "../../database/schema";
import type { ActivityService } from "../activity/activity.service";
import type { AuthActor } from "../auth/auth.types";
import type { AuthorizationService } from "../authorization/authorization.service";
import type { NoteRepository } from "./note.repository";

export class NoteService {
  constructor(
    private readonly repository: NoteRepository,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
  ) {}

  async list(actor: AuthActor, projectId: string, cursor?: string) {
    await this.authorization.requireProject(actor, projectId);
    const rows = await this.repository.list(projectId, parseCursor(cursor));
    const hasMore = rows.length > 200;
    const items = rows.slice(0, 200);
    return { items, cursor: hasMore ? makeCursor(items.at(-1)) : null };
  }

  async create(actor: AuthActor, projectId: string, input: { title: string; body: string }) {
    const { project } = await this.authorization.requireProject(actor, projectId, "member");
    if (!input.title.trim() && !input.body.trim()) throw conflict("Title and body cannot both be empty");
    const timestamp = now();
    const note: Note = {
      id: createId(), projectId, title: input.title, body: input.body, pinned: false, position: timestamp,
      createdBy: actor.user.id, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    await this.repository.create(note);
    await this.activity.record({ orgId: project.orgId, projectId, actorId: actor.user.id, kind: "note.created", payload: note });
    return note;
  }

  async update(actor: AuthActor, id: string, input: { title?: string; body?: string; pinned?: boolean; projectId?: string }) {
    const current = await this.authorization.requireNote(actor, id, "member");
    let targetProjectId = current.note.projectId;
    if (input.projectId && input.projectId !== current.note.projectId) {
      const target = await this.authorization.requireProject(actor, input.projectId, "member");
      if (target.project.orgId !== current.project.orgId) throw conflict("Notes cannot be moved across organizations");
      targetProjectId = input.projectId;
    }
    const title = input.title ?? current.note.title;
    const body = input.body ?? current.note.body;
    if (!title.trim() && !body.trim()) throw conflict("Title and body cannot both be empty");
    const timestamp = now();
    const note = await this.repository.update(id, { ...input, projectId: targetProjectId, position: timestamp, updatedAt: timestamp });
    if (!note) throw notFound("Note");
    await this.activity.record({ orgId: current.project.orgId, projectId: targetProjectId, actorId: actor.user.id, kind: "note.updated", payload: note });
    return note;
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    const current = await this.authorization.requireNote(actor, id, "member");
    const timestamp = now();
    const note = await this.repository.update(id, { deletedAt: timestamp, updatedAt: timestamp });
    if (note) await this.activity.record({ orgId: current.project.orgId, projectId: note.projectId, actorId: actor.user.id, kind: "note.deleted", payload: note });
  }

  async restore(actor: AuthActor, id: string) {
    const row = await this.repository.findAny(id);
    if (!row || row.project.deletedAt) throw notFound("Note");
    await this.authorization.requireOrg(actor, row.project.orgId, "member");
    if (!row.note.deletedAt) throw conflict("Note is not deleted");
    const note = await this.repository.update(id, { deletedAt: null, updatedAt: now() });
    if (!note) throw notFound("Note");
    await this.activity.record({ orgId: row.project.orgId, projectId: note.projectId, actorId: actor.user.id, kind: "note.restored", payload: note });
    return note;
  }
}
