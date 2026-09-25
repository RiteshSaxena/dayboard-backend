import { env } from 'cloudflare:workers';
import { describe, it } from 'vitest';
import { createDatabase } from '../src/database/database';
import { PurgeService } from '../src/modules/maintenance/purge.service';
import { seedOrg, type Api, type SeededOrg } from './helpers';

const DAY = 86_400_000;

async function createProject(api: Api, orgId: string, name = 'Website') {
  const response = await api('POST', `/api/orgs/${orgId}/projects`, { name, color: 'moss' });
  if (response.status !== 201) throw new Error(`project create failed: ${response.status}`);
  return response.body.data as { id: string; key: string; stages: { id: string; name: string }[] };
}

async function createTask(api: Api, projectId: string, body: Record<string, unknown> = {}) {
  const response = await api('POST', `/api/projects/${projectId}/tasks`, {
    title: 'Task',
    ...body,
  });
  if (response.status !== 201) {
    throw new Error(`task create failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

describe('custom stages', () => {
  let org: SeededOrg;

  it('creates default stages and maps legacy status onto them', async ({ expect }) => {
    org = await seedOrg();
    const { owner } = org.users;
    const project = await createProject(owner.api, org.orgId);
    expect(project.stages.map((stage) => stage.name)).toEqual(['To do', 'In progress', 'Done']);

    const defaultTask = await createTask(owner.api, project.id);
    expect(defaultTask.stageId).toBe(project.stages[0]?.id);
    expect(defaultTask.status).toBe('todo');

    const doneTask = await createTask(owner.api, project.id, { status: 'done' });
    expect(doneTask.stageId).toBe(project.stages[2]?.id);
    expect(doneTask.completedAt).toEqual(expect.any(Number));

    const both = await owner.api('POST', `/api/projects/${project.id}/tasks`, {
      title: 'x',
      status: 'todo',
      stageId: project.stages[0]?.id,
    });
    expect(both.status).toBe(422);

    const board = await owner.api('GET', `/api/orgs/${org.orgId}/board`);
    expect(board.body.data.stages).toHaveLength(3);
  });

  it('manages stages and keeps task status in sync', async ({ expect }) => {
    org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const [todo, , done] = project.stages;

    expect(
      (
        await member.api('POST', `/api/projects/${project.id}/stages`, {
          name: 'Review',
          category: 'doing',
        })
      ).status,
    ).toBe(403);
    const review = await owner.api('POST', `/api/projects/${project.id}/stages`, {
      name: 'Review',
      category: 'doing',
    });
    expect(review.status).toBe(201);
    expect(review.body.data.position).toBe(3);
    const duplicate = await owner.api('POST', `/api/projects/${project.id}/stages`, {
      name: 'review',
      category: 'todo',
    });
    expect(duplicate.status).toBe(409);

    const task = await createTask(member.api, project.id);
    const moved = await member.api('POST', `/api/tasks/${task.id}/move`, {
      stageId: review.body.data.id,
    });
    expect(moved.body.data).toMatchObject({ stageId: review.body.data.id, status: 'doing' });

    const toDone = await member.api('POST', `/api/tasks/${task.id}/move`, { stageId: done?.id });
    const completedAt = toDone.body.data.completedAt;
    expect(completedAt).toEqual(expect.any(Number));

    const shipped = await owner.api('POST', `/api/projects/${project.id}/stages`, {
      name: 'Shipped',
      category: 'done',
    });
    const toShipped = await member.api('POST', `/api/tasks/${task.id}/move`, {
      stageId: shipped.body.data.id,
    });
    expect(toShipped.body.data.completedAt).toBe(completedAt);

    const other = await createProject(owner.api, org.orgId, 'Other');
    const foreignStage = await member.api('POST', `/api/tasks/${task.id}/move`, {
      stageId: other.stages[0]?.id,
    });
    expect(foreignStage.status).toBe(409);

    // Changing a stage's category updates the tasks in it.
    const inReview = await createTask(member.api, project.id, { stageId: review.body.data.id });
    const recategorized = await owner.api('PATCH', `/api/stages/${review.body.data.id}`, {
      category: 'done',
    });
    expect(recategorized.status).toBe(200);
    const tasks = await member.api('GET', `/api/projects/${project.id}/tasks?status=done`);
    const refreshed = tasks.body.data.items.find((item: { id: string }) => item.id === inReview.id);
    expect(refreshed).toMatchObject({ status: 'done', completedAt: expect.any(Number) });

    // Reorder must list every stage exactly once.
    const stages = await owner.api('GET', `/api/projects/${project.id}/stages`);
    const ids: string[] = stages.body.data.map((stage: { id: string }) => stage.id);
    expect(
      (
        await owner.api('POST', `/api/projects/${project.id}/stages/reorder`, {
          stageIds: ids.slice(1),
        })
      ).status,
    ).toBe(422);
    const reordered = await owner.api('POST', `/api/projects/${project.id}/stages/reorder`, {
      stageIds: [...ids].reverse(),
    });
    expect(reordered.body.data.map((stage: { id: string }) => stage.id)).toEqual(
      [...ids].reverse(),
    );

    // Deleting a stage that has tasks needs a destination.
    const blocked = await owner.api('DELETE', `/api/stages/${review.body.data.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.field).toBe('moveTo');
    const deleted = await owner.api(
      'DELETE',
      `/api/stages/${shipped.body.data.id}?moveTo=${todo?.id}`,
    );
    expect(deleted.status).toBe(200);
    const afterDelete = await member.api('GET', `/api/projects/${project.id}/tasks`);
    const movedTask = afterDelete.body.data.items.find(
      (item: { id: string }) => item.id === task.id,
    );
    expect(movedTask).toMatchObject({ stageId: todo?.id, status: 'todo', completedAt: null });
  });

  it('refuses to delete the last stage', async ({ expect }) => {
    org = await seedOrg();
    const { owner } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const [first, second, third] = project.stages;
    expect((await owner.api('DELETE', `/api/stages/${second?.id}`)).status).toBe(200);
    expect((await owner.api('DELETE', `/api/stages/${third?.id}`)).status).toBe(200);
    expect((await owner.api('DELETE', `/api/stages/${first?.id}`)).status).toBe(409);
  });

  it('maps stages when a task moves to another project', async ({ expect }) => {
    org = await seedOrg();
    const { owner } = org.users;
    const source = await createProject(owner.api, org.orgId, 'Source');
    const target = await createProject(owner.api, org.orgId, 'Target');
    const task = await createTask(owner.api, source.id, { status: 'doing' });
    const moved = await owner.api('PATCH', `/api/tasks/${task.id}`, { projectId: target.id });
    expect(moved.body.data).toMatchObject({
      projectId: target.id,
      stageId: target.stages[1]?.id,
      status: 'doing',
    });
  });
});

