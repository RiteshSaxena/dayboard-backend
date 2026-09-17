import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { conflict, notFound } from '../../core/http/api-error';
import { makeCursor, parseCursor } from '../../core/http/request';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { notes, projects, type Note, type Project } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

export class NoteService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
  ) {}

  async list(actor: AuthActor, projectId: string, cursor?: string) {
    await this.authorization.requireProject(actor, projectId);
    const parsedCursor = parseCursor(cursor);
    const cursorCondition = parsedCursor
      ? or(
          lt(notes.position, parsedCursor.position),
          and(eq(notes.position, parsedCursor.position), lt(notes.id, parsedCursor.id)),
        )
      : undefined;
    const rows = await this.db.query.notes.findMany({
      where: and(eq(notes.projectId, projectId), isNull(notes.deletedAt), cursorCondition),
      orderBy: [desc(notes.pinned), desc(notes.position), desc(notes.id)],
      limit: 201,
    });
    const hasMore = rows.length > 200;
    const items = rows.slice(0, 200);
    return { items, cursor: hasMore ? makeCursor(items.at(-1)) : null };
  }

  async create(actor: AuthActor, projectId: string, input: { title: string; body: string }) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'member');
    if (!input.title.trim() && !input.body.trim())
      throw conflict('Title and body cannot both be empty');
    const timestamp = now();
    const note: Note = {
      id: createId(),
      projectId,
      title: input.title,
      body: input.body,
      pinned: false,
      position: timestamp,
      createdBy: actor.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(notes).values(note);
    await this.activity.record({
      orgId: project.orgId,
      projectId,
      actorId: actor.user.id,
      kind: 'note.created',
      payload: note,
    });
    return note;
  }

  async update(
    actor: AuthActor,
    id: string,
    input: {
      title?: string;
      body?: string;
      pinned?: boolean;
      projectId?: string;
    },
  ) {
    const current = await this.authorization.requireNote(actor, id, 'member');
    let targetProjectId = current.note.projectId;
    if (input.projectId && input.projectId !== current.note.projectId) {
      const target = await this.authorization.requireProject(actor, input.projectId, 'member');
      if (target.project.orgId !== current.project.orgId)
        throw conflict('Notes cannot be moved across organizations');
      targetProjectId = input.projectId;
    }
    const title = input.title ?? current.note.title;
    const body = input.body ?? current.note.body;
    if (!title.trim() && !body.trim()) throw conflict('Title and body cannot both be empty');
    const timestamp = now();
    const note = await this.updateNote(id, {
      ...input,
      projectId: targetProjectId,
      position: timestamp,
      updatedAt: timestamp,
    });
    if (!note) throw notFound('Note');
    await this.activity.record({
      orgId: current.project.orgId,
      projectId: targetProjectId,
      actorId: actor.user.id,
      kind: 'note.updated',
      payload: note,
    });
    return note;
  }

  async remove(actor: AuthActor, id: string): Promise<void> {
    const current = await this.authorization.requireNote(actor, id, 'member');
    const timestamp = now();
    const note = await this.updateNote(id, {
      deletedAt: timestamp,
      updatedAt: timestamp,
    });
    if (note)
      await this.activity.record({
        orgId: current.project.orgId,
        projectId: note.projectId,
        actorId: actor.user.id,
        kind: 'note.deleted',
        payload: note,
      });
  }

  async restore(actor: AuthActor, id: string) {
    const row = await this.findNote(id);
    if (!row || row.project.deletedAt) throw notFound('Note');
    await this.authorization.requireOrg(actor, row.project.orgId, 'member');
    if (!row.note.deletedAt) throw conflict('Note is not deleted');
    const timestamp = now();
    const note = await this.updateNote(id, {
      deletedAt: null,
      updatedAt: timestamp,
    });
    if (!note) throw notFound('Note');
    await this.activity.record({
      orgId: row.project.orgId,
      projectId: note.projectId,
      actorId: actor.user.id,
      kind: 'note.restored',
      payload: note,
    });
    return note;
  }

  private async findNote(id: string): Promise<{ note: Note; project: Project } | null> {
    const rows = await this.db
      .select({ note: notes, project: projects })
      .from(notes)
      .innerJoin(projects, eq(notes.projectId, projects.id))
      .where(eq(notes.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  private async updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
    await this.db.update(notes).set(patch).where(eq(notes.id, id));
    const note = await this.db.query.notes.findFirst({ where: eq(notes.id, id) });
    return note ?? null;
  }
}
