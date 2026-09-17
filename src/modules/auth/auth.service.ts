import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { RuntimeContext } from '../../core/runtime/runtime-context';
import { ApiError, conflict, unauthenticated } from '../../core/http/api-error';
import { createId, createToken, sha256 } from '../../core/security/crypto';
import type { PasswordService } from '../../core/security/password';
import { normalizeEmail, now, slugify } from '../../core/utils/text';
import type { DrizzleDB } from '../../database/database';
import {
  activity,
  authTokens,
  invites,
  memberships,
  orgs,
  projectStages,
  projects,
  sessions,
  taskTypes,
  users,
  type Org,
  type Session,
  type User,
} from '../../database/schema';
import type { AuthActor } from './auth.types';
import { userDto } from './auth.types';
import type { MailService } from '../mail/mail.service';
import { buildDefaultProject } from '../project/project.service';
import { buildStarterStages } from '../stage/stage.service';
import { buildStarterTaskTypes } from '../task-type/task-type.service';
import type { RateLimitService } from '../security/rate-limit.service';
import type { TurnstileService } from '../security/turnstile.service';

const DAY = 86_400_000;
const SESSION_TTL = 30 * DAY;

export class AuthService {
  constructor(
    private readonly db: DrizzleDB,
    private readonly passwordService: PasswordService,
    private readonly turnstile: TurnstileService,
    private readonly rateLimit: RateLimitService,
    private readonly mail: MailService,
    private readonly runtime: RuntimeContext,
  ) {}

