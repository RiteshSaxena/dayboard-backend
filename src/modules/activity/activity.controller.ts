import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, requireActor } from '../../core/http/request';
import type { ActivityService } from './activity.service';

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
  }
}
