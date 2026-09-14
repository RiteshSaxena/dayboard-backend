import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import { createNoteSchema, noteQuerySchema, updateNoteSchema } from './note.schemas';
import type { NoteService } from './note.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/projects/:id/notes', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const query = noteQuerySchema.parse(c.req.query());
      const data = await this.noteService.list(actor, projectId, query.cursor);

      return c.json({ data });
    });

    app.post('/api/projects/:id/notes', async (c) => {
      const actor = requireActor(c);
      const projectId = parseId(c.req.param('id'));
      const input = await parseJson(c, createNoteSchema);
      const data = await this.noteService.create(actor, projectId, input);

      return c.json({ data }, 201);
    });

    app.patch('/api/notes/:id', async (c) => {
      const actor = requireActor(c);
      const noteId = parseId(c.req.param('id'));
      const input = await parseJson(c, updateNoteSchema);
      const data = await this.noteService.update(actor, noteId, input);

      return c.json({ data });
    });

    app.delete('/api/notes/:id', async (c) => {
      const actor = requireActor(c);
      const noteId = parseId(c.req.param('id'));
      await this.noteService.remove(actor, noteId);

      return c.json({ data: { success: true } });
    });

    app.post('/api/notes/:id/restore', async (c) => {
      const actor = requireActor(c);
      const noteId = parseId(c.req.param('id'));
      const data = await this.noteService.restore(actor, noteId);

      return c.json({ data });
    });
  }
}
