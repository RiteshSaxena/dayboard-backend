import type { Hono } from "hono";
import type { AppBindings } from "../../core/http/app-bindings";
import { notFound } from "../../core/http/api-error";
import { idParamSchema, parseJson, requireActor } from "../../core/http/request";
import { createInviteSchema, createOrgSchema, transferOrgSchema, updateMemberSchema, updateOrgSchema } from "./org.schemas";
import { ORG_SERVICE } from "./org.tokens";

const param = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound("Resource");
  return result.data;
};

export class OrgController {
  mount(app: Hono<AppBindings>): void {
    app.post("/api/orgs", async (c) => {
      const input = await parseJson(c, createOrgSchema);
      return c.json({ data: await c.get("container").resolve(ORG_SERVICE).create(requireActor(c), input.name) }, 201);
    });
    app.patch("/api/orgs/:orgId", async (c) => {
      const input = await parseJson(c, updateOrgSchema);
      return c.json({ data: await c.get("container").resolve(ORG_SERVICE).update(requireActor(c), param(c.req.param("orgId")), input.name) });
    });
    app.delete("/api/orgs/:orgId", async (c) => {
      await c.get("container").resolve(ORG_SERVICE).remove(requireActor(c), param(c.req.param("orgId")));
      return c.json({ data: { success: true } });
    });
    app.get("/api/orgs/:orgId/members", async (c) =>
      c.json({ data: await c.get("container").resolve(ORG_SERVICE).members(requireActor(c), param(c.req.param("orgId"))) }));
    app.patch("/api/orgs/:orgId/members/:userId", async (c) => {
      const input = await parseJson(c, updateMemberSchema);
      await c.get("container").resolve(ORG_SERVICE).updateMember(requireActor(c), param(c.req.param("orgId")), param(c.req.param("userId")), input.role);
      return c.json({ data: { success: true } });
    });
    app.delete("/api/orgs/:orgId/members/:userId", async (c) => {
      await c.get("container").resolve(ORG_SERVICE).removeMember(requireActor(c), param(c.req.param("orgId")), param(c.req.param("userId")));
      return c.json({ data: { success: true } });
    });
    app.post("/api/orgs/:orgId/transfer", async (c) => {
      const input = await parseJson(c, transferOrgSchema);
      await c.get("container").resolve(ORG_SERVICE).transfer(requireActor(c), param(c.req.param("orgId")), input.userId);
      return c.json({ data: { success: true } });
    });
    app.get("/api/orgs/:orgId/invites", async (c) =>
      c.json({ data: await c.get("container").resolve(ORG_SERVICE).invites(requireActor(c), param(c.req.param("orgId"))) }));
    app.post("/api/orgs/:orgId/invites", async (c) => {
      const input = await parseJson(c, createInviteSchema);
      const data = await c.get("container").resolve(ORG_SERVICE).invite(requireActor(c), param(c.req.param("orgId")), input.email, input.role);
      return c.json({ data }, 201);
    });
    app.post("/api/orgs/:orgId/invites/:inviteId/resend", async (c) => {
      await c.get("container").resolve(ORG_SERVICE).resendInvite(requireActor(c), param(c.req.param("orgId")), param(c.req.param("inviteId")));
      return c.json({ data: { success: true } });
    });
    app.delete("/api/orgs/:orgId/invites/:inviteId", async (c) => {
      await c.get("container").resolve(ORG_SERVICE).revokeInvite(requireActor(c), param(c.req.param("orgId")), param(c.req.param("inviteId")));
      return c.json({ data: { success: true } });
    });
    app.get("/api/invites/:token", async (c) =>
      c.json({ data: await c.get("container").resolve(ORG_SERVICE).invitePreview(c.req.param("token")) }));
    app.post("/api/invites/:token/accept", async (c) => {
      await c.get("container").resolve(ORG_SERVICE).acceptInvite(requireActor(c), c.req.param("token"));
      return c.json({ data: { success: true } });
    });
  }
}
