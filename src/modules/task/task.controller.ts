import type { Hono } from "hono";
import type { AppBindings } from "../../core/http/app-bindings";
import { notFound } from "../../core/http/api-error";
import { idParamSchema, parseJson, requireActor } from "../../core/http/request";
import { createTaskSchema, moveTaskSchema, taskQuerySchema, updateTaskSchema } from "./task.schemas";
import { TASK_SERVICE } from "./task.tokens";

const id = (value: string): string => {
  const parsed = idParamSchema.safeParse(value);
  if (!parsed.success) throw notFound("Resource");
  return parsed.data;
};

export class TaskController {
  mount(app: Hono<AppBindings>): void {
    app.get("/api/projects/:id/tasks", async (c) => {
      const query = taskQuerySchema.parse(c.req.query());
      return c.json({ data: await c.get("container").resolve(TASK_SERVICE).list(requireActor(c), id(c.req.param("id")), query) });
    });
    app.post("/api/projects/:id/tasks", async (c) => {
      const data = await c.get("container").resolve(TASK_SERVICE).create(requireActor(c), id(c.req.param("id")), await parseJson(c, createTaskSchema));
      return c.json({ data }, 201);
    });
    app.patch("/api/tasks/:id", async (c) =>
      c.json({ data: await c.get("container").resolve(TASK_SERVICE).update(requireActor(c), id(c.req.param("id")), await parseJson(c, updateTaskSchema)) }));
    app.post("/api/tasks/:id/move", async (c) => {
      const input = await parseJson(c, moveTaskSchema);
      return c.json({ data: await c.get("container").resolve(TASK_SERVICE).move(requireActor(c), id(c.req.param("id")), input.status) });
    });
    app.post("/api/tasks/:id/archive", async (c) =>
      c.json({ data: await c.get("container").resolve(TASK_SERVICE).archive(requireActor(c), id(c.req.param("id"))) }));
    app.post("/api/tasks/:id/unarchive", async (c) =>
      c.json({ data: await c.get("container").resolve(TASK_SERVICE).unarchive(requireActor(c), id(c.req.param("id"))) }));
    app.delete("/api/tasks/:id", async (c) => {
      await c.get("container").resolve(TASK_SERVICE).remove(requireActor(c), id(c.req.param("id")));
      return c.json({ data: { success: true } });
    });
    app.post("/api/tasks/:id/restore", async (c) =>
      c.json({ data: await c.get("container").resolve(TASK_SERVICE).restore(requireActor(c), id(c.req.param("id"))) }));
    app.post("/api/projects/:id/tasks/archive-done", async (c) =>
      c.json({ data: await c.get("container").resolve(TASK_SERVICE).archiveDone(requireActor(c), id(c.req.param("id"))) }));
    app.get("/api/orgs/:orgId/tasks/mine", async (c) =>
      c.json({ data: await c.get("container").resolve(TASK_SERVICE).mine(requireActor(c), id(c.req.param("orgId"))) }));
  }
}
