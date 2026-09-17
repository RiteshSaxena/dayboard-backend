import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import {
  createTaskSchema,
  moveTaskSchema,
  taskQuerySchema,
  updateTaskSchema,
} from './task.schemas';
import type { TaskService } from './task.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/projects/:id/tasks', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const query = taskQuerySchema.parse(c.req.query());
      const data = await this.taskService.list(actor, projectId, query);

      return c.json({ data });
    });

    app.post('/api/projects/:id/tasks', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const input = await parseJson(c, createTaskSchema);
      const data = await this.taskService.create(actor, projectId, input);

      return c.json({ data }, 201);
    });

    app.get('/api/tasks/:id', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const data = await this.taskService.get(actor, taskId);

      return c.json({ data });
    });

    app.get('/api/tasks/:id/subtasks', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const data = await this.taskService.listSubtasks(actor, taskId);

      return c.json({ data });
    });

    app.post('/api/tasks/:id/subtasks', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const input = await parseJson(c, createTaskSchema);
      const data = await this.taskService.createSubtask(actor, taskId, input);

      return c.json({ data }, 201);
    });

    app.patch('/api/tasks/:id', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const input = await parseJson(c, updateTaskSchema);
      const data = await this.taskService.update(actor, taskId, input);

      return c.json({ data });
    });

    app.post('/api/tasks/:id/move', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const input = await parseJson(c, moveTaskSchema);
      const data = await this.taskService.move(actor, taskId, input);

      return c.json({ data });
    });

    app.post('/api/tasks/:id/archive', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const data = await this.taskService.archive(actor, taskId);

      return c.json({ data });
    });

    app.post('/api/tasks/:id/unarchive', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const data = await this.taskService.unarchive(actor, taskId);

      return c.json({ data });
    });

    app.delete('/api/tasks/:id', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      await this.taskService.remove(actor, taskId);

      return c.json({ data: { success: true } });
    });

    app.post('/api/tasks/:id/restore', async (c) => {
      const actor = requireActor(c);
      const taskId = parseId(c.req.param('id'));
      const data = await this.taskService.restore(actor, taskId);

      return c.json({ data });
    });

    app.post('/api/projects/:id/tasks/archive-done', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const data = await this.taskService.archiveDone(actor, projectId);

      return c.json({ data });
    });

    app.get('/api/orgs/:orgId/tasks/mine', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.taskService.mine(actor, orgId);

      return c.json({ data });
    });
  }
}
