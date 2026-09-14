import { and, count, eq, isNull } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import { invites, memberships, orgs, users, type Invite, type Membership, type Org } from "../../database/schema";

export class OrgRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(org: Org, membership: Membership): Promise<void> {
    await this.database.db.batch([
      this.database.db.insert(orgs).values(org),
      this.database.db.insert(memberships).values(membership),
    ]);
  }

  async find(id: string): Promise<Org | null> {
    return (await this.database.db.query.orgs.findFirst({ where: and(eq(orgs.id, id), isNull(orgs.deletedAt)) })) ?? null;
  }

  async update(id: string, patch: Partial<Pick<Org, "name" | "updatedAt" | "deletedAt">>): Promise<Org | null> {
    await this.database.db.update(orgs).set(patch).where(eq(orgs.id, id));
    return this.find(id);
  }

  async listMembers(orgId: string) {
    return this.database.db
      .select({
        user: { id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl },
        role: memberships.role,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, orgId), isNull(users.deletedAt)))
      .orderBy(users.name);
  }

  async findMembership(orgId: string, userId: string): Promise<Membership | null> {
    return (await this.database.db.query.memberships.findFirst({
      where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
    })) ?? null;
  }

  async updateMembership(orgId: string, userId: string, role: Membership["role"]): Promise<void> {
    await this.database.db.update(memberships).set({ role }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  async removeMembership(orgId: string, userId: string): Promise<void> {
    await this.database.db.delete(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  async countOwners(orgId: string): Promise<number> {
    const rows = await this.database.db.select({ value: count() }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
    return rows[0]?.value ?? 0;
  }

  async countMembers(orgId: string): Promise<number> {
    const rows = await this.database.db.select({ value: count() }).from(memberships).where(eq(memberships.orgId, orgId));
    return rows[0]?.value ?? 0;
  }

  async transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void> {
    await this.database.db.batch([
      this.database.db.update(memberships).set({ role: "admin" }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, fromUserId))),
      this.database.db.update(memberships).set({ role: "owner" }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, toUserId))),
    ]);
  }

  async listInvites(orgId: string) {
    return this.database.db
      .select({ invite: invites, inviter: { id: users.id, name: users.name, email: users.email } })
      .from(invites)
      .innerJoin(users, eq(invites.invitedBy, users.id))
      .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .orderBy(invites.createdAt);
  }

  async findPendingInviteForEmail(orgId: string, email: string): Promise<Invite | null> {
    return (await this.database.db.query.invites.findFirst({
      where: and(eq(invites.orgId, orgId), eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
    })) ?? null;
  }

  async createInvite(invite: Invite): Promise<void> {
    await this.database.db.insert(invites).values(invite);
  }

  async findInvite(orgId: string, id: string): Promise<Invite | null> {
    return (await this.database.db.query.invites.findFirst({
      where: and(eq(invites.id, id), eq(invites.orgId, orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
    })) ?? null;
  }

  async replaceInviteToken(id: string, tokenHash: string, expiresAt: number, createdAt: number): Promise<void> {
    await this.database.db.update(invites).set({ tokenHash, expiresAt, createdAt }).where(eq(invites.id, id));
  }

  async revokeInvite(orgId: string, id: string, timestamp: number): Promise<void> {
    await this.database.db.update(invites).set({ revokedAt: timestamp }).where(and(eq(invites.id, id), eq(invites.orgId, orgId)));
  }

  async findInviteByTokenHash(tokenHash: string) {
    const rows = await this.database.db
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

  async acceptInvite(invite: Invite, userId: string, timestamp: number): Promise<boolean> {
    const results = await this.database.binding.batch([
      this.database.binding.prepare(`
        INSERT INTO memberships (org_id, user_id, role, joined_at)
        SELECT org_id, ?, role, ? FROM invites
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).bind(userId, timestamp, invite.id, timestamp),
      this.database.binding.prepare(`
        UPDATE invites SET accepted_at = ?
        WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `).bind(timestamp, invite.id, timestamp),
    ]);
    return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
  }

  async hasMemberWithEmail(orgId: string, email: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.orgId, orgId), eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return Boolean(rows[0]);
  }

  async getUserEmail(userId: string): Promise<string | null> {
    const user = await this.database.db.query.users.findFirst({ where: and(eq(users.id, userId), isNull(users.deletedAt)) });
    return user?.email ?? null;
  }
}