describe('task types', () => {
  it('gives new orgs the starter task types', async ({ expect }) => {
    const { users } = await seedOrg();
    const created = await users.owner.api('POST', '/api/orgs', { name: 'Fresh Org' });
    expect(created.status).toBe(201);
    const types = await users.owner.api('GET', `/api/orgs/${created.body.data.id}/task-types`);
    expect(types.body.data.map((type: { name: string; color: string }) => type.name)).toEqual([
      'Task',
      'Bug',
      'Feature',
      'Story',
    ]);
    const board = await users.owner.api('GET', `/api/orgs/${created.body.data.id}/board`);
    expect(board.body.data.taskTypes).toHaveLength(4);
  });

  it('manages org task types and assigns them to tasks', async ({ expect }) => {
    const org = await seedOrg();
    const other = await seedOrg();
    const { owner, admin, member } = org.users;

    expect(
      (await member.api('POST', `/api/orgs/${org.orgId}/task-types`, { name: 'Bug', color: 'red' }))
        .status,
    ).toBe(403);
    const bug = await admin.api('POST', `/api/orgs/${org.orgId}/task-types`, {
      name: 'Bug',
      color: 'red',
    });
    expect(bug.status).toBe(201);
    const feature = await admin.api('POST', `/api/orgs/${org.orgId}/task-types`, {
      name: 'Feature',
      color: 'blue',
    });
    expect(
      (await admin.api('POST', `/api/orgs/${org.orgId}/task-types`, { name: 'BUG', color: 'x' }))
        .status,
    ).toBe(409);

    const reordered = await admin.api('POST', `/api/orgs/${org.orgId}/task-types/reorder`, {
      taskTypeIds: [feature.body.data.id, bug.body.data.id],
    });
    expect(reordered.body.data.map((type: { name: string }) => type.name)).toEqual([
      'Feature',
      'Bug',
    ]);

    const renamed = await admin.api('PATCH', `/api/task-types/${bug.body.data.id}`, {
      name: 'Defect',
    });
    expect(renamed.body.data.name).toBe('Defect');

    const project = await createProject(owner.api, org.orgId);
    const typed = await createTask(member.api, project.id, { typeId: bug.body.data.id });
    await createTask(member.api, project.id);
    const filtered = await member.api(
      'GET',
      `/api/projects/${project.id}/tasks?typeId=${bug.body.data.id}`,
    );
    expect(filtered.body.data.items.map((item: { id: string }) => item.id)).toEqual([typed.id]);

    const foreignType = await other.users.admin.api('POST', `/api/orgs/${other.orgId}/task-types`, {
      name: 'Chore',
      color: 'grey',
    });
    const rejected = await member.api('PATCH', `/api/tasks/${typed.id}`, {
      typeId: foreignType.body.data.id,
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.field).toBe('typeId');

    expect((await admin.api('DELETE', `/api/task-types/${bug.body.data.id}`)).status).toBe(200);
    const board = await member.api('GET', `/api/orgs/${org.orgId}/board`);
    expect(board.body.data.taskTypes).toHaveLength(1);
    const untyped = board.body.data.tasks.find((item: { id: string }) => item.id === typed.id);
    expect(untyped.typeId).toBeNull();
  });
});

describe('task priority', () => {
  it('defaults to normal, filters, and records changes', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);

    const plain = await createTask(member.api, project.id, { title: 'Plain' });
    expect(plain.priority).toBe('normal');
    const urgent = await createTask(member.api, project.id, { title: 'Now', priority: 'urgent' });
    expect(urgent.priority).toBe('urgent');

    const bad = await member.api('POST', `/api/projects/${project.id}/tasks`, {
      title: 'Bad',
      priority: 'panic',
    });
    expect(bad.status).toBe(422);

    const filtered = await member.api('GET', `/api/projects/${project.id}/tasks?priority=urgent`);
    expect(filtered.body.data.items.map((item: { id: string }) => item.id)).toEqual([urgent.id]);

    const raised = await member.api('PATCH', `/api/tasks/${plain.id}`, { priority: 'high' });
    expect(raised.body.data.priority).toBe('high');
    const history = await member.api('GET', `/api/tasks/${plain.id}/activity`);
    const changes = history.body.data.items.flatMap(
      (item: { payload: { changes?: { field: string; to?: string }[] } }) =>
        item.payload.changes ?? [],
    );
    expect(changes).toContainEqual({ field: 'priority', from: 'normal', to: 'high' });
  });
});

