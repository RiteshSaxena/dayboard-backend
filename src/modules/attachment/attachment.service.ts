import { and, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../../core/http/api-error';
import type { RuntimeContext } from '../../core/runtime/runtime-context';
import { createId } from '../../core/security/crypto';
import { now } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import { attachments, type Attachment } from '../../database/schema';
import type { ActivityService } from '../activity/activity.service';
import type { AuthActor } from '../auth/auth.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import { apiOrigin, signFileUrl, verifyFileUrl } from './file-url';
import { canPresign, presignUpload } from './r2-presign';

export const MAX_FILE_SIZE = 100 * 1024 * 1024;
export const ORG_STORAGE_QUOTA = 5 * 1024 * 1024 * 1024;
const MAX_PER_TASK = 50;
export const MAX_PER_COMMENT = 10;

// Only these play inline; everything else is served as a download, so an uploaded SVG or HTML file
// can never run as a page.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const ATTACHMENT_TOKEN = /<attachment:([0-9A-Za-z_-]{21})>/g;

export type AttachmentKind = Attachment['kind'];

export function kindFor(contentType: string): AttachmentKind {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (IMAGE_TYPES.has(type)) return 'image';
  if (VIDEO_TYPES.has(type)) return 'video';
  return 'file';
}

/** Distinct attachment IDs referenced by `<attachment:id>` tokens, in the order they appear. */
export function parseAttachmentTokens(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(ATTACHMENT_TOKEN)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export class AttachmentService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly activity: ActivityService,
    private readonly runtime: RuntimeContext,
  ) {}

  /**
   * Reserves an attachment and returns where to send the bytes. The row stays `pending` until
   * `complete` confirms the upload arrived, so an abandoned upload never shows up on the task.
   */
  async create(
    actor: AuthActor,
    taskId: string,
    input: { filename: string; contentType: string; size: number },
  ) {
    const { project } = await this.authorization.requireTask(actor, taskId, 'member');
    if (input.size > MAX_FILE_SIZE) {
      throw badRequest(`Files must be ${MAX_FILE_SIZE / 1024 / 1024} MB or smaller`, 'size');
    }
    const [used] = await this.db
      .select({ value: sql<number>`coalesce(sum(${attachments.size}), 0)` })
      .from(attachments)
      .where(and(eq(attachments.orgId, project.orgId), isNull(attachments.deletedAt)));
    if ((used?.value ?? 0) + input.size > ORG_STORAGE_QUOTA) {
      throw conflict('This organization has reached its storage limit');
    }
    const [onTask] = await this.db
      .select({ value: count() })
      .from(attachments)
      .where(and(eq(attachments.taskId, taskId), isNull(attachments.deletedAt)));
    if ((onTask?.value ?? 0) >= MAX_PER_TASK) {
      throw conflict('This task has reached its attachment limit');
    }

    const timestamp = now();
    const id = createId();
    const attachment: Attachment = {
      id,
      orgId: project.orgId,
      taskId,
      commentId: null,
      uploadedBy: actor.user.id,
      filename: input.filename,
      contentType: input.contentType,
      kind: kindFor(input.contentType),
      size: input.size,
      key: `orgs/${project.orgId}/${id}`,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(attachments).values(attachment);
    return { attachment: await this.dto(attachment), upload: await this.uploadTarget(attachment) };
  }

  /** Local-development fallback: the Worker streams the body into R2 itself. */
  async receive(actor: AuthActor, id: string, request: Request): Promise<void> {
    const { attachment } = await this.requireUploadable(actor, id);
    if (!request.body) throw badRequest('Request body is required');
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_FILE_SIZE) throw badRequest('File is too large', 'size');
    await this.runtime.env.FILES.put(attachment.key, request.body, {
      httpMetadata: { contentType: attachment.contentType },
    });
  }

  /** Confirms the upload arrived, records its real size, and makes it visible on the task. */
  async complete(actor: AuthActor, id: string) {
    const { attachment, projectId } = await this.requireUploadable(actor, id);
    const object = await this.runtime.env.FILES.head(attachment.key);
    if (!object) throw conflict('Upload was not received');
    if (object.size > MAX_FILE_SIZE) {
      await this.runtime.env.FILES.delete(attachment.key);
      throw badRequest('File is too large', 'size');
    }
    const timestamp = now();
    await this.db
      .update(attachments)
      .set({ status: 'ready', size: object.size, updatedAt: timestamp })
      .where(eq(attachments.id, id));
    const ready: Attachment = { ...attachment, status: 'ready', size: object.size };
    await this.activity.record({
      orgId: attachment.orgId,
      projectId,
      taskId: attachment.taskId,
      actorId: actor.user.id,
      kind: 'attachment.added',
      payload: {
        attachmentId: ready.id,
        taskId: ready.taskId,
        filename: ready.filename,
        kind: ready.kind,
        size: ready.size,
      },
    });
    return this.dto(ready);
  }

  /** What the org has stored, so clients can show usage before an upload is refused. */
  async storage(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    const [row] = await this.db
      .select({
        used: sql<number>`coalesce(sum(${attachments.size}), 0)`,
        fileCount: count(),
      })
      .from(attachments)
      .where(and(eq(attachments.orgId, orgId), isNull(attachments.deletedAt)));
    const used = row?.used ?? 0;
    return {
      used,
      quota: ORG_STORAGE_QUOTA,
      remaining: Math.max(ORG_STORAGE_QUOTA - used, 0),
      fileCount: row?.fileCount ?? 0,
    };
  }

  async list(actor: AuthActor, taskId: string) {
    await this.authorization.requireTask(actor, taskId);
    const rows = await this.readyForTask(taskId);
    return Promise.all(rows.map((row) => this.dto(row)));
  }

  async get(actor: AuthActor, id: string) {
    const attachment = await this.findReady(id);
    if (!attachment) throw notFound('Attachment');
    await this.authorization.requireTask(actor, attachment.taskId);
    return this.dto(attachment);
  }

  /** The uploader can remove their own file; admins and owners can remove any. */
  async remove(actor: AuthActor, id: string): Promise<void> {
    const attachment = await this.findReady(id);
    if (!attachment) throw notFound('Attachment');
    const { membership, project } = await this.authorization.requireTask(
      actor,
      attachment.taskId,
      'member',
    );
    const isModerator = membership.role === 'owner' || membership.role === 'admin';
    if (attachment.uploadedBy !== actor.user.id && !isModerator) throw forbidden();
    const timestamp = now();
    await this.db
      .update(attachments)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(eq(attachments.id, id));
    await this.activity.record({
      orgId: attachment.orgId,
      projectId: project.id,
      taskId: attachment.taskId,
      actorId: actor.user.id,
      kind: 'attachment.deleted',
      payload: { attachmentId: id, taskId: attachment.taskId, filename: attachment.filename },
    });
  }

  /** Serves a file for a signed link. Authorization comes from the signature, not the session. */
  async serve(id: string, url: URL, request: Request): Promise<Response> {
    const disposition = await verifyFileUrl(this.runtime.env, id, url.searchParams);
    if (!disposition) throw new ApiError(403, 'forbidden', 'This link is invalid or has expired');
    const attachment = await this.findReady(id);
    if (!attachment) throw notFound('File');
    // Only ask for a range when one was requested; otherwise R2 reports a partial read.
    const wantsRange = request.headers.has('range');
    const object = await this.runtime.env.FILES.get(
      attachment.key,
      wantsRange ? { range: request.headers } : undefined,
    );
    if (!object) throw notFound('File');

    const inline = disposition === 'inline' && attachment.kind !== 'file';
    const headers = new Headers({
      // Unknown types are never served with their claimed content type, so nothing can run as a page.
      'Content-Type': inline ? attachment.contentType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=900',
      ETag: object.httpEtag,
    });
    const range = wantsRange ? object.range : undefined;
    if (range && 'offset' in range) {
      const start = range.offset ?? 0;
      const end = start + (range.length ?? attachment.size - start) - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
      return new Response(object.body, { status: 206, headers });
    }
    return new Response(object.body, { headers });
  }

  /** Validates `<attachment:id>` tokens in a comment: ready files on the same task, at most ten. */
  async requireForComment(taskId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    if (ids.length > MAX_PER_COMMENT) {
      throw badRequest(`A comment can include at most ${MAX_PER_COMMENT} attachments`, 'body');
    }
    const rows = await this.db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          inArray(attachments.id, ids),
          eq(attachments.taskId, taskId),
          eq(attachments.status, 'ready'),
          isNull(attachments.deletedAt),
        ),
      );
    if (rows.length !== ids.length) {
      throw badRequest('Attachments must be uploaded to this task first', 'body');
    }
  }

  /** Statements that point the referenced files at this comment and release the rest. */
  linkStatements(commentId: string, taskId: string, ids: string[]) {
    const statements = [];
    if (ids.length > 0) {
      statements.push(
        this.db
          .update(attachments)
          .set({ commentId })
          .where(and(inArray(attachments.id, ids), eq(attachments.taskId, taskId))),
      );
    }
    statements.push(
      this.db
        .update(attachments)
        .set({ commentId: null })
        .where(
          and(
            eq(attachments.commentId, commentId),
            ids.length > 0 ? notInArray(attachments.id, ids) : undefined,
          ),
        ),
    );
    return statements;
  }

  /** Attachments of a task's comments, grouped by comment, for comment responses. */
  async forComments(taskId: string) {
    const rows = await this.readyForTask(taskId);
    const byComment = new Map<string, Awaited<ReturnType<AttachmentService['dto']>>[]>();
    for (const row of rows) {
      if (!row.commentId) continue;
      const list = byComment.get(row.commentId) ?? [];
      list.push(await this.dto(row));
      byComment.set(row.commentId, list);
    }
    return byComment;
  }

  private async uploadTarget(attachment: Attachment) {
    if (canPresign(this.runtime.env)) {
      return {
        mode: 'presigned' as const,
        method: 'PUT' as const,
        url: await presignUpload(this.runtime.env, attachment.key, attachment.contentType),
        headers: { 'Content-Type': attachment.contentType },
      };
    }
    return {
      mode: 'worker' as const,
      method: 'PUT' as const,
      url: `${apiOrigin(this.runtime)}/api/attachments/${attachment.id}/upload`,
      headers: { 'Content-Type': attachment.contentType },
    };
  }

  private async dto(attachment: Attachment) {
    const [url, downloadUrl] = await Promise.all([
      signFileUrl(
        this.runtime,
        attachment.id,
        attachment.kind === 'file' ? 'attachment' : 'inline',
      ),
      signFileUrl(this.runtime, attachment.id, 'attachment'),
    ]);
    return {
      id: attachment.id,
      taskId: attachment.taskId,
      commentId: attachment.commentId,
      filename: attachment.filename,
      contentType: attachment.contentType,
      kind: attachment.kind,
      size: attachment.size,
      uploadedBy: attachment.uploadedBy,
      status: attachment.status,
      createdAt: attachment.createdAt,
      url,
      downloadUrl,
    };
  }

  private readyForTask(taskId: string): Promise<Attachment[]> {
    return this.db.query.attachments.findMany({
      where: and(
        eq(attachments.taskId, taskId),
        eq(attachments.status, 'ready'),
        isNull(attachments.deletedAt),
      ),
      orderBy: attachments.createdAt,
    });
  }

  private async findReady(id: string): Promise<Attachment | null> {
    const attachment = await this.db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, id),
        eq(attachments.status, 'ready'),
        isNull(attachments.deletedAt),
      ),
    });
    return attachment ?? null;
  }

  private async requireUploadable(
    actor: AuthActor,
    id: string,
  ): Promise<{ attachment: Attachment; projectId: string }> {
    const attachment = await this.db.query.attachments.findFirst({
      where: and(eq(attachments.id, id), isNull(attachments.deletedAt)),
    });
    if (!attachment) throw notFound('Attachment');
    if (attachment.uploadedBy !== actor.user.id) throw forbidden();
    if (attachment.status === 'ready') throw conflict('This upload is already complete');
    const { project } = await this.authorization.requireTask(actor, attachment.taskId, 'member');
    return { attachment, projectId: project.id };
  }
}
