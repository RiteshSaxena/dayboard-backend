import { and, desc, eq, lt, or } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { activity } from "../../database/schema";

export class ActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(row: typeof activity.$inferInsert): Promise<void> {
    await this.database.db.insert(activity).values(row);
  }

  async list(projectId: string, cursor: { createdAt: number; id: string } | null) {
    const cursorCondition = cursor
      ? or(lt(activity.createdAt, cursor.createdAt), and(eq(activity.createdAt, cursor.createdAt), lt(activity.id, cursor.id)))
      : undefined;
    return this.database.db.query.activity.findMany({
      where: and(eq(activity.projectId, projectId), cursorCondition),
      orderBy: [desc(activity.createdAt), desc(activity.id)],
      limit: 201,
    });
  }
}
