import { describe, it } from 'vitest';
import { seedOrg } from './helpers';

describe('task activity', () => {
  it("lists a task's history, optionally with its subtasks", async ({ expect }) => {
    const org = await seedOrg();
    const other = await seedOrg();
    const { owner, member, guest } = org.users;
    const project = await owner.api('POST', `/api/orgs/${org.orgId}/projects`, {
      name: 'Launch',
      color: '#617a59',
    });
    const projectId = project.body.data.id;
    const task = (await member.api('POST', `/api/projects/${projectId}/tasks`, { title: 'Parent' }))
      .body.data;
    const sibling = (
      await member.api('POST', `/api/projects/${projectId}/tasks`, { title: 'Sibling' })
    ).body.data;
    await member.api('POST', `/api/tasks/${task.id}/move`, { status: 'doing' });
    await member.api('POST', `/api/tasks/${task.id}/comments`, { body: 'On the parent' });
    await member.api('PATCH', `/api/tasks/${sibling.id}`, { title: 'Sibling renamed' });
    const subtask = (await member.api('POST', `/api/tasks/${task.id}/subtasks`, { title: 'Child' }))
      .body.data;
    await member.api('POST', `/api/tasks/${subtask.id}/comments`, { body: 'On the child' });
    await member.api('DELETE', `/api/tasks/${subtask.id}`);

    const own = await guest.api('GET', `/api/tasks/${task.id}/activity`);
    expect(own.status).toBe(200);
    expect(own.body.data.cursor).toBeNull();
    expect(own.body.data.items.every((item: { taskId: string }) => item.taskId === task.id)).toBe(
      true,
    );
    expect(own.body.data.items.map((item: { kind: string }) => item.kind).sort()).toEqual(
      ['comment.created', 'task.created', 'task.updated'].sort(),
    );

    const withSubtasks = await guest.api(
      'GET',
      `/api/tasks/${task.id}/activity?includeSubtasks=true`,
    );
    const items: { taskId: string; kind: string; createdAt: number }[] =
      withSubtasks.body.data.items;
    expect(new Set(items.map((item) => item.taskId))).toEqual(new Set([task.id, subtask.id]));
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.kind)).toContain('task.deleted');
    for (let index = 1; index < items.length; index += 1) {
      expect(items[index - 1]!.createdAt).toBeGreaterThanOrEqual(items[index]!.createdAt);
    }

    expect(
      (await guest.api('GET', `/api/tasks/${task.id}/activity?includeSubtasks=yes`)).status,
    ).toBe(422);
    expect((await guest.api('GET', `/api/tasks/${task.id}/activity?cursor=nope`)).status).toBe(422);
    expect((await other.users.owner.api('GET', `/api/tasks/${task.id}/activity`)).status).toBe(404);
    expect((await guest.api('GET', '/api/tasks/short/activity')).status).toBe(404);
  });

  it('records what each update changed', async ({ expect }) => {
    const org = await seedOrg();
    const { owner, member } = org.users;
    const project = (
      await owner.api('POST', `/api/orgs/${org.orgId}/projects`, {
        name: 'Launch',
        color: '#617a59',
      })
    ).body.data;
    const [todo, , done] = project.stages as { id: string }[];
    const task = (await member.api('POST', `/api/projects/${project.id}/tasks`, { title: 'Draft' }))
      .body.data;

    await member.api('PATCH', `/api/tasks/${task.id}`, {
      title: 'Final draft',
      description: 'A long description',
      assigneeId: owner.id,
      dueDate: '2026-10-01',
    });
    await member.api('POST', `/api/tasks/${task.id}/move`, { stageId: done!.id });
    await member.api('POST', `/api/tasks/${task.id}/archive`);

    const items = (await member.api('GET', `/api/tasks/${task.id}/activity`)).body.data.items as {
      kind: string;
      payload: { changes?: unknown[] };
    }[];
    const updates = items.filter((item) => item.kind === 'task.updated').reverse();
    expect(updates[0]!.payload.changes).toEqual([
      { field: 'title', from: 'Draft', to: 'Final draft' },
      { field: 'description' },
      { field: 'assigneeId', from: null, to: owner.id },
      { field: 'dueDate', from: null, to: '2026-10-01' },
    ]);
    expect(updates[1]!.payload.changes).toEqual([
      { field: 'stageId', from: todo!.id, to: done!.id },
    ]);
    expect(updates[2]!.payload.changes).toEqual([
      { field: 'archivedAt', from: null, to: expect.any(Number) },
    ]);
  });
});
