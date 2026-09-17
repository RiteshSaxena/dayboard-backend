import type { Hono } from 'hono';
import { z } from 'zod';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, requireActor } from '../../core/http/request';
import type { ActivityService } from './activity.service';

const taskActivityQuerySchema = z.object({
  cursor: z.string().optional(),
  includeSubtasks: z.enum(['true', 'false']).optional(),
});

export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/projects/:id/activity', async (c) => {
      const actor = requireActor(c);
      const projectId = idParamSchema.safeParse(c.req.param('id'));
      if (!projectId.success) throw notFound('Project');

      const cursor = c.req.query('cursor');
      const data = await this.activityService.list(actor, projectId.data, cursor);

      return c.json({ data });
    });

    app.get('/api/tasks/:id/activity', async (c) => {
      const actor = requireActor(c);
      const taskId = idParamSchema.safeParse(c.req.param('id'));
      if (!taskId.success) throw notFound('Task');

      const query = taskActivityQuerySchema.parse(c.req.query());
      const data = await this.activityService.listForTask(actor, taskId.data, {
        cursor: query.cursor,
        includeSubtasks: query.includeSubtasks === 'true',
      });

      return c.json({ data });
    });
  }
}
