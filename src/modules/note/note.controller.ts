import type { Hono } from "hono";
import type { AppBindings } from "../../core/http/app-bindings";
import { notFound } from "../../core/http/api-error";
import { idParamSchema, parseJson, requireActor } from "../../core/http/request";
import { createNoteSchema, noteQuerySchema, updateNoteSchema } from "./note.schemas";
import { NOTE_SERVICE } from "./note.tokens";

const id = (value: string): string => {
  const parsed = idParamSchema.safeParse(value);
  if (!parsed.success) throw notFound("Resource");
  return parsed.data;
};

export class NoteController {
  mount(app: Hono<AppBindings>): void {
    app.get("/api/projects/:id/notes", async (c) => {
      const query = noteQuerySchema.parse(c.req.query());
      return c.json({ data: await c.get("container").resolve(NOTE_SERVICE).list(requireActor(c), id(c.req.param("id")), query.cursor) });
    });
    app.post("/api/projects/:id/notes", async (c) => {
      const data = await c.get("container").resolve(NOTE_SERVICE).create(requireActor(c), id(c.req.param("id")), await parseJson(c, createNoteSchema));
      return c.json({ data }, 201);
    });
    app.patch("/api/notes/:id", async (c) =>
      c.json({ data: await c.get("container").resolve(NOTE_SERVICE).update(requireActor(c), id(c.req.param("id")), await parseJson(c, updateNoteSchema)) }));
    app.delete("/api/notes/:id", async (c) => {
      await c.get("container").resolve(NOTE_SERVICE).remove(requireActor(c), id(c.req.param("id")));
      return c.json({ data: { success: true } });
    });
    app.post("/api/notes/:id/restore", async (c) =>
      c.json({ data: await c.get("container").resolve(NOTE_SERVICE).restore(requireActor(c), id(c.req.param("id"))) }));
  }
}