describe('task keys', () => {
  it('numbers tasks per project and keeps the key when a task moves', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member, guest } = org.users;
    const source = await createProject(owner.api, org.orgId, 'Website');
    const target = await createProject(owner.api, org.orgId, 'Api');
    expect(source.key).toMatch(/^W[A-Z2-9]{2}$/);
    expect(target.key).toMatch(/^A[A-Z2-9]{2}$/);
    expect(source.key).not.toBe(target.key);

    const first = await createTask(member.api, source.id, { title: 'First' });
    const second = await createTask(member.api, source.id, { title: 'Second' });
    const elsewhere = await createTask(member.api, target.id, { title: 'Elsewhere' });
    expect([first.number, second.number, elsewhere.number]).toEqual([1, 2, 1]);
    expect(first.key).toBe(`${source.key}-1`);
    expect(elsewhere.key).toBe(`${target.key}-1`);

    // Subtasks take their own number from the same project.
    const subtask = (await member.api('POST', `/api/tasks/${first.id}/subtasks`, { title: 'Sub' }))
      .body.data;
    expect(subtask.key).toBe(`${source.key}-3`);

    const found = await guest.api('GET', `/api/orgs/${org.orgId}/tasks/by-key/${first.key}`);
    expect(found.status).toBe(200);
    expect(found.body.data).toMatchObject({ id: first.id, key: first.key, orgId: org.orgId });
    const lowercase = await guest.api(
      'GET',
      `/api/orgs/${org.orgId}/tasks/by-key/${first.key.toLowerCase()}`,
    );
    expect(lowercase.body.data.id).toBe(first.id);

    // The key belongs to the task, not to wherever it currently lives.
    const moved = await member.api('PATCH', `/api/tasks/${first.id}`, { projectId: target.id });
    expect(moved.body.data).toMatchObject({ projectId: target.id, key: `${source.key}-1` });
    expect(
      (await guest.api('GET', `/api/orgs/${org.orgId}/tasks/by-key/${first.key}`)).status,
    ).toBe(200);
    // ... and the target project keeps its own sequence, so nothing collides.
    const next = await createTask(member.api, target.id, { title: 'Next' });
    expect(next.key).toBe(`${target.key}-2`);

    const board = await guest.api('GET', `/api/orgs/${org.orgId}/board`);
    const keys = board.body.data.tasks.map((task: { key: string }) => task.key).sort();
    expect(keys).toEqual(
      [
        `${source.key}-1`,
        `${source.key}-2`,
        `${source.key}-3`,
        `${target.key}-1`,
        `${target.key}-2`,
      ].sort(),
    );

    expect(
      (await guest.api('GET', `/api/orgs/${org.orgId}/tasks/by-key/${source.key}-99`)).status,
    ).toBe(404);
    expect((await guest.api('GET', `/api/orgs/${org.orgId}/tasks/by-key/nonsense`)).status).toBe(
      404,
    );
    const other = await seedOrg();
    expect(
      (await other.users.owner.api('GET', `/api/orgs/${org.orgId}/tasks/by-key/${first.key}`))
        .status,
    ).toBe(404);
  });

  it('gives every project in an org a distinct key', async ({ expect }) => {
    const org = await seedOrg();
    const { owner } = org.users;
    const names = ['Website', 'Web app', 'Web tools', '2026 launch'];
    const created = [];
    for (const name of names) created.push(await createProject(owner.api, org.orgId, name));
    const keys = created.map((project) => project.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[3]).toMatch(/^P[A-Z2-9]{2}$/);
  });
});

