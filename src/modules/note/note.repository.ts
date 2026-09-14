import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { notes, projects, type Note, type Project } from "../../database/schema";

export class NoteRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(note: Note): Promise<void> {
    await this.database.db.insert(notes).values(note);
  }

  async list(projectId: string, cursor: { position: number; id: string } | null): Promise<Note[]> {
    const cursorCondition = cursor
      ? or(lt(notes.position, cursor.position), and(eq(notes.position, cursor.position), lt(notes.id, cursor.id)))
      : undefined;
    return this.database.db.query.notes.findMany({
      where: and(eq(notes.projectId, projectId), isNull(notes.deletedAt), cursorCondition),
      orderBy: [desc(notes.pinned), desc(notes.position), desc(notes.id)],
      limit: 201,
    });
  }

  async findAny(id: string): Promise<{ note: Note; project: Project } | null> {
    const rows = await this.database.db
      .select({ note: notes, project: projects })
      .from(notes)
      .innerJoin(projects, eq(notes.projectId, projects.id))
      .where(eq(notes.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Note>): Promise<Note | null> {
    await this.database.db.update(notes).set(patch).where(eq(notes.id, id));
    return (await this.database.db.query.notes.findFirst({ where: eq(notes.id, id) })) ?? null;
  }
}
