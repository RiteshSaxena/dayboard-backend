import type { Hono } from "hono";
import type { AppBindings } from "../../core/http/app-bindings";
import { notFound } from "../../core/http/api-error";
import { idParamSchema, parseJson, requireActor } from "../../core/http/request";
import { createProjectSchema, updateProjectSchema } from "./project.schemas";
import { PROJECT_SERVICE } from "./project.tokens";

const id = (value: string): string => {
  const parsed = idParamSchema.safeParse(value);
  if (!parsed.success) throw notFound("Resource");
  return parsed.data;
};

export class ProjectController {
  mount(app: Hono<AppBindings>): void {
    app.get("/api/orgs/:orgId/board", async (c) =>
      c.json({ data: await c.get("container").resolve(PROJECT_SERVICE).board(requireActor(c), id(c.req.param("orgId"))) }));
    app.get("/api/orgs/:orgId/projects", async (c) =>
      c.json({ data: await c.get("container").resolve(PROJECT_SERVICE).list(requireActor(c), id(c.req.param("orgId"))) }));
    app.post("/api/orgs/:orgId/projects", async (c) => {
      const data = await c.get("container").resolve(PROJECT_SERVICE).create(requireActor(c), id(c.req.param("orgId")), await parseJson(c, createProjectSchema));
      return c.json({ data }, 201);
    });
    app.patch("/api/projects/:id", async (c) =>
      c.json({ data: await c.get("container").resolve(PROJECT_SERVICE).update(requireActor(c), id(c.req.param("id")), await parseJson(c, updateProjectSchema)) }));
    app.delete("/api/projects/:id", async (c) => {
      await c.get("container").resolve(PROJECT_SERVICE).remove(requireActor(c), id(c.req.param("id")));
      return c.json({ data: { success: true } });
    });
    app.post("/api/projects/:id/restore", async (c) =>
      c.json({ data: await c.get("container").resolve(PROJECT_SERVICE).restore(requireActor(c), id(c.req.param("id"))) }));
  }
}
