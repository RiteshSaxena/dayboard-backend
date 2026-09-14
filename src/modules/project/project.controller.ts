import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import { createProjectSchema, updateProjectSchema } from './project.schemas';
import type { ProjectService } from './project.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/orgs/:orgId/board', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.projectService.board(actor, orgId);

      return c.json({ data });
    });

    app.get('/api/orgs/:orgId/projects', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.projectService.list(actor, orgId);

      return c.json({ data });
    });

    app.post('/api/orgs/:orgId/projects', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const input = await parseJson(c, createProjectSchema);
      const data = await this.projectService.create(actor, orgId, input);

      return c.json({ data }, 201);
    });

    app.patch('/api/projects/:id', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const input = await parseJson(c, updateProjectSchema);
      const data = await this.projectService.update(actor, projectId, input);

      return c.json({ data });
    });

    app.delete('/api/projects/:id', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      await this.projectService.remove(actor, projectId);

      return c.json({ data: { success: true } });
    });

    app.post('/api/projects/:id/restore', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const data = await this.projectService.restore(actor, projectId);

      return c.json({ data });
    });
  }
}
