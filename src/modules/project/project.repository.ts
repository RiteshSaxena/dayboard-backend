import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { notes, projects, tasks, type Project } from "../../database/schema";

export class ProjectRepository {
  constructor(private readonly database: DatabaseService) {}

  async countForOrg(orgId: string): Promise<number> {
    const rows = await this.database.db.select({ value: count() }).from(projects).where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));
    return rows[0]?.value ?? 0;
  }

  async create(project: Project): Promise<void> {
    await this.database.db.insert(projects).values(project);
  }

  async list(orgId: string): Promise<Project[]> {
    return this.database.db.query.projects.findMany({
      where: and(eq(projects.orgId, orgId), isNull(projects.deletedAt)),
      orderBy: [desc(projects.position), desc(projects.id)],
    });
  }

  async board(orgId: string) {
    const projectRows = await this.database.db.query.projects.findMany({
      where: and(eq(projects.orgId, orgId), isNull(projects.deletedAt), isNull(projects.archivedAt)),
      orderBy: [desc(projects.position), desc(projects.id)],
    });
    if (projectRows.length === 0) return { projects: [], tasks: [], notes: [] };
    const ids = projectRows.map((project) => project.id);
    const [taskRows, noteRows] = await Promise.all([
      this.database.db.query.tasks.findMany({
        where: and(inArray(tasks.projectId, ids), isNull(tasks.deletedAt), isNull(tasks.archivedAt)),
        orderBy: [desc(tasks.position), desc(tasks.id)],
      }),
      this.database.db.query.notes.findMany({
        where: and(inArray(notes.projectId, ids), isNull(notes.deletedAt)),
        orderBy: [desc(notes.pinned), desc(notes.position), desc(notes.id)],
      }),
    ]);
    return { projects: projectRows, tasks: taskRows, notes: noteRows };
  }

  async findAny(id: string): Promise<Project | null> {
    return (await this.database.db.query.projects.findFirst({ where: eq(projects.id, id) })) ?? null;
  }

  async update(id: string, patch: Partial<Project>): Promise<Project | null> {
    await this.database.db.update(projects).set(patch).where(eq(projects.id, id));
    return this.findAny(id);
  }
}
