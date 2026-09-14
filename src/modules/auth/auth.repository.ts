import { and, eq, isNull, ne } from "drizzle-orm";
import type { DatabaseService } from "../../database/database.service";
import {
  authTokens,
  memberships,
  orgs,
  sessions,
  users,
  type Org,
  type Session,
  type User,
} from "../../database/schema";

export interface SignupRecords {
  user: User;
  org: Org;
  session: Session;
  authToken: typeof authTokens.$inferInsert;
}

export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return (await this.database.db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
    })) ?? null;
  }

  async findUserById(id: string): Promise<User | null> {
    return (await this.database.db.query.users.findFirst({
      where: and(eq(users.id, id), isNull(users.deletedAt)),
    })) ?? null;
  }

  async createSignup(records: SignupRecords): Promise<void> {
    await this.database.db.batch([
      this.database.db.insert(users).values(records.user),
      this.database.db.insert(orgs).values(records.org),
      this.database.db.insert(memberships).values({
        orgId: records.org.id,
        userId: records.user.id,
        role: "owner",
        joinedAt: records.user.createdAt,
      }),
      this.database.db.insert(sessions).values(records.session),
      this.database.db.insert(authTokens).values(records.authToken),
    ]);
  }

  async createSession(session: Session): Promise<void> {
    await this.database.db.insert(sessions).values(session);
  }

  async findActorByTokenHash(tokenHash: string): Promise<{ session: Session; user: User } | null> {
    const rows = await this.database.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async touchSession(id: string, timestamp: number, expiresAt: number): Promise<void> {
    await this.database.db.update(sessions).set({ lastSeenAt: timestamp, expiresAt }).where(eq(sessions.id, id));
  }

  async deleteSession(id: string): Promise<void> {
    await this.database.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.database.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
  }

  async createAuthToken(token: typeof authTokens.$inferInsert): Promise<void> {
    await this.database.db.insert(authTokens).values(token);
  }

  async findAuthToken(tokenHash: string, kind: "verify" | "reset") {
    const rows = await this.database.db
      .select({ token: authTokens, user: users })
      .from(authTokens)
      .innerJoin(users, eq(authTokens.userId, users.id))
      .where(and(eq(authTokens.tokenHash, tokenHash), eq(authTokens.kind, kind), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async verifyEmail(userId: string, tokenId: string, timestamp: number): Promise<boolean> {
    const results = await this.database.binding.batch([
      this.database.binding.prepare(`
        UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM auth_tokens WHERE id = ? AND user_id = ? AND kind = 'verify'
          AND used_at IS NULL AND expires_at > ?
        )
      `).bind(timestamp, timestamp, userId, tokenId, userId, timestamp),
      this.database.binding.prepare(`
        UPDATE auth_tokens SET used_at = ?
        WHERE id = ? AND user_id = ? AND kind = 'verify' AND used_at IS NULL AND expires_at > ?
      `).bind(timestamp, tokenId, userId, timestamp),
    ]);
    return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
  }

  async resetPassword(userId: string, tokenId: string, passwordHash: string, timestamp: number): Promise<boolean> {
    const pendingToken = `EXISTS (
      SELECT 1 FROM auth_tokens WHERE id = ? AND user_id = ? AND kind = 'reset'
      AND used_at IS NULL AND expires_at > ?
    )`;
    const results = await this.database.binding.batch([
      this.database.binding.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND ${pendingToken}`)
        .bind(passwordHash, timestamp, userId, tokenId, userId, timestamp),
      this.database.binding.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${pendingToken}`)
        .bind(userId, tokenId, userId, timestamp),
      this.database.binding.prepare(`
        UPDATE auth_tokens SET used_at = ?
        WHERE id = ? AND user_id = ? AND kind = 'reset' AND used_at IS NULL AND expires_at > ?
      `).bind(timestamp, tokenId, userId, timestamp),
    ]);
    return results[0]?.meta.changes === 1 && results[2]?.meta.changes === 1;
  }

  async updateProfile(userId: string, patch: { name?: string; avatarUrl?: string | null }, timestamp: number): Promise<User> {
    await this.database.db.update(users).set({ ...patch, updatedAt: timestamp }).where(eq(users.id, userId));
    const user = await this.findUserById(userId);
    if (!user) throw new Error("Updated user disappeared");
    return user;
  }

  async changePassword(userId: string, currentSessionId: string, passwordHash: string, timestamp: number): Promise<void> {
    await this.database.db.batch([
      this.database.db.update(users).set({ passwordHash, updatedAt: timestamp }).where(eq(users.id, userId)),
      this.database.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId))),
    ]);
  }

  async listUserOrgs(userId: string) {
    return this.database.db
      .select({ org: orgs, role: memberships.role })
      .from(memberships)
      .innerJoin(orgs, eq(memberships.orgId, orgs.id))
      .where(and(eq(memberships.userId, userId), isNull(orgs.deletedAt)))
      .orderBy(orgs.createdAt);
  }

}
