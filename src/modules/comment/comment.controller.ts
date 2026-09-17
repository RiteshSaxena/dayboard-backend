import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import {
  commentQuerySchema,
  createCommentSchema,
  mentionQuerySchema,
  updateCommentSchema,
} from './comment.schemas';
import type { CommentService } from './comment.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/me/mentions', async (c) => {
      const actor = requireActor(c);
      const query = mentionQuerySchema.parse(c.req.query());
      const data = await this.commentService.mentionsFor(actor, query.cursor, query.orgId);

      return c.json({ data });
    });

    app.get('/api/tasks/:id/comments', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const query = commentQuerySchema.parse(c.req.query());
      const data = await this.commentService.list(actor, taskId, query.cursor);

      return c.json({ data });
    });

    app.post('/api/tasks/:id/comments', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const input = await parseJson(c, createCommentSchema);
      const data = await this.commentService.create(actor, taskId, input.body);

      return c.json({ data }, 201);
    });

    app.patch('/api/comments/:id', async (c) => {
      const actor = requireActor(c);
      const commentId = parseId(c.req.param('id'));
      const input = await parseJson(c, updateCommentSchema);
      const data = await this.commentService.update(actor, commentId, input.body);

      return c.json({ data });
    });

    app.delete('/api/comments/:id', async (c) => {
      const actor = requireActor(c);
      const commentId = parseId(c.req.param('id'));
      await this.commentService.remove(actor, commentId);

      return c.json({ data: { success: true } });
    });
  }
}
