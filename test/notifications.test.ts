import { env } from 'cloudflare:workers';
import { describe, it } from 'vitest';
import { createId } from '../src/core/security/crypto';
import { apiWithOutbox, seedOrg, type Api, type Role, type SentEmail } from './helpers';

async function setup() {
  const org = await seedOrg();
  const outbox: SentEmail[] = [];
  const api = Object.fromEntries(
    (['owner', 'admin', 'member', 'guest'] as Role[]).map((role) => [
      role,
      apiWithOutbox(org.users[role].token, outbox),
    ]),
  ) as Record<Role, Api>;
  const project = await api.owner('POST', `/api/orgs/${org.orgId}/projects`, {
    name: 'Launch',
    color: '#617a59',
  });
  return { org, outbox, api, projectId: project.body.data.id as string };
}

describe('assignment emails', () => {
  it('emails a new assignee, but not self-assignments or unchanged assignees', async ({
    expect,
  }) => {
    const { org, outbox, api, projectId } = await setup();
    const { guest, admin, member } = org.users;

    const task = await api.member('POST', `/api/projects/${projectId}/tasks`, {
      title: 'Write copy',
      assigneeId: guest.id,
      dueDate: '2026-10-01',
    });
    expect(outbox).toEqual([
      {
        template: 'taskAssigned',
        to: guest.email,
        input: expect.objectContaining({
          assigner: 'member user',
          taskTitle: 'Write copy',
          projectName: 'Launch',
          dueDate: '2026-10-01',
          orgId: org.orgId,
        }),
      },
    ]);

    outbox.length = 0;
    await api.member('POST', `/api/projects/${projectId}/tasks`, {
      title: 'Mine',
      assigneeId: member.id,
    });
    await api.member('PATCH', `/api/tasks/${task.body.data.id}`, { assigneeId: guest.id });
    await api.member('PATCH', `/api/tasks/${task.body.data.id}`, { title: 'Write better copy' });
    expect(outbox).toEqual([]);

    await api.member('PATCH', `/api/tasks/${task.body.data.id}`, { assigneeId: admin.id });
    await api.member('POST', `/api/tasks/${task.body.data.id}/subtasks`, {
      title: 'Outline',
      assigneeId: guest.id,
    });
    expect(outbox.map((email) => email.to)).toEqual([admin.email, guest.email]);
  });
});

describe('comment and mention emails', () => {
  it('emails the assignee and newly mentioned people once per comment', async ({ expect }) => {
    const { org, outbox, api, projectId } = await setup();
    const { guest, admin, member } = org.users;
    const task = await api.member('POST', `/api/projects/${projectId}/tasks`, {
      title: 'Ship it',
      assigneeId: guest.id,
    });
    outbox.length = 0;

    await api.owner('POST', `/api/tasks/${task.body.data.id}/comments`, { body: 'Looks close' });
    expect(outbox).toEqual([
      {
        template: 'taskComment',
        to: guest.email,
        input: expect.objectContaining({
          kind: 'comment',
          author: 'owner user',
          excerpt: 'Looks close',
        }),
      },
    ]);

    outbox.length = 0;
    const comment = await api.owner('POST', `/api/tasks/${task.body.data.id}/comments`, {
      body: `<@${guest.id}> and <@${admin.id}>, please review`,
    });
    expect(outbox.map((email) => [email.to, email.input.kind]).sort()).toEqual(
      [
        [guest.email, 'mention'],
        [admin.email, 'mention'],
      ].sort(),
    );
    expect(outbox[0]?.input.excerpt).toMatch(
      /^@(guest|admin) user and @(guest|admin) user, please review$/,
    );

    outbox.length = 0;
    const edited = await api.owner('PATCH', `/api/comments/${comment.body.data.id}`, {
      body: `<@${guest.id}> and <@${admin.id}> and <@${member.id}>, please review`,
    });
    expect(edited.status).toBe(200);
    expect(outbox.map((email) => [email.to, email.input.kind])).toEqual([
      [member.email, 'mention'],
    ]);

    // Authors never email themselves.
    outbox.length = 0;
    await api.member('POST', `/api/tasks/${task.body.data.id}/comments`, {
      body: `Noting for myself <@${member.id}>`,
    });
    expect(outbox.map((email) => email.to)).toEqual([guest.email]);
  });

  it('respects preferences and skips unverified recipients', async ({ expect }) => {
    const { org, outbox, api, projectId } = await setup();
    const { guest, admin } = org.users;
    const task = await api.owner('POST', `/api/projects/${projectId}/tasks`, {
      title: 'Plan',
      assigneeId: guest.id,
    });

    const defaults = await api.guest('GET', '/api/me/notifications');
    expect(defaults.body.data).toEqual({
      emailAssigned: true,
      emailComments: true,
      emailMentions: true,
    });
    expect((await api.guest('PATCH', '/api/me/notifications', {})).status).toBe(422);
    expect((await api.guest('PATCH', '/api/me/notifications', { email: false })).status).toBe(422);

    const updated = await api.guest('PATCH', '/api/me/notifications', { emailComments: false });
    expect(updated.body.data).toEqual({
      emailAssigned: true,
      emailComments: false,
      emailMentions: true,
    });

    outbox.length = 0;
    await api.owner('POST', `/api/tasks/${task.body.data.id}/comments`, { body: 'Plain comment' });
    expect(outbox).toEqual([]);
    await api.owner('POST', `/api/tasks/${task.body.data.id}/comments`, {
      body: `<@${guest.id}> ping`,
    });
    expect(outbox.map((email) => email.input.kind)).toEqual(['mention']);

    // With mention emails off, an assignee still hears about a new comment that mentions them.
    await api.guest('PATCH', '/api/me/notifications', {
      emailComments: true,
      emailMentions: false,
    });
    outbox.length = 0;
    await api.owner('POST', `/api/tasks/${task.body.data.id}/comments`, {
      body: `<@${guest.id}> again`,
    });
    expect(outbox.map((email) => email.input.kind)).toEqual(['comment']);

    await env.DB.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?')
      .bind(admin.id)
      .run();
    outbox.length = 0;
    await api.owner('PATCH', `/api/tasks/${task.body.data.id}`, { assigneeId: admin.id });
    expect(outbox).toEqual([]);
  });
});

