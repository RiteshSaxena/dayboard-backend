import { and, count, eq, isNull } from 'drizzle-orm';
import { ApiError, conflict, forbidden, notFound } from '../../core/http/api-error';
import { createId, createToken, sha256 } from '../../core/security/crypto';
import { normalizeEmail, now, slugify } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import {
  invites,
  memberships,
  orgs,
  users,
  type Invite,
  type Membership,
  type Org,
} from '../../database/schema';
import type { AuthActor } from '../auth/auth.types';
import type { ActivityService } from '../activity/activity.service';
import type { AuthorizationService, Role } from '../authorization/authorization.service';
import type { MailService } from '../mail/mail.service';
import type { RateLimitService } from '../security/rate-limit.service';

const DAY = 86_400_000;

export class OrgService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly authorization: AuthorizationService,
    private readonly rateLimit: RateLimitService,
    private readonly mail: MailService,
    private readonly activity: ActivityService,
  ) {}

  async create(actor: AuthActor, name: string) {
    this.authorization.requireVerified(actor);
    const timestamp = now();
    const id = createId();
    const org = {
      id,
      name,
      slug: `${slugify(name)}-${id.slice(-6).toLowerCase()}`,
      personal: false,
      createdBy: actor.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.insertOrg(org, {
      orgId: id,
      userId: actor.user.id,
      role: 'owner',
      joinedAt: timestamp,
    });
    return { ...org, role: 'owner' as const };
  }

  async update(actor: AuthActor, orgId: string, name: string) {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const timestamp = now();
    return this.updateOrg(orgId, { name, updatedAt: timestamp });
  }

  async remove(actor: AuthActor, orgId: string): Promise<void> {
    const membership = await this.authorization.requireOrg(actor, orgId, 'owner');
    if (membership.role !== 'owner') throw forbidden();
    const org = await this.findOrg(orgId);
    if (!org) throw notFound('Organization');
    if (org.personal) throw conflict('A personal organization cannot be deleted');
    const timestamp = now();
    await this.updateOrg(orgId, { deletedAt: timestamp, updatedAt: timestamp });
  }

  async members(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.listMembers(orgId);
  }

  async updateMember(
    actor: AuthActor,
    orgId: string,
    userId: string,
    role: Exclude<Role, 'owner'>,
  ): Promise<void> {
    const actorMembership = await this.authorization.requireOrg(actor, orgId, 'admin');
    const target = await this.findMembership(orgId, userId);
    if (!target) throw notFound('Member');
    if (userId === actor.user.id)
      throw conflict('Use the leave endpoint to change your own membership');
    if (!this.authorization.canManageRole(actorMembership.role, target.role)) throw forbidden();
    if (!this.authorization.canManageRole(actorMembership.role, role)) throw forbidden();
    await this.updateMembership(orgId, userId, role);
  }

  async removeMember(actor: AuthActor, orgId: string, userId: string): Promise<void> {
    const actorMembership = await this.authorization.requireOrg(actor, orgId);
    const target = await this.findMembership(orgId, userId);
    if (!target) throw notFound('Member');
    const org = await this.findOrg(orgId);
    if (org?.personal)
      throw conflict('A personal organization cannot be left or have members removed');

    if (userId !== actor.user.id) {
      if (actorMembership.role !== 'owner' && actorMembership.role !== 'admin') throw forbidden();
      if (!this.authorization.canManageRole(actorMembership.role, target.role)) throw forbidden();
    }
    const ownerCount = await this.countOwners(orgId);
    if (target.role === 'owner' && ownerCount <= 1) {
      throw conflict('The last owner cannot leave or be removed');
    }
    await this.removeMembership(orgId, userId);
  }

  async transfer(actor: AuthActor, orgId: string, userId: string): Promise<void> {
    const actorMembership = await this.authorization.requireOrg(actor, orgId, 'owner');
    if (actorMembership.role !== 'owner') throw forbidden();
    const target = await this.findMembership(orgId, userId);
    if (!target) throw notFound('Member');
    if (target.userId === actor.user.id) throw conflict('You already own this organization');
    await this.transferOwnership(orgId, actor.user.id, target.userId);
  }

  async invites(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const rows = await this.listInvites(orgId);
    return rows.map(({ invite, inviter }) => ({
      invite: {
        id: invite.id,
        orgId: invite.orgId,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        revokedAt: invite.revokedAt,
        createdAt: invite.createdAt,
      },
      inviter,
    }));
  }

  async invite(actor: AuthActor, orgId: string, emailInput: string, role: Exclude<Role, 'owner'>) {
    this.authorization.requireVerified(actor);
    const membership = await this.authorization.requireOrg(actor, orgId, 'admin');
    if (!this.authorization.canManageRole(membership.role, role)) throw forbidden();
    await this.rateLimit.check('invite', `org:${orgId}`);
    const org = await this.findOrg(orgId);
    if (!org || org.personal) throw conflict('Personal organizations cannot have members');
    const email = normalizeEmail(emailInput);
    const existingMember = await this.hasMemberWithEmail(orgId, email);
    if (existingMember) throw conflict('This person is already a member', 'email');

    const pendingInvite = await this.findPendingInviteForEmail(orgId, email);
    if (pendingInvite) throw conflict('A pending invitation already exists', 'email');

    const memberCount = await this.countMembers(orgId);
    if (memberCount >= 100) throw conflict('This organization has reached its member limit');

    const rawToken = createToken();
    const timestamp = now();
    const tokenHash = await sha256(rawToken);
    const invite = {
      id: createId(),
      orgId,
      email,
      role,
      tokenHash,
      invitedBy: actor.user.id,
      expiresAt: timestamp + 7 * DAY,
      acceptedAt: null,
      revokedAt: null,
      createdAt: timestamp,
    };
    await this.createInvite(invite);
    this.mail.sendInvite({
      email,
      inviter: actor.user.name,
      inviterEmail: actor.user.email,
      org: org.name,
      role,
      token: rawToken,
    });
    return {
      id: invite.id,
      orgId: invite.orgId,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    };
  }

  async resendInvite(actor: AuthActor, orgId: string, inviteId: string): Promise<void> {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const invite = await this.findInvite(orgId, inviteId);
    const org = await this.findOrg(orgId);
    if (!invite || !org) throw notFound('Invitation');
    const token = createToken();
    const timestamp = now();
    const tokenHash = await sha256(token);
    await this.replaceInviteToken(invite.id, tokenHash, timestamp + 7 * DAY, timestamp);
    this.mail.sendInvite({
      email: invite.email,
      inviter: actor.user.name,
      inviterEmail: actor.user.email,
      org: org.name,
      role: invite.role,
      token,
    });
  }

  async revokeInvite(actor: AuthActor, orgId: string, inviteId: string): Promise<void> {
    await this.authorization.requireOrg(actor, orgId, 'admin');
    const invite = await this.findInvite(orgId, inviteId);
    if (!invite) throw notFound('Invitation');

    const timestamp = now();
    await this.setInviteRevoked(orgId, inviteId, timestamp);
  }

  async invitePreview(rawToken: string) {
    const tokenHash = await sha256(rawToken);
    const found = await this.findInviteByTokenHash(tokenHash);
    if (
      !found ||
      found.invite.acceptedAt ||
      found.invite.revokedAt ||
      found.invite.expiresAt <= now()
    ) {
      throw new ApiError(410, 'expired', 'Invitation is invalid or expired');
    }
    return {
      org: { id: found.org.id, name: found.org.name },
      inviter: { id: found.inviter.id, name: found.inviter.name },
      role: found.invite.role,
      expiresAt: found.invite.expiresAt,
    };
  }

  async acceptInvite(actor: AuthActor, rawToken: string): Promise<void> {
    this.authorization.requireVerified(actor);
    const tokenHash = await sha256(rawToken);
    const found = await this.findInviteByTokenHash(tokenHash);
    if (
      !found ||
      found.invite.acceptedAt ||
      found.invite.revokedAt ||
      found.invite.expiresAt <= now()
    ) {
      throw new ApiError(410, 'expired', 'Invitation is invalid or expired');
    }
    const existingMembership = await this.findMembership(found.org.id, actor.user.id);
    if (existingMembership) throw conflict('You are already a member');

    const memberCount = await this.countMembers(found.org.id);
    if (memberCount >= 100) throw conflict('This organization has reached its member limit');

    const acceptedAt = now();
    const accepted = await this.consumeInvite(found.invite, actor.user.id, acceptedAt);
    if (!accepted) {
      throw new ApiError(410, 'expired', 'Invitation is invalid or expired');
    }
    await this.activity.record({
      orgId: found.org.id,
      actorId: actor.user.id,
      kind: 'member.joined',
      payload: {
        userId: actor.user.id,
        name: actor.user.name,
        role: found.invite.role,
      },
    });
    const inviterEmail = await this.getUserEmail(found.invite.invitedBy);
    if (inviterEmail) {
      this.mail.sendMemberJoined({
        to: inviterEmail,
        name: actor.user.name,
        email: actor.user.email,
        org: found.org.name,
        role: found.invite.role,
        orgId: found.org.id,
      });
    }
  }

  private async insertOrg(org: Org, membership: Membership): Promise<void> {
    await this.db.batch([
      this.db.insert(orgs).values(org),
      this.db.insert(memberships).values(membership),
    ]);
  }

  private async findOrg(id: string): Promise<Org | null> {
    const org = await this.db.query.orgs.findFirst({
      where: and(eq(orgs.id, id), isNull(orgs.deletedAt)),
    });
    return org ?? null;
  }

  private async updateOrg(
    id: string,
    patch: Partial<Pick<Org, 'name' | 'updatedAt' | 'deletedAt'>>,
  ): Promise<Org | null> {
    await this.db.update(orgs).set(patch).where(eq(orgs.id, id));
    return this.findOrg(id);
  }

  private listMembers(orgId: string) {
    return this.db
      .select({
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
        role: memberships.role,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, orgId), isNull(users.deletedAt)))
      .orderBy(users.name);
  }

  private async findMembership(orgId: string, userId: string): Promise<Membership | null> {
    const membership = await this.db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
    });
    return membership ?? null;
  }

  private async updateMembership(
    orgId: string,
    userId: string,
    role: Membership['role'],
  ): Promise<void> {
    await this.db
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  private async removeMembership(orgId: string, userId: string): Promise<void> {
    await this.db
      .delete(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  private async countOwners(orgId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
    return rows[0]?.value ?? 0;
  }

  private async countMembers(orgId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(memberships)
      .where(eq(memberships.orgId, orgId));
    return rows[0]?.value ?? 0;
  }

  private async transferOwnership(
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<void> {
    await this.db.batch([
      this.db
        .update(memberships)
        .set({ role: 'admin' })
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, fromUserId))),
      this.db
        .update(memberships)
        .set({ role: 'owner' })
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, toUserId))),
    ]);
  }

  private listInvites(orgId: string) {
    return this.db
      .select({
        invite: invites,
        inviter: { id: users.id, name: users.name, email: users.email },
      })
      .from(invites)
      .innerJoin(users, eq(invites.invitedBy, users.id))
      .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .orderBy(invites.createdAt);
  }

  private async findPendingInviteForEmail(orgId: string, email: string): Promise<Invite | null> {
    const invite = await this.db.query.invites.findFirst({
      where: and(
        eq(invites.orgId, orgId),
        eq(invites.email, email),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
      ),
    });
    return invite ?? null;
  }

  private async createInvite(invite: Invite): Promise<void> {
    await this.db.insert(invites).values(invite);
  }

  private async findInvite(orgId: string, id: string): Promise<Invite | null> {
    const invite = await this.db.query.invites.findFirst({
      where: and(
        eq(invites.id, id),
        eq(invites.orgId, orgId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
      ),
    });
    return invite ?? null;
  }

  private async replaceInviteToken(
    id: string,
    tokenHash: string,
    expiresAt: number,
    createdAt: number,
  ): Promise<void> {
    await this.db
      .update(invites)
      .set({ tokenHash, expiresAt, createdAt })
      .where(eq(invites.id, id));
  }

  private async setInviteRevoked(orgId: string, id: string, timestamp: number): Promise<void> {
    await this.db
      .update(invites)
      .set({ revokedAt: timestamp })
      .where(and(eq(invites.id, id), eq(invites.orgId, orgId)));
  }

  private async findInviteByTokenHash(tokenHash: string) {
    const rows = await this.db
      .select({
        invite: invites,
        org: orgs,
        inviter: { id: users.id, name: users.name, email: users.email },
      })
      .from(invites)
      .innerJoin(orgs, eq(invites.orgId, orgs.id))
      .innerJoin(users, eq(invites.invitedBy, users.id))
      .where(and(eq(invites.tokenHash, tokenHash), isNull(orgs.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async consumeInvite(invite: Invite, userId: string, timestamp: number): Promise<boolean> {
    const client = this.db.binding;
    const results = await client.batch([
      client
        .prepare(
          `
        INSERT INTO memberships (org_id, user_id, role, joined_at)
        SELECT org_id, ?, role, ? FROM invites
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `,
        )
        .bind(userId, timestamp, invite.id, timestamp),
      client
        .prepare(
          `
        UPDATE invites SET accepted_at = ?
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `,
        )
        .bind(timestamp, invite.id, timestamp),
    ]);
    return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
  }

  private async hasMemberWithEmail(orgId: string, email: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, orgId), eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return Boolean(rows[0]);
  }

  private async getUserEmail(userId: string): Promise<string | null> {
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
    });
    return user?.email ?? null;
  }
}
