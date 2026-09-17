import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import {
  createTaskTypeSchema,
  reorderTaskTypesSchema,
  updateTaskTypeSchema,
} from './task-type.schemas';
import type { TaskTypeService } from './task-type.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class TaskTypeController {
  constructor(private readonly taskTypeService: TaskTypeService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/orgs/:orgId/task-types', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.taskTypeService.list(actor, orgId);

      return c.json({ data });
    });

    app.post('/api/orgs/:orgId/task-types', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const input = await parseJson(c, createTaskTypeSchema);
      const data = await this.taskTypeService.create(actor, orgId, input);

      return c.json({ data }, 201);
    });

    app.post('/api/orgs/:orgId/task-types/reorder', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const input = await parseJson(c, reorderTaskTypesSchema);
      const data = await this.taskTypeService.reorder(actor, orgId, input.taskTypeIds);

      return c.json({ data });
    });

    app.patch('/api/task-types/:id', async (c) => {
      const actor = requireActor(c);
      const taskTypeId = parseId(c.req.param('id'));
      const input = await parseJson(c, updateTaskTypeSchema);
      const data = await this.taskTypeService.update(actor, taskTypeId, input);

      return c.json({ data });
    });

    app.delete('/api/task-types/:id', async (c) => {
      const actor = requireActor(c);
      const taskTypeId = parseId(c.req.param('id'));
      await this.taskTypeService.remove(actor, taskTypeId);

      return c.json({ data: { success: true } });
    });
  }
}
