import { and, asc, count, eq, sql } from 'drizzle-orm';
import { badRequest, conflict } from '../../core/http/api-error';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { projectStages, tasks, type ProjectStage, type Task } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';

const MAX_STAGES = 20;

export type StageCategory = ProjectStage['category'];

// Keep in sync with the backfill in drizzle/0001_task_types_stages_subtasks_comments.sql.
const STARTER_STAGES: { name: string; category: StageCategory }[] = [
  { name: 'To do', category: 'todo' },
  { name: 'In progress', category: 'doing' },
  { name: 'Done', category: 'done' },
];

/** Stages every new project starts with. */
export function buildStarterStages(projectId: string, timestamp: number): ProjectStage[] {
  return STARTER_STAGES.map((stage, position) => ({
    id: createId(),
    projectId,
    name: stage.name,
    category: stage.category,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

/**
 * Columns to set when a task enters a stage. `status` mirrors the stage category so completion,
 * archiving, and status filters keep working. `completedAt` is kept when moving between done stages.
 */
export function stageAssignment(stage: ProjectStage, timestamp: number) {
  return {
    stageId: stage.id,
    status: stage.category,
    completedAt:
      stage.category === 'done' ? sql`coalesce(${tasks.completedAt}, ${timestamp})` : null,
  };
}

export class StageService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
  ) {}

  async list(actor: AuthActor, projectId: string) {
    await this.authorization.requireProject(actor, projectId);
    return this.listStages(projectId);
  }

  async create(
    actor: AuthActor,
    projectId: string,
    input: { name: string; category: StageCategory },
  ) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'admin');
    const existing = await this.listStages(projectId);
    if (existing.length >= MAX_STAGES) {
      throw conflict('This project has reached its stage limit');
    }
    this.assertUniqueName(existing, input.name);
    const timestamp = now();
    const stage: ProjectStage = {
      id: createId(),
      projectId,
      name: input.name,
      category: input.category,
      position: (existing.at(-1)?.position ?? -1) + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.insert(projectStages).values(stage);
    await this.activity.record({
      orgId: project.orgId,
      projectId,
      actorId: actor.user.id,
      kind: 'stage.created',
      payload: stage,
    });
    return stage;
  }

  async update(actor: AuthActor, id: string, input: { name?: string; category?: StageCategory }) {
    const { stage, project } = await this.authorization.requireStage(actor, id, 'admin');
    if (input.name !== undefined) {
      const siblings = await this.listStages(stage.projectId);
      this.assertUniqueName(
        siblings.filter((sibling) => sibling.id !== id),
        input.name,
      );
    }
    const timestamp = now();
    const updated: ProjectStage = { ...stage, ...input, updatedAt: timestamp };
    const updateStage = this.db
      .update(projectStages)
      .set({ ...input, updatedAt: timestamp })
      .where(eq(projectStages.id, id));
    if (input.category && input.category !== stage.category) {
      await this.db.batch([
        updateStage,
        this.db
          .update(tasks)
          .set({ ...stageAssignment(updated, timestamp), updatedAt: timestamp })
          .where(eq(tasks.stageId, id)),
      ]);
    } else {
      await updateStage;
    }
    await this.activity.record({
      orgId: project.orgId,
      projectId: stage.projectId,
      actorId: actor.user.id,
      kind: 'stage.updated',
      payload: updated,
    });
    return updated;
  }

  async reorder(actor: AuthActor, projectId: string, stageIds: string[]) {
    const { project } = await this.authorization.requireProject(actor, projectId, 'admin');
    const existing = await this.listStages(projectId);
    const existingIds = new Set(existing.map((stage) => stage.id));
    if (
      new Set(stageIds).size !== stageIds.length ||
      stageIds.length !== existing.length ||
      !stageIds.every((stageId) => existingIds.has(stageId))
    ) {
      throw badRequest('stageIds must list every stage in the project exactly once', 'stageIds');
    }
    const timestamp = now();
    const [first, ...rest] = stageIds.map((stageId, position) =>
      this.db
        .update(projectStages)
        .set({ position, updatedAt: timestamp })
        .where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId))),
    );
    if (first) await this.db.batch([first, ...rest]);
    const stages = await this.listStages(projectId);
    await this.activity.record({
      orgId: project.orgId,
      projectId,
      actorId: actor.user.id,
      kind: 'stage.reordered',
      payload: { stageIds },
    });
    return stages;
  }

  async remove(actor: AuthActor, id: string, moveTo?: string): Promise<void> {
    const { stage, project } = await this.authorization.requireStage(actor, id, 'admin');
    const stages = await this.listStages(stage.projectId);
    if (stages.length <= 1) throw conflict('A project must have at least one stage');

    // Archived and deleted tasks count too, so a later restore never points at a missing stage.
    const [usage] = await this.db
      .select({ value: count() })
      .from(tasks)
      .where(eq(tasks.stageId, id));
    const timestamp = now();
    const deleteStage = this.db.delete(projectStages).where(eq(projectStages.id, id));
    if ((usage?.value ?? 0) > 0) {
      if (!moveTo) throw conflict("Choose a stage to move this stage's tasks to", 'moveTo');
      const target = stages.find((candidate) => candidate.id === moveTo && candidate.id !== id);
      if (!target) throw badRequest('moveTo must be another stage in this project', 'moveTo');
      await this.db.batch([
        this.db
          .update(tasks)
          .set({ ...stageAssignment(target, timestamp), updatedAt: timestamp })
          .where(eq(tasks.stageId, id)),
        deleteStage,
      ]);
    } else {
      await deleteStage;
    }
    await this.activity.record({
      orgId: project.orgId,
      projectId: stage.projectId,
      actorId: actor.user.id,
      kind: 'stage.deleted',
      payload: { ...stage, movedTo: usage?.value ? (moveTo ?? null) : null },
    });
  }

  /** Picks the stage for a new or moved task from an explicit stageId or a legacy status. */
  async resolveForTask(
    projectId: string,
    input: { stageId?: string; status?: Task['status'] },
  ): Promise<ProjectStage> {
    const stages = await this.listStages(projectId);
    if (input.stageId) {
      const stage = stages.find((candidate) => candidate.id === input.stageId);
      if (!stage) throw conflict('Stage does not belong to this project', 'stageId');
      return stage;
    }
    if (input.status) {
      const stage = stages.find((candidate) => candidate.category === input.status);
      if (!stage) throw conflict(`This project has no ${input.status} stage`, 'status');
      return stage;
    }
    const [firstStage] = stages;
    if (!firstStage) throw conflict('This project has no stages');
    return firstStage;
  }

  /** Maps a task moving to another project onto the first stage with the same category. */
  async mapForProject(projectId: string): Promise<(category: StageCategory) => ProjectStage> {
    const stages = await this.listStages(projectId);
    const [firstStage] = stages;
    if (!firstStage) throw conflict('The target project has no stages', 'projectId');
    return (category) => stages.find((stage) => stage.category === category) ?? firstStage;
  }

  listStages(projectId: string): Promise<ProjectStage[]> {
    return this.db.query.projectStages.findMany({
      where: eq(projectStages.projectId, projectId),
      orderBy: [asc(projectStages.position), asc(projectStages.id)],
    });
  }

  private assertUniqueName(stages: ProjectStage[], name: string): void {
    const normalized = name.trim().toLowerCase();
    if (stages.some((stage) => stage.name.trim().toLowerCase() === normalized)) {
      throw conflict('A stage with this name already exists', 'name');
    }
  }
}
