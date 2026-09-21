import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type { DrizzleDB } from '../../database/database';
import {
  attachments,
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
// Uploads that were reserved but never confirmed.
const PENDING_UPLOAD_RETENTION = 86_400_000;

export class PurgeService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly files: R2Bucket,
  ) {}

  async run(timestamp = Date.now()): Promise<Record<string, number>> {
    const cutoff = timestamp - RETENTION;

    // Before their rows disappear through foreign-key cascades, so no R2 object is orphaned.
    const purgedAttachments = await this.purgeAttachments(cutoff, timestamp);

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
      attachments: purgedAttachments,
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

  /**
   * Removes the R2 object and row of every attachment that is soft-deleted past the cutoff, was
   * never confirmed, or belongs to a task, project, or org that this run is about to purge.
   */
  private async purgeAttachments(cutoff: number, timestamp: number): Promise<number> {
    const doomed = or(
      and(isNotNull(attachments.deletedAt), lt(attachments.deletedAt, cutoff)),
      and(
        eq(attachments.status, 'pending'),
        lt(attachments.createdAt, timestamp - PENDING_UPLOAD_RETENTION),
      ),
      and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoff)),
      and(isNotNull(projects.deletedAt), lt(projects.deletedAt, cutoff)),
      and(isNotNull(orgs.deletedAt), lt(orgs.deletedAt, cutoff)),
    )!;
    let deleted = 0;
    while (true) {
      const rows = await this.db
        .select({ id: attachments.id, key: attachments.key })
        .from(attachments)
        .innerJoin(tasks, eq(attachments.taskId, tasks.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .innerJoin(orgs, eq(attachments.orgId, orgs.id))
        .where(doomed)
        .limit(BATCH_SIZE);
      if (rows.length === 0) return deleted;
      await this.files.delete(rows.map((row) => row.key));
      await this.db.delete(attachments).where(
        inArray(
          attachments.id,
          rows.map((row) => row.id),
        ),
      );
      deleted += rows.length;
      if (rows.length < BATCH_SIZE) return deleted;
    }
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
