import { and, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/database';
import {
  authTokens,
  comments,
  invites,
  notes,
  orgs,
  projects,
  sessions,
  tasks,
} from '../../database/schema';

const BATCH_SIZE = 500;
const RETENTION = 30 * 86_400_000;

export class PurgeService {
  constructor(private readonly db: DrizzleDB) {}

  async run(timestamp = Date.now()): Promise<Record<string, number>> {
    const cutoff = timestamp - RETENTION;

    const purgedComments = await this.purgeSoftDeleted(
      comments,
      comments.id,
      comments.deletedAt,
      cutoff,
    );
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
      comments: purgedComments,
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
    TTable extends typeof comments | typeof tasks | typeof notes | typeof projects | typeof orgs,
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
      | typeof comments
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
      // Select the batch in a subquery: an `IN (...)` list of IDs would exceed D1's limit of
      // 100 bound parameters per query.
      const batch = this.db.select({ id: idColumn }).from(table).where(condition).limit(BATCH_SIZE);
      const result = await this.db.delete(table).where(inArray(idColumn, batch));
      deleted += result.meta.changes;
      if (result.meta.changes < BATCH_SIZE) return deleted;
    }
  }
}
