import type { Hono } from "hono";
import type { AppBindings } from "../../core/http/app-bindings";
import { notFound } from "../../core/http/api-error";
import { idParamSchema, requireActor } from "../../core/http/request";
import { ACTIVITY_SERVICE } from "./activity.tokens";

export class ActivityController {
  mount(app: Hono<AppBindings>): void {
    app.get("/api/projects/:id/activity", async (c) => {
      const id = idParamSchema.safeParse(c.req.param("id"));
      if (!id.success) throw notFound("Project");
      const data = await c.get("container").resolve(ACTIVITY_SERVICE).list(requireActor(c), id.data, c.req.query("cursor"));
      return c.json({ data });
    });
  }
}
