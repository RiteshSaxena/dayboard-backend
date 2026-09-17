import { and, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/database';
import { authTokens, invites, notes, orgs, projects, sessions, tasks } from '../../database/schema';

const BATCH_SIZE = 500;
const RETENTION = 30 * 86_400_000;

export class PurgeService {
  constructor(private readonly db: DrizzleDB) {}

  async run(timestamp = Date.now()): Promise<Record<string, number>> {
    const cutoff = timestamp - RETENTION;

    const purgedTasks = await this.purgeSoftDeleted(tasks, tasks.id, tasks.deletedAt, cutoff);
    const purgedNotes = await this.purgeSoftDeleted(notes, notes.id, notes.deletedAt, cutoff);
    const purgedProjects = await this.purgeSoftDeleted(
      projects,
      projects.id,
      projects.deletedAt,
      cutoff,
    );
    const purgedOrgs = await this.purgeSoftDeleted(orgs, orgs.id, orgs.deletedAt, cutoff);
    const expiredSession = lt(sessions.expiresAt, timestamp);
    const purgedSessions = await this.purgeWhere(sessions, sessions.id, expiredSession);
    const expiredAuthToken = or(isNotNull(authTokens.usedAt), lt(authTokens.expiresAt, timestamp))!;
    const purgedAuthTokens = await this.purgeWhere(authTokens, authTokens.id, expiredAuthToken);
    const oldInvite = lt(invites.createdAt, cutoff);
    const purgedInvites = await this.purgeWhere(invites, invites.id, oldInvite);

    return {
      tasks: purgedTasks,
      notes: purgedNotes,
      projects: purgedProjects,
      orgs: purgedOrgs,
      sessions: purgedSessions,
      authTokens: purgedAuthTokens,
      invites: purgedInvites,
    };
  }

  private async purgeSoftDeleted<
    TTable extends typeof tasks | typeof notes | typeof projects | typeof orgs,
  >(
    table: TTable,
    idColumn: TTable['id'],
    deletedAtColumn: TTable['deletedAt'],
    cutoff: number,
  ): Promise<number> {
    return this.purgeWhere(
      table,
      idColumn,
      and(isNotNull(deletedAtColumn), lt(deletedAtColumn, cutoff))!,
    );
  }

  private async purgeWhere<
    TTable extends
      | typeof tasks
      | typeof notes
      | typeof projects
      | typeof orgs
      | typeof sessions
      | typeof authTokens
      | typeof invites,
  >(table: TTable, idColumn: TTable['id'], condition: import('drizzle-orm').SQL): Promise<number> {
    let deleted = 0;
    while (true) {
      const rows = await this.db
        .select({ id: idColumn })
        .from(table)
        .where(condition)
        .limit(BATCH_SIZE);
      if (rows.length === 0) return deleted;
      await this.db.delete(table).where(
        inArray(
          idColumn,
          rows.map((row) => row.id),
        ),
      );
      deleted += rows.length;
      if (rows.length < BATCH_SIZE) return deleted;
    }
  }
}