describe('task ordering', () => {
  async function setPositions(positions: Record<string, number>) {
    await env.DB.batch(
      Object.entries(positions).map(([taskId, position]) =>
        env.DB.prepare('UPDATE tasks SET position = ? WHERE id = ?').bind(position, taskId),
      ),
    );
  }

  it('places tasks next to a neighbour and renumbers when out of room', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const [todo, doing] = project.stages;
    const [a, b, c] = [
      await createTask(member.api, project.id, { title: 'A' }),
      await createTask(member.api, project.id, { title: 'B' }),
      await createTask(member.api, project.id, { title: 'C' }),
    ];
    await setPositions({ [a.id]: 3000, [b.id]: 2000, [c.id]: 1000 });
    const column = async (stageId = todo!.id) =>
      (
        await member.api('GET', `/api/projects/${project.id}/tasks?stageId=${stageId}`)
      ).body.data.items.map((item: { title: string }) => item.title);
    expect(await column()).toEqual(['A', 'B', 'C']);

    const between = await member.api('POST', `/api/tasks/${c.id}/move`, {
      stageId: todo!.id,
      afterTaskId: a.id,
    });
    expect(between.status).toBe(200);
    expect(between.body.data.position).toBe(2500);
    expect(await column()).toEqual(['A', 'C', 'B']);

    await member.api('POST', `/api/tasks/${b.id}/move`, { stageId: todo!.id, beforeTaskId: a.id });
    expect(await column()).toEqual(['B', 'A', 'C']);

    // Adjacent positions leave no room, so the column is renumbered.
    await setPositions({ [b.id]: 11, [a.id]: 10, [c.id]: 9 });
    await member.api('POST', `/api/tasks/${c.id}/move`, { stageId: todo!.id, beforeTaskId: a.id });
    expect(await column()).toEqual(['B', 'C', 'A']);
    const positions = (
      await member.api('GET', `/api/projects/${project.id}/tasks?stageId=${todo!.id}`)
    ).body.data.items.map((item: { position: number }) => item.position);
    expect(positions[0] - positions[1]).toBe(1024);
    expect(positions[1] - positions[2]).toBe(1024);

    // Moving into another stage can also pick a spot.
    const d = await createTask(member.api, project.id, { title: 'D', stageId: doing!.id });
    const e = await createTask(member.api, project.id, { title: 'E', stageId: doing!.id });
    await setPositions({ [d.id]: 5000, [e.id]: 4000 });
    await member.api('POST', `/api/tasks/${a.id}/move`, { stageId: doing!.id, afterTaskId: d.id });
    expect(await column(doing!.id)).toEqual(['D', 'A', 'E']);
    expect(await column()).toEqual(['B', 'C']);
  });

  it('rejects bad neighbours and skips history for pure reorders', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const [todo, doing] = project.stages;
    const a = await createTask(member.api, project.id, { title: 'A' });
    const b = await createTask(member.api, project.id, { title: 'B' });
    const elsewhere = await createTask(member.api, project.id, {
      title: 'Elsewhere',
      stageId: doing!.id,
    });

    const wrongStage = await member.api('POST', `/api/tasks/${a.id}/move`, {
      stageId: todo!.id,
      afterTaskId: elsewhere.id,
    });
    expect(wrongStage.status).toBe(409);
    expect(wrongStage.body.error.field).toBe('afterTaskId');

    const self = await member.api('POST', `/api/tasks/${a.id}/move`, {
      stageId: todo!.id,
      beforeTaskId: a.id,
    });
    expect(self.status).toBe(422);

    const both = await member.api('POST', `/api/tasks/${a.id}/move`, {
      stageId: todo!.id,
      beforeTaskId: b.id,
      afterTaskId: b.id,
    });
    expect(both.status).toBe(422);

    const before = await member.api('GET', `/api/tasks/${a.id}/activity`);
    await member.api('POST', `/api/tasks/${a.id}/move`, { stageId: todo!.id, afterTaskId: b.id });
    const after = await member.api('GET', `/api/tasks/${a.id}/activity`);
    expect(after.body.data.items).toHaveLength(before.body.data.items.length);
  });

  it('reorders subtasks within their parent', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const [todo] = project.stages;
    const parent = await createTask(member.api, project.id, { title: 'Parent' });
    const other = await createTask(member.api, project.id, { title: 'Other' });
    const subtask = async (title: string) =>
      (await member.api('POST', `/api/tasks/${parent.id}/subtasks`, { title })).body.data;
    const [one, two, three] = [await subtask('One'), await subtask('Two'), await subtask('Three')];
    await setPositions({ [one.id]: 1000, [two.id]: 2000, [three.id]: 3000 });
    const order = async () =>
      (await member.api('GET', `/api/tasks/${parent.id}/subtasks`)).body.data.map(
        (item: { title: string }) => item.title,
      );

    await member.api('POST', `/api/tasks/${three.id}/move`, {
      stageId: todo!.id,
      beforeTaskId: one.id,
    });
    expect(await order()).toEqual(['Three', 'One', 'Two']);

    const notSibling = await member.api('POST', `/api/tasks/${one.id}/move`, {
      stageId: todo!.id,
      afterTaskId: other.id,
    });
    expect(notSibling.status).toBe(409);
  });
});

