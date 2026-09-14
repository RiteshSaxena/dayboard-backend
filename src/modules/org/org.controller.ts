import type { Hono } from 'hono';
import { notFound } from '../../core/http/api-error';
import type { AppBindings } from '../../core/http/app-bindings';
import { idParamSchema, parseJson, requireActor } from '../../core/http/request';
import {
  createInviteSchema,
  createOrgSchema,
  transferOrgSchema,
  updateMemberSchema,
  updateOrgSchema,
} from './org.schemas';
import type { OrgService } from './org.service';

const parseId = (value: string): string => {
  const result = idParamSchema.safeParse(value);
  if (!result.success) throw notFound('Resource');
  return result.data;
};

export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  mount(app: Hono<AppBindings>): void {
    app.post('/api/orgs', async (c) => {
      const actor = requireActor(c);
      const input = await parseJson(c, createOrgSchema);
      const data = await this.orgService.create(actor, input.name);

      return c.json({ data }, 201);
    });

    app.patch('/api/orgs/:orgId', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const input = await parseJson(c, updateOrgSchema);
      const data = await this.orgService.update(actor, orgId, input.name);

      return c.json({ data });
    });

    app.delete('/api/orgs/:orgId', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      await this.orgService.remove(actor, orgId);

      return c.json({ data: { success: true } });
    });

    app.get('/api/orgs/:orgId/members', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.orgService.members(actor, orgId);

      return c.json({ data });
    });

    app.patch('/api/orgs/:orgId/members/:userId', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const userId = parseId(c.req.param('userId'));
      const input = await parseJson(c, updateMemberSchema);
      await this.orgService.updateMember(actor, orgId, userId, input.role);

      return c.json({ data: { success: true } });
    });

    app.delete('/api/orgs/:orgId/members/:userId', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const userId = parseId(c.req.param('userId'));
      await this.orgService.removeMember(actor, orgId, userId);

      return c.json({ data: { success: true } });
    });

    app.post('/api/orgs/:orgId/transfer', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const input = await parseJson(c, transferOrgSchema);
      await this.orgService.transfer(actor, orgId, input.userId);

      return c.json({ data: { success: true } });
    });

    app.get('/api/orgs/:orgId/invites', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const data = await this.orgService.invites(actor, orgId);

      return c.json({ data });
    });

    app.post('/api/orgs/:orgId/invites', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const input = await parseJson(c, createInviteSchema);
      const data = await this.orgService.invite(actor, orgId, input.email, input.role);

      return c.json({ data }, 201);
    });

    app.post('/api/orgs/:orgId/invites/:inviteId/resend', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const inviteId = parseId(c.req.param('inviteId'));
      await this.orgService.resendInvite(actor, orgId, inviteId);

      return c.json({ data: { success: true } });
    });

    app.delete('/api/orgs/:orgId/invites/:inviteId', async (c) => {
      const actor = requireActor(c);
      const orgId = parseId(c.req.param('orgId'));
      const inviteId = parseId(c.req.param('inviteId'));
      await this.orgService.revokeInvite(actor, orgId, inviteId);

      return c.json({ data: { success: true } });
    });

    app.get('/api/invites/:token', async (c) => {
      const token = c.req.param('token');
      const data = await this.orgService.invitePreview(token);

      return c.json({ data });
    });

    app.post('/api/invites/:token/accept', async (c) => {
      const actor = requireActor(c);
      const token = c.req.param('token');
      await this.orgService.acceptInvite(actor, token);

      return c.json({ data: { success: true } });
    });
  }
}