describe('mentions', () => {
  it('validates mention tokens and returns mentioned people', async ({ expect }) => {
    const { org, api, projectId } = await setup();
    const other = await seedOrg();
    const { guest, owner } = org.users;
    const task = await api.member('POST', `/api/projects/${projectId}/tasks`, { title: 'Review' });
    const path = `/api/tasks/${task.body.data.id}/comments`;

    const outsider = await api.member('POST', path, { body: `<@${other.users.member.id}> hi` });
    expect(outsider.status).toBe(422);
    expect(outsider.body.error).toMatchObject({ field: 'body' });

    const tooMany = Array.from({ length: 21 }, () => `<@${createId()}>`).join(' ');
    const crowded = await api.member('POST', path, { body: tooMany });
    expect(crowded.status).toBe(422);
    expect(crowded.body.error.message).toBe('A comment can mention at most 20 people');

    // <@everyone> is not a mention; it stays plain text.
    const plain = await api.member('POST', path, { body: '<@everyone> standup' });
    expect(plain.status).toBe(201);
    expect(plain.body.data).not.toHaveProperty('mentionsEveryone');
    expect(plain.body.data.mentions).toEqual([]);

    const created = await api.member('POST', path, {
      body: `<@${owner.id}> and <@${guest.id}> and <@${owner.id}> again`,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.mentions).toEqual([
      { id: owner.id, name: 'owner user', avatarUrl: null },
      { id: guest.id, name: 'guest user', avatarUrl: null },
    ]);

    const listed = await api.guest('GET', path);
    expect(
      listed.body.data.items.map((item: { mentions: unknown[] }) => item.mentions.length).sort(),
    ).toEqual([0, 2]);
  });

  it('lists mentions of the caller', async ({ expect }) => {
    const { org, api, projectId } = await setup();
    const { guest } = org.users;
    const task = await api.member('POST', `/api/projects/${projectId}/tasks`, { title: 'Review' });
    const path = `/api/tasks/${task.body.data.id}/comments`;

    const first = await api.owner('POST', path, { body: `<@${guest.id}> can you look?` });
    const second = await api.admin('POST', path, { body: `<@${guest.id}> and me too` });
    const removed = await api.member('POST', path, { body: `<@${guest.id}> old` });
    await api.member('DELETE', `/api/comments/${removed.body.data.id}`);
    await api.owner('POST', path, { body: 'No mention here' });

    const inbox = await api.guest('GET', '/api/me/mentions');
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.cursor).toBeNull();
    const items: { comment: { id: string; createdAt: number } }[] = inbox.body.data.items;
    expect(items.map((item) => item.comment.id).sort()).toEqual(
      [first.body.data.id, second.body.data.id].sort(),
    );
    expect(items[0]!.comment.createdAt).toBeGreaterThanOrEqual(items[1]!.comment.createdAt);
    expect(items.find((item) => item.comment.id === first.body.data.id)).toEqual({
      comment: expect.objectContaining({ author: expect.objectContaining({ name: 'owner user' }) }),
      task: { id: task.body.data.id, title: 'Review', projectId, parentId: null },
      project: { id: projectId, name: 'Launch', orgId: org.orgId },
    });

    // Mentioning yourself doesn't put your own comment in your list.
    await api.admin('POST', path, { body: `<@${org.users.admin.id}> note to self` });
    expect((await api.admin('GET', '/api/me/mentions')).body.data.items).toEqual([]);

    const otherOrg = createId();
    expect((await api.guest('GET', `/api/me/mentions?orgId=${otherOrg}`)).body.data.items).toEqual(
      [],
    );

    // Leaving the org hides its mentions.
    await api.owner('DELETE', `/api/orgs/${org.orgId}/members/${guest.id}`);
    expect((await api.guest('GET', '/api/me/mentions')).body.data.items).toEqual([]);
  });
});
