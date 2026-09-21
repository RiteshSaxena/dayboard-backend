import { env, exports } from 'cloudflare:workers';
import { describe, it } from 'vitest';
import { createDatabase } from '../src/database/database';
import { PurgeService } from '../src/modules/maintenance/purge.service';
import { seedOrg, type Api, type SeededOrg } from './helpers';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);

async function upload(
  api: Api,
  token: string,
  taskId: string,
  file: { filename: string; contentType: string; bytes: Uint8Array },
) {
  const created = await api('POST', `/api/tasks/${taskId}/attachments`, {
    filename: file.filename,
    contentType: file.contentType,
    size: file.bytes.byteLength,
  });
  if (created.status !== 201) throw new Error(`reserve failed: ${JSON.stringify(created.body)}`);
  const { upload: target, attachment } = created.body.data;
  const put = await exports.default.fetch(
    new Request(target.url, {
      method: target.method,
      headers: { ...target.headers, Authorization: `Bearer ${token}` },
      body: file.bytes.buffer as ArrayBuffer,
    }),
  );
  if (put.status !== 200) throw new Error(`upload failed: ${put.status}`);
  const completed = await api('POST', `/api/attachments/${attachment.id}/complete`, {});
  if (completed.status !== 200)
    throw new Error(`complete failed: ${JSON.stringify(completed.body)}`);
  return completed.body.data;
}

async function setup() {
  const org: SeededOrg = await seedOrg();
  const project = await org.users.owner.api('POST', `/api/orgs/${org.orgId}/projects`, {
    name: 'Launch',
    color: '#617a59',
  });
  const task = await org.users.member.api('POST', `/api/projects/${project.body.data.id}/tasks`, {
    title: 'With files',
  });
  return { org, taskId: task.body.data.id as string };
}

