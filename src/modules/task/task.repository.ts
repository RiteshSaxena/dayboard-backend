import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { projects, tasks, type Project, type Task } from "../../database/schema";

export class TaskRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(task: Task): Promise<void> {
    await this.database.db.insert(tasks).values(task);
  }

  async list(projectId: string, filter: { status?: Task["status"]; archived?: boolean; cursor: { position: number; id: string } | null }) {
    const conditions: SQL[] = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
    if (filter.status) conditions.push(eq(tasks.status, filter.status));
    if (filter.archived === true) conditions.push(isNotNull(tasks.archivedAt));
    if (filter.archived === false || filter.archived === undefined) conditions.push(isNull(tasks.archivedAt));
    if (filter.cursor) {
      conditions.push(or(
        lt(tasks.position, filter.cursor.position),
        and(eq(tasks.position, filter.cursor.position), lt(tasks.id, filter.cursor.id)),
      )!);
    }
    return this.database.db.query.tasks.findMany({
      where: and(...conditions), orderBy: [desc(tasks.position), desc(tasks.id)], limit: 201,
    });
  }

  async findAny(id: string): Promise<{ task: Task; project: Project } | null> {
    const rows = await this.database.db
      .select({ task: tasks, project: projects })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Task>): Promise<Task | null> {
    await this.database.db.update(tasks).set(patch).where(eq(tasks.id, id));
    return (await this.database.db.query.tasks.findFirst({ where: eq(tasks.id, id) })) ?? null;
  }

  async archiveDone(projectId: string, timestamp: number): Promise<number> {
    const result = await this.database.db
      .update(tasks)
      .set({ archivedAt: timestamp, updatedAt: timestamp })
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "done"), isNull(tasks.archivedAt), isNull(tasks.deletedAt)));
    return result.meta.changes;
  }

  async mine(orgId: string, userId: string): Promise<Task[]> {
    const rows = await this.database.db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(
        eq(projects.orgId, orgId), eq(tasks.assigneeId, userId), isNull(tasks.completedAt),
        isNull(tasks.archivedAt), isNull(tasks.deletedAt), isNull(projects.deletedAt),
      ))
      .orderBy(desc(tasks.position));
    return rows.map((row) => row.task);
  }
}
