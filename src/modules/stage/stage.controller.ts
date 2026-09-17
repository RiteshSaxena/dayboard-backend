import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import {
  createStageSchema,
  deleteStageQuerySchema,
  reorderStagesSchema,
  updateStageSchema,
} from './stage.schemas';
import type { StageService } from './stage.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class StageController {
  constructor(private readonly stageService: StageService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/projects/:id/stages', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const data = await this.stageService.list(actor, projectId);

      return c.json({ data });
    });

    app.post('/api/projects/:id/stages', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const input = await parseJson(c, createStageSchema);
      const data = await this.stageService.create(actor, projectId, input);

      return c.json({ data }, 201);
    });

    app.post('/api/projects/:id/stages/reorder', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const input = await parseJson(c, reorderStagesSchema);
      const data = await this.stageService.reorder(actor, projectId, input.stageIds);

      return c.json({ data });
    });

    app.patch('/api/stages/:id', async (c) => {
      const actor = requireActor(c);
      const stageId = parseId(c.req.param('id'));
      const input = await parseJson(c, updateStageSchema);
      const data = await this.stageService.update(actor, stageId, input);

      return c.json({ data });
    });

    app.delete('/api/stages/:id', async (c) => {
      const actor = requireActor(c);
      const stageId = parseId(c.req.param('id'));
      const query = deleteStageQuerySchema.parse(c.req.query());
      await this.stageService.remove(actor, stageId, query.moveTo);

      return c.json({ data: { success: true } });
    });
  }
}