describe('attachments', () => {
  it('uploads, serves, and deletes a file', async ({ expect }) => {
    const { org, taskId } = await setup();
    const { member, guest, admin } = org.users;

    const attachment = await upload(member.api, member.token, taskId, {
      filename: 'shot.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    expect(attachment).toMatchObject({
      taskId,
      filename: 'shot.png',
      kind: 'image',
      size: PNG.byteLength,
      status: 'ready',
      uploadedBy: member.id,
      commentId: null,
    });

    const listed = await guest.api('GET', `/api/tasks/${taskId}/attachments`);
    expect(listed.body.data).toHaveLength(1);

    // Signed links carry their own authorization, so images load without the bearer token.
    const view = await exports.default.fetch(new Request(attachment.url));
    expect(view.status).toBe(200);
    expect(view.headers.get('content-type')).toBe('image/png');
    expect(view.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''shot.png");
    expect(view.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await view.arrayBuffer())).toEqual(PNG);

    const download = await exports.default.fetch(new Request(attachment.downloadUrl));
    expect(download.headers.get('content-type')).toBe('application/octet-stream');
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);

    const ranged = await exports.default.fetch(
      new Request(attachment.url, { headers: { Range: 'bytes=0-3' } }),
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-3/${PNG.byteLength}`);

    const tampered = new URL(attachment.url);
    tampered.searchParams.set('sig', 'f'.repeat(64));
    expect((await exports.default.fetch(new Request(tampered))).status).toBe(403);
    const expired = new URL(attachment.url);
    expired.searchParams.set('exp', '1');
    expect((await exports.default.fetch(new Request(expired))).status).toBe(403);

    expect((await guest.api('DELETE', `/api/attachments/${attachment.id}`)).status).toBe(403);
    expect((await admin.api('DELETE', `/api/attachments/${attachment.id}`)).status).toBe(200);
    expect((await guest.api('GET', `/api/tasks/${taskId}/attachments`)).body.data).toEqual([]);
    expect((await exports.default.fetch(new Request(attachment.url))).status).toBe(404);
  });

  it('serves other types as downloads only', async ({ expect }) => {
    const { org, taskId } = await setup();
    const { member } = org.users;
    const attachment = await upload(member.api, member.token, taskId, {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    expect(attachment.kind).toBe('file');

    // Even the inline link must not serve an SVG as an image: it could run scripts.
    const served = await exports.default.fetch(new Request(attachment.url));
    expect(served.headers.get('content-type')).toBe('application/octet-stream');
    expect(served.headers.get('content-disposition')).toMatch(/^attachment;/);

    const video = await upload(member.api, member.token, taskId, {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    });
    expect(video.kind).toBe('video');
    expect((await exports.default.fetch(new Request(video.url))).headers.get('content-type')).toBe(
      'video/mp4',
    );
  });

  it('enforces limits and permissions', async ({ expect }) => {
    const { org, taskId } = await setup();
    const { member, guest } = org.users;

    const tooBig = await member.api('POST', `/api/tasks/${taskId}/attachments`, {
      filename: 'huge.mp4',
      contentType: 'video/mp4',
      size: 101 * 1024 * 1024,
    });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.field).toBe('size');

    expect(
      (
        await guest.api('POST', `/api/tasks/${taskId}/attachments`, {
          filename: 'a.png',
          contentType: 'image/png',
          size: 10,
        })
      ).status,
    ).toBe(403);

    // A reserved upload stays invisible until it is completed.
    const reserved = await member.api('POST', `/api/tasks/${taskId}/attachments`, {
      filename: 'pending.png',
      contentType: 'image/png',
      size: PNG.byteLength,
    });
    expect(reserved.body.data.attachment.status).toBe('pending');
    expect(reserved.body.data.upload.mode).toBe('worker');
    expect((await guest.api('GET', `/api/tasks/${taskId}/attachments`)).body.data).toEqual([]);
    const early = await member.api(
      'POST',
      `/api/attachments/${reserved.body.data.attachment.id}/complete`,
      {},
    );
    expect(early.status).toBe(409);

    // The quota counts every stored byte in the org.
    await env.DB.prepare('UPDATE attachments SET size = ? WHERE id = ?')
      .bind(5 * 1024 * 1024 * 1024, reserved.body.data.attachment.id)
      .run();
    const overQuota = await member.api('POST', `/api/tasks/${taskId}/attachments`, {
      filename: 'next.png',
      contentType: 'image/png',
      size: 1024,
    });
    expect(overQuota.status).toBe(409);
    expect(overQuota.body.error.message).toBe('This organization has reached its storage limit');
  });

  it('reports storage used by the org', async ({ expect }) => {
    const { org, taskId } = await setup();
    const { member, guest } = org.users;

    const empty = await guest.api('GET', `/api/orgs/${org.orgId}/storage`);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      used: 0,
      quota: 5 * 1024 * 1024 * 1024,
      remaining: 5 * 1024 * 1024 * 1024,
      fileCount: 0,
    });

    const attachment = await upload(member.api, member.token, taskId, {
      filename: 'shot.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    const afterUpload = await guest.api('GET', `/api/orgs/${org.orgId}/storage`);
    expect(afterUpload.body.data).toMatchObject({ used: PNG.byteLength, fileCount: 1 });
    expect(afterUpload.body.data.remaining).toBe(5 * 1024 * 1024 * 1024 - PNG.byteLength);

    // Deleted files stop counting straight away, before the object is purged.
    await member.api('DELETE', `/api/attachments/${attachment.id}`);
    expect((await guest.api('GET', `/api/orgs/${org.orgId}/storage`)).body.data).toMatchObject({
      used: 0,
      fileCount: 0,
    });

    const outsider = await seedOrg();
    expect((await outsider.users.owner.api('GET', `/api/orgs/${org.orgId}/storage`)).status).toBe(
      404,
    );
  });

  it('links attachments referenced by a comment', async ({ expect }) => {
    const { org, taskId } = await setup();
    const other = await setup();
    const { member, guest } = org.users;
    const attachment = await upload(member.api, member.token, taskId, {
      filename: 'shot.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    const elsewhere = await upload(
      other.org.users.member.api,
      other.org.users.member.token,
      other.taskId,
      {
        filename: 'other.png',
        contentType: 'image/png',
        bytes: PNG,
      },
    );

    const wrongTask = await member.api('POST', `/api/tasks/${taskId}/comments`, {
      body: `Look <attachment:${elsewhere.id}>`,
    });
    expect(wrongTask.status).toBe(422);
    expect(wrongTask.body.error).toMatchObject({ field: 'body' });

    const comment = await member.api('POST', `/api/tasks/${taskId}/comments`, {
      body: `Here it is <attachment:${attachment.id}>`,
    });
    expect(comment.status).toBe(201);
    expect(comment.body.data.attachments).toHaveLength(1);
    expect(comment.body.data.attachments[0]).toMatchObject({
      id: attachment.id,
      commentId: comment.body.data.id,
      kind: 'image',
    });

    const listed = await guest.api('GET', `/api/tasks/${taskId}/comments`);
    expect(listed.body.data.items[0].attachments).toHaveLength(1);

    // Removing the token from the comment leaves the file on the task.
    const edited = await member.api('PATCH', `/api/comments/${comment.body.data.id}`, {
      body: 'Never mind',
    });
    expect(edited.body.data.attachments).toEqual([]);
    const stillThere = await guest.api('GET', `/api/tasks/${taskId}/attachments`);
    expect(stillThere.body.data.map((item: { id: string }) => item.id)).toEqual([attachment.id]);
  });

  it('purges stored objects for deleted and abandoned uploads', async ({ expect }) => {
    const { org, taskId } = await setup();
    const { member } = org.users;
    const deleted = await upload(member.api, member.token, taskId, {
      filename: 'gone.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    const abandoned = await member.api('POST', `/api/tasks/${taskId}/attachments`, {
      filename: 'never.png',
      contentType: 'image/png',
      size: PNG.byteLength,
    });
    const kept = await upload(member.api, member.token, taskId, {
      filename: 'kept.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    await member.api('DELETE', `/api/attachments/${deleted.id}`);

    const longAgo = Date.now() - 31 * 86_400_000;
    await env.DB.batch([
      env.DB.prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').bind(
        longAgo,
        deleted.id,
      ),
      env.DB.prepare('UPDATE attachments SET created_at = ? WHERE id = ?').bind(
        longAgo,
        abandoned.body.data.attachment.id,
      ),
    ]);

    const result = await new PurgeService(createDatabase(env.DB), env.FILES).run();
    expect(result.attachments).toBeGreaterThanOrEqual(2);
    const keys = await env.DB.prepare('SELECT key FROM attachments WHERE org_id = ?')
      .bind(org.orgId)
      .all<{ key: string }>();
    expect(keys.results.map((row) => row.key)).toEqual([`orgs/${org.orgId}/${kept.id}`]);
    expect(await env.FILES.head(`orgs/${org.orgId}/${deleted.id}`)).toBeNull();
    expect(await env.FILES.head(`orgs/${org.orgId}/${kept.id}`)).not.toBeNull();
  });
});