  async signup(input: {
    name: string;
    email: string;
    password: string;
    turnstile: string;
    inviteToken?: string;
  }) {
    const email = normalizeEmail(input.email);
    const ip = this.rateLimit.requestIp();
    await this.rateLimit.check('auth', `signup:${ip}`);
    await this.turnstile.verify(input.turnstile, 'signup');
    const existingUser = await this.findUserByEmail(email);
    if (existingUser) throw conflict('An account with this email already exists', 'email');
    // The invitation was emailed to this address, so signing up from its link proves the person owns it.
    const verifiedByInvite = input.inviteToken
      ? await this.isOpenInviteFor(input.inviteToken, email)
      : false;

    const timestamp = now();
    const userId = createId();
    const orgId = createId();
    const sessionId = createId();
    const rawSessionToken = createToken();
    const rawVerifyToken = createToken();
    const passwordHash = await this.passwordService.hash(input.password);
    const sessionTokenHash = await sha256(rawSessionToken);
    const verifyTokenHash = await sha256(rawVerifyToken);
    const user = {
      id: userId,
      email,
      emailVerifiedAt: verifiedByInvite ? timestamp : null,
      name: input.name.trim(),
      avatarUrl: null,
      passwordHash,
      googleSub: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const org = {
      id: orgId,
      name: `${user.name}'s board`,
      slug: `${slugify(user.name)}-${orgId.slice(-6).toLowerCase()}`,
      personal: true,
      createdBy: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    const session = {
      id: sessionId,
      userId,
      tokenHash: sessionTokenHash,
      userAgent: this.runtime.request.headers.get('user-agent'),
      ip: this.runtime.request.headers.get('cf-connecting-ip'),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: timestamp + SESSION_TTL,
    };
    const authToken: typeof authTokens.$inferInsert = {
      id: createId(),
      userId,
      kind: 'verify',
      tokenHash: verifyTokenHash,
      expiresAt: timestamp + DAY,
      usedAt: null,
      createdAt: timestamp,
    };

    await this.createSignup({ user, org, session, authToken: verifiedByInvite ? null : authToken });
    if (verifiedByInvite) this.mail.sendWelcome({ email, name: user.name });
    else this.mail.sendVerification({ name: user.name, email, token: rawVerifyToken });
    return {
      user: userDto(user),
      token: rawSessionToken,
      expiresAt: session.expiresAt,
      personalOrgId: orgId,
    };
  }

  async signin(input: { email: string; password: string }) {
    const email = normalizeEmail(input.email);
    const ip = this.rateLimit.requestIp();
    await Promise.all([
      this.rateLimit.check('auth', `signin-ip:${ip}`),
      this.rateLimit.check('auth', `signin-email:${email}`),
    ]);
    const user = await this.findUserByEmail(email);
    if (!user?.passwordHash) {
      throw new ApiError(401, 'unauthenticated', 'Invalid email or password');
    }

    const passwordIsValid = await this.passwordService.verify(input.password, user.passwordHash);
    if (!passwordIsValid) {
      throw new ApiError(401, 'unauthenticated', 'Invalid email or password');
    }

    const timestamp = now();
    const token = createToken();
    const tokenHash = await sha256(token);
    const session = {
      id: createId(),
      userId: user.id,
      tokenHash,
      userAgent: this.runtime.request.headers.get('user-agent'),
      ip: this.runtime.request.headers.get('cf-connecting-ip'),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: timestamp + SESSION_TTL,
    };
    await this.createSession(session);
    return { user: userDto(user), token, expiresAt: session.expiresAt };
  }

  async authenticate(authorization: string | undefined): Promise<AuthActor | null> {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
    if (!match?.[1]) return null;
    const tokenHash = await sha256(match[1]);
    const found = await this.findActorByTokenHash(tokenHash);
    if (!found) return null;
    const timestamp = now();
    if (found.session.expiresAt <= timestamp) {
      this.runtime.executionCtx.waitUntil(this.deleteSession(found.session.id));
      return null;
    }
    if (timestamp - found.session.lastSeenAt >= 3_600_000) {
      this.runtime.executionCtx.waitUntil(
        this.touchSession(found.session.id, timestamp, timestamp + SESSION_TTL),
      );
    }
    return found;
  }

  async signout(actor: AuthActor): Promise<void> {
    await this.deleteSession(actor.session.id);
  }

  async signoutAll(actor: AuthActor): Promise<void> {
    await this.deleteOtherSessions(actor.user.id, actor.session.id);
  }

  async resendVerification(actor: AuthActor): Promise<void> {
    if (actor.user.emailVerifiedAt) return;
    await this.rateLimit.check('email', `verify:${actor.user.id}`);
    const token = createToken();
    const timestamp = now();
    const tokenHash = await sha256(token);
    await this.createAuthToken({
      id: createId(),
      userId: actor.user.id,
      kind: 'verify',
      tokenHash,
      expiresAt: timestamp + DAY,
      usedAt: null,
      createdAt: timestamp,
    });
    this.mail.sendVerification({
      name: actor.user.name,
      email: actor.user.email,
      token,
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = await sha256(rawToken);
    const found = await this.findAuthToken(tokenHash, 'verify');
    if (!found) throw new ApiError(410, 'expired', 'Verification link is invalid or expired');
    if (found.token.usedAt || found.token.expiresAt <= now())
      throw new ApiError(410, 'expired', 'Verification link is invalid or expired');
    const firstVerification = !found.user.emailVerifiedAt;
    const timestamp = now();
    const tokenConsumed = await this.consumeVerifyToken(found.user.id, found.token.id, timestamp);
    if (!tokenConsumed) {
      throw new ApiError(410, 'expired', 'Verification link is invalid or expired');
    }
    if (firstVerification)
      this.mail.sendWelcome({ email: found.user.email, name: found.user.name });
  }

  async requestReset(input: { email: string; turnstile: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    await this.turnstile.verify(input.turnstile, 'reset_request');
    await this.rateLimit.check('email', `reset:${email}`);
    const user = await this.findUserByEmail(email);
    if (!user?.passwordHash) return;
    const token = createToken();
    const timestamp = now();
    const tokenHash = await sha256(token);
    await this.createAuthToken({
      id: createId(),
      userId: user.id,
      kind: 'reset',
      tokenHash,
      expiresAt: timestamp + 3_600_000,
      usedAt: null,
      createdAt: timestamp,
    });
    this.mail.sendReset({ email, token });
  }

  async resetPassword(rawToken: string, password: string): Promise<void> {
    const tokenHash = await sha256(rawToken);
    const found = await this.findAuthToken(tokenHash, 'reset');
    if (!found || found.token.usedAt || found.token.expiresAt <= now()) {
      throw new ApiError(410, 'expired', 'Reset link is invalid or expired');
    }
    const timestamp = now();
    const passwordHash = await this.passwordService.hash(password);
    const tokenConsumed = await this.consumeResetToken(
      found.user.id,
      found.token.id,
      passwordHash,
      timestamp,
    );
    if (!tokenConsumed) {
      throw new ApiError(410, 'expired', 'Reset link is invalid or expired');
    }
    this.sendPasswordChanged(found.user.email, timestamp);
  }

  async me(actor: AuthActor) {
    const orgRows = await this.listUserOrgs(actor.user.id);
    return {
      user: userDto(actor.user),
      orgs: orgRows.map(({ org, role }) => ({ ...org, role })),
      currentOrgId: orgRows[0]?.org.id ?? null,
    };
  }

  async updateMe(actor: AuthActor, patch: { name?: string; avatarUrl?: string | null }) {
    const timestamp = now();
    const user = await this.updateProfile(actor.user.id, patch, timestamp);
    return userDto(user);
  }

  async changePassword(actor: AuthActor, current: string, next: string): Promise<void> {
    if (!actor.user.passwordHash) throw unauthenticated();

    const currentPasswordIsValid = await this.passwordService.verify(
      current,
      actor.user.passwordHash,
    );
    if (!currentPasswordIsValid) {
      throw unauthenticated();
    }
    const timestamp = now();
    const passwordHash = await this.passwordService.hash(next);
    await this.persistPasswordChange(actor.user.id, actor.session.id, passwordHash, timestamp);
    this.sendPasswordChanged(actor.user.email, timestamp);
  }

  private sendPasswordChanged(email: string, timestamp: number): void {
    const request = this.runtime.request;
    this.mail.sendPasswordChanged({
      email,
      date: new Date(timestamp).toUTCString(),
      browser: request.headers.get('user-agent') ?? 'an unknown browser',
      city: typeof request.cf?.city === 'string' ? request.cf.city : 'an unknown location',
    });
  }

  /**
   * Whether the token belongs to an invitation that is still open and was sent to this address. A
   * wrong or stale token just means an ordinary signup, so nothing about the invitation is revealed.
   */
  private async isOpenInviteFor(rawToken: string, email: string): Promise<boolean> {
    const invite = await this.db.query.invites.findFirst({
      where: and(
        eq(invites.tokenHash, await sha256(rawToken)),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now()),
      ),
    });
    return !!invite && normalizeEmail(invite.email) === email;
  }

  private async findUserByEmail(email: string): Promise<User | null> {
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
    });
    return user ?? null;
  }

  private async findUserById(id: string): Promise<User | null> {
    const user = await this.db.query.users.findFirst({
      where: and(eq(users.id, id), isNull(users.deletedAt)),
    });
    return user ?? null;
  }

  private async createSignup(records: {
    user: User;
    org: Org;
    session: Session;
    /** The verification token; null when the account starts verified. */
    authToken: typeof authTokens.$inferInsert | null;
  }): Promise<void> {
    const timestamp = records.org.createdAt;
    const project = buildDefaultProject(records.org.id, records.user.id, timestamp);
    await this.db.batch([
      this.db.insert(users).values(records.user),
      this.db.insert(orgs).values(records.org),
      this.db.insert(memberships).values({
        orgId: records.org.id,
        userId: records.user.id,
        role: 'owner',
        joinedAt: records.user.createdAt,
      }),
      this.db.insert(sessions).values(records.session),
      ...(records.authToken ? [this.db.insert(authTokens).values(records.authToken)] : []),
      this.db.insert(taskTypes).values(buildStarterTaskTypes(records.org.id, timestamp)),
      this.db.insert(projects).values(project),
      this.db.insert(projectStages).values(buildStarterStages(project.id, timestamp)),
      this.db.insert(activity).values({
        id: createId(),
        orgId: records.org.id,
        projectId: project.id,
        actorId: records.user.id,
        kind: 'project.created',
        payload: project,
        createdAt: timestamp,
      }),
    ]);
  }

  private async createSession(session: Session): Promise<void> {
    await this.db.insert(sessions).values(session);
  }

  private async findActorByTokenHash(
    tokenHash: string,
  ): Promise<{ session: Session; user: User } | null> {
    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async touchSession(id: string, timestamp: number, expiresAt: number): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastSeenAt: timestamp, expiresAt })
      .where(eq(sessions.id, id));
  }

