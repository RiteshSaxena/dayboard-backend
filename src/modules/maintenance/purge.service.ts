import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { authTokens, invites, notes, orgs, projects, sessions, tasks } from "../../database/schema";

const BATCH_SIZE = 500;
const RETENTION = 30 * 86_400_000;

export class PurgeService {
  constructor(private readonly database: DatabaseService) {}

  async run(timestamp = Date.now()): Promise<Record<string, number>> {
    const cutoff = timestamp - RETENTION;
    return {
      tasks: await this.purgeSoftDeleted(tasks, tasks.id, tasks.deletedAt, cutoff),
      notes: await this.purgeSoftDeleted(notes, notes.id, notes.deletedAt, cutoff),
      projects: await this.purgeSoftDeleted(projects, projects.id, projects.deletedAt, cutoff),
      orgs: await this.purgeSoftDeleted(orgs, orgs.id, orgs.deletedAt, cutoff),
      sessions: await this.purgeWhere(sessions, sessions.id, lt(sessions.expiresAt, timestamp)),
      authTokens: await this.purgeWhere(authTokens, authTokens.id, or(isNotNull(authTokens.usedAt), lt(authTokens.expiresAt, timestamp))!),
      invites: await this.purgeWhere(invites, invites.id, lt(invites.createdAt, cutoff)),
    };
  }

  private async purgeSoftDeleted<
    TTable extends typeof tasks | typeof notes | typeof projects | typeof orgs,
  >(
    table: TTable,
    idColumn: TTable["id"],
    deletedAtColumn: TTable["deletedAt"],
    cutoff: number,
  ): Promise<number> {
    return this.purgeWhere(table, idColumn, and(isNotNull(deletedAtColumn), lt(deletedAtColumn, cutoff))!);
  }

  private async purgeWhere<
    TTable extends typeof tasks | typeof notes | typeof projects | typeof orgs | typeof sessions | typeof authTokens | typeof invites,
  >(
    table: TTable,
    idColumn: TTable["id"],
    condition: import("drizzle-orm").SQL,
  ): Promise<number> {
    let deleted = 0;
    while (true) {
      const rows = await this.database.db.select({ id: idColumn }).from(table).where(condition).limit(BATCH_SIZE);
      if (rows.length === 0) return deleted;
      await this.database.db.delete(table).where(inArray(idColumn, rows.map((row) => row.id)));
      deleted += rows.length;
      if (rows.length < BATCH_SIZE) return deleted;
    }
  }
}