describe('subtasks', () => {
  it('creates subtasks and reports counts on parents', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const parent = await createTask(member.api, project.id, { title: 'Parent' });

    const first = await member.api('POST', `/api/tasks/${parent.id}/subtasks`, { title: 'One' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ parentId: parent.id, projectId: project.id });
    await member.api('POST', `/api/tasks/${parent.id}/subtasks`, { title: 'Two' });
    await member.api('POST', `/api/tasks/${first.body.data.id}/move`, { status: 'done' });

    const nested = await member.api('POST', `/api/tasks/${first.body.data.id}/subtasks`, {
      title: 'Nested',
    });
    expect(nested.status).toBe(409);

    const subtasks = await member.api('GET', `/api/tasks/${parent.id}/subtasks`);
    expect(subtasks.body.data.map((item: { title: string }) => item.title)).toEqual(['One', 'Two']);

    const list = await member.api('GET', `/api/projects/${project.id}/tasks`);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({
      id: parent.id,
      subtaskCount: 2,
      subtaskDoneCount: 1,
    });

    const board = await member.api('GET', `/api/orgs/${org.orgId}/board`);
    const boardTasks = board.body.data.tasks as { id: string; parentId: string | null }[];
    expect(boardTasks).toHaveLength(3);
    expect(boardTasks.find((item) => item.id === parent.id)).toMatchObject({
      subtaskCount: 2,
      subtaskDoneCount: 1,
    });
    expect(boardTasks.filter((item) => item.parentId === parent.id)).toHaveLength(2);
  });

  it('gets one task with its subtask counts, including archived tasks', async ({ expect }) => {
    const org = await seedOrg();
    const other = await seedOrg();
    const { owner, member, guest } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const parent = await createTask(member.api, project.id, { title: 'Parent', status: 'done' });
    const child = (await member.api('POST', `/api/tasks/${parent.id}/subtasks`, { title: 'Child' }))
      .body.data;
    await member.api('POST', `/api/tasks/${child.id}/move`, { status: 'done' });
    await member.api('POST', `/api/tasks/${parent.id}/archive`);

    const fetched = await guest.api('GET', `/api/tasks/${parent.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data).toMatchObject({
      id: parent.id,
      title: 'Parent',
      subtaskCount: 1,
      subtaskDoneCount: 1,
      orgId: org.orgId,
    });
    expect(fetched.body.data.archivedAt).toEqual(expect.any(Number));
    expect((await guest.api('GET', `/api/tasks/${child.id}`)).body.data).toMatchObject({
      parentId: parent.id,
      subtaskCount: 0,
    });

    expect((await other.users.owner.api('GET', `/api/tasks/${parent.id}`)).status).toBe(404);
    await member.api('DELETE', `/api/tasks/${parent.id}`);
    expect((await guest.api('GET', `/api/tasks/${parent.id}`)).status).toBe(404);
  });

  it('archives, deletes, restores, and moves subtasks with their parent', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const target = await createProject(owner.api, org.orgId, 'Target');
    const parent = await createTask(member.api, project.id, { status: 'done' });
    const kept = (await member.api('POST', `/api/tasks/${parent.id}/subtasks`, { title: 'Kept' }))
      .body.data;
    const removedEarlier = (
      await member.api('POST', `/api/tasks/${parent.id}/subtasks`, { title: 'Removed' })
    ).body.data;

    expect((await member.api('POST', `/api/tasks/${kept.id}/archive`)).status).toBe(409);
    expect(
      (await member.api('PATCH', `/api/tasks/${kept.id}`, { projectId: target.id })).status,
    ).toBe(409);

    const archived = await member.api('POST', `/api/projects/${project.id}/tasks/archive-done`);
    expect(archived.body.data.count).toBe(1);
    let subtasks = await member.api('GET', `/api/tasks/${parent.id}/subtasks`);
    expect(subtasks.body.data.every((item: { archivedAt: number | null }) => item.archivedAt)).toBe(
      true,
    );
    await member.api('POST', `/api/tasks/${parent.id}/unarchive`);
    subtasks = await member.api('GET', `/api/tasks/${parent.id}/subtasks`);
    expect(
      subtasks.body.data.every((item: { archivedAt: number | null }) => !item.archivedAt),
    ).toBe(true);

    await member.api('DELETE', `/api/tasks/${removedEarlier.id}`);
    await member.api('DELETE', `/api/tasks/${parent.id}`);
    expect((await member.api('POST', `/api/tasks/${kept.id}/restore`)).status).toBe(409);
    expect((await member.api('POST', `/api/tasks/${parent.id}/restore`)).status).toBe(200);
    subtasks = await member.api('GET', `/api/tasks/${parent.id}/subtasks`);
    expect(subtasks.body.data.map((item: { id: string }) => item.id)).toEqual([kept.id]);

    const moved = await member.api('PATCH', `/api/tasks/${parent.id}`, { projectId: target.id });
    expect(moved.body.data.projectId).toBe(target.id);
    subtasks = await member.api('GET', `/api/tasks/${parent.id}/subtasks`);
    expect(subtasks.body.data[0]).toMatchObject({
      projectId: target.id,
      stageId: target.stages[0]?.id,
    });
  });
});

describe('comments', () => {
  it('enforces comment permissions and paging shape', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, admin, member, guest } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const task = await createTask(member.api, project.id);

    const created = await member.api('POST', `/api/tasks/${task.id}/comments`, {
      body: '  Looks good  ',
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      taskId: task.id,
      body: 'Looks good',
      author: { id: member.id, name: 'member user' },
    });
    const commentId = created.body.data.id;

    expect((await guest.api('POST', `/api/tasks/${task.id}/comments`, { body: 'hi' })).status).toBe(
      403,
    );
    expect(
      (await member.api('POST', `/api/tasks/${task.id}/comments`, { body: '   ' })).status,
    ).toBe(422);
    const listed = await guest.api('GET', `/api/tasks/${task.id}/comments`);
    expect(listed.body.data).toMatchObject({ items: [{ id: commentId }], cursor: null });

    expect(
      (await admin.api('PATCH', `/api/comments/${commentId}`, { body: 'Hijacked' })).status,
    ).toBe(403);
    const edited = await member.api('PATCH', `/api/comments/${commentId}`, { body: 'Edited' });
    expect(edited.body.data.body).toBe('Edited');

    const ownerComment = await owner.api('POST', `/api/tasks/${task.id}/comments`, {
      body: 'Owner note',
    });
    expect((await member.api('DELETE', `/api/comments/${ownerComment.body.data.id}`)).status).toBe(
      403,
    );
    expect((await admin.api('DELETE', `/api/comments/${commentId}`)).status).toBe(200);
    const remaining = await member.api('GET', `/api/tasks/${task.id}/comments`);
    expect(remaining.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      ownerComment.body.data.id,
    ]);

    const activity = await member.api('GET', `/api/projects/${project.id}/activity`);
    const kinds = activity.body.data.items.map((item: { kind: string }) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(['comment.created', 'comment.deleted']));

    await member.api('DELETE', `/api/tasks/${task.id}`);
    expect((await member.api('GET', `/api/tasks/${task.id}/comments`)).status).toBe(404);
  });
});

describe('purge', () => {
  it('purges old comments and hard-deletes projects that have stages', async ({ expect }) => {
    const org = await seedOrg();
    const { owner } = org.users;
    const project = await createProject(owner.api, org.orgId);
    const task = await createTask(owner.api, project.id);
    const subtask = await owner.api('POST', `/api/tasks/${task.id}/subtasks`, { title: 'Sub' });
    expect(subtask.status).toBe(201);
    const comment = await owner.api('POST', `/api/tasks/${task.id}/comments`, { body: 'Bye' });
    await owner.api('DELETE', `/api/comments/${comment.body.data.id}`);
    await owner.api('DELETE', `/api/projects/${project.id}`);

    const longAgo = Date.now() - 31 * DAY;
    await env.DB.batch([
      env.DB.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').bind(
        longAgo,
        comment.body.data.id,
      ),
      env.DB.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').bind(longAgo, project.id),
    ]);
    const result = await new PurgeService(createDatabase(env.DB), env.FILES).run();
    expect(result.comments).toBeGreaterThanOrEqual(1);
    expect(result.projects).toBeGreaterThanOrEqual(1);

    const leftovers = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM project_stages WHERE project_id = ?1) AS stages, (SELECT count(*) FROM tasks WHERE project_id = ?1) AS tasks',
    )
      .bind(project.id)
      .first<{ stages: number; tasks: number }>();
    expect(leftovers).toEqual({ stages: 0, tasks: 0 });
  });
});