  private async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  private async deleteOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)));
  }

  private async createAuthToken(token: typeof authTokens.$inferInsert): Promise<void> {
    await this.db.insert(authTokens).values(token);
  }

  private async findAuthToken(tokenHash: string, kind: 'verify' | 'reset') {
    const rows = await this.db
      .select({ token: authTokens, user: users })
      .from(authTokens)
      .innerJoin(users, eq(authTokens.userId, users.id))
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.kind, kind),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async consumeVerifyToken(
    userId: string,
    tokenId: string,
    timestamp: number,
  ): Promise<boolean> {
    const client = this.db.binding;
    const results = await client.batch([
      client
        .prepare(
          `
        UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM auth_tokens WHERE id = ? AND user_id = ? AND kind = 'verify'
          AND used_at IS NULL AND expires_at > ?
        )
      `,
        )
        .bind(timestamp, timestamp, userId, tokenId, userId, timestamp),
      client
        .prepare(
          `
        UPDATE auth_tokens SET used_at = ?
        WHERE id = ? AND user_id = ? AND kind = 'verify' AND used_at IS NULL AND expires_at > ?
      `,
        )
        .bind(timestamp, tokenId, userId, timestamp),
    ]);
    return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
  }

  private async consumeResetToken(
    userId: string,
    tokenId: string,
    passwordHash: string,
    timestamp: number,
  ): Promise<boolean> {
    const pendingToken = `EXISTS (
      SELECT 1 FROM auth_tokens WHERE id = ? AND user_id = ? AND kind = 'reset'
      AND used_at IS NULL AND expires_at > ?
    )`;
    const client = this.db.binding;
    const results = await client.batch([
      client
        .prepare(
          `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND ${pendingToken}`,
        )
        .bind(passwordHash, timestamp, userId, tokenId, userId, timestamp),
      client
        .prepare(`DELETE FROM sessions WHERE user_id = ? AND ${pendingToken}`)
        .bind(userId, tokenId, userId, timestamp),
      client
        .prepare(
          `
        UPDATE auth_tokens SET used_at = ?
        WHERE id = ? AND user_id = ? AND kind = 'reset' AND used_at IS NULL AND expires_at > ?
      `,
        )
        .bind(timestamp, tokenId, userId, timestamp),
    ]);
    return results[0]?.meta.changes === 1 && results[2]?.meta.changes === 1;
  }

  private async updateProfile(
    userId: string,
    patch: { name?: string; avatarUrl?: string | null },
    timestamp: number,
  ): Promise<User> {
    await this.db
      .update(users)
      .set({ ...patch, updatedAt: timestamp })
      .where(eq(users.id, userId));
    const user = await this.findUserById(userId);
    if (!user) throw new Error('Updated user disappeared');
    return user;
  }

  private async persistPasswordChange(
    userId: string,
    currentSessionId: string,
    passwordHash: string,
    timestamp: number,
  ): Promise<void> {
    await this.db.batch([
      this.db.update(users).set({ passwordHash, updatedAt: timestamp }).where(eq(users.id, userId)),
      this.db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId))),
    ]);
  }

  private listUserOrgs(userId: string) {
    return this.db
      .select({ org: orgs, role: memberships.role })
      .from(memberships)
      .innerJoin(orgs, eq(memberships.orgId, orgs.id))
      .where(and(eq(memberships.userId, userId), isNull(orgs.deletedAt)))
      .orderBy(orgs.createdAt);
  }
}
