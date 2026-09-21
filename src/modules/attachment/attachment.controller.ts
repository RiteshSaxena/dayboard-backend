import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import { createAttachmentSchema } from './attachment.schemas';
import type { AttachmentService } from './attachment.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/orgs/:orgId/storage', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.attachmentService.storage(actor, orgId);

      return c.json({ data });
    });

    app.get('/api/tasks/:id/attachments', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const data = await this.attachmentService.list(actor, taskId);

      return c.json({ data });
    });

    app.post('/api/tasks/:id/attachments', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const input = await parseJson(c, createAttachmentSchema);
      const data = await this.attachmentService.create(actor, taskId, input);

      return c.json({ data }, 201);
    });

    // Local development only: with R2 credentials the browser uploads straight to R2 instead.
    app.put('/api/attachments/:id/upload', async (c) => {
      const actor = requireActor(c);
      const attachmentId = parseId(c.req.param('id'));
      await this.attachmentService.receive(actor, attachmentId, c.req.raw);

      return c.json({ data: { success: true } });
    });

    app.post('/api/attachments/:id/complete', async (c) => {
      const actor = requireActor(c);
      const attachmentId = parseId(c.req.param('id'));
      const data = await this.attachmentService.complete(actor, attachmentId);

      return c.json({ data });
    });

    app.get('/api/attachments/:id', async (c) => {
      const actor = requireActor(c);
      const attachmentId = parseId(c.req.param('id'));
      const data = await this.attachmentService.get(actor, attachmentId);

      return c.json({ data });
    });

    app.delete('/api/attachments/:id', async (c) => {
      const actor = requireActor(c);
      const attachmentId = parseId(c.req.param('id'));
      await this.attachmentService.remove(actor, attachmentId);

      return c.json({ data: { success: true } });
    });

    // Signed links; no session, so images and video play in the browser.
    app.get('/files/:id', async (c) => {
      const attachmentId = parseId(c.req.param('id'));
      return this.attachmentService.serve(attachmentId, new URL(c.req.url), c.req.raw);
    });
  }
}
