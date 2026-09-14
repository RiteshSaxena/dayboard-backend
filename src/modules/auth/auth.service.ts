import type { RuntimeContext } from "../../core/runtime/runtime-context";
import { ApiError, conflict, unauthenticated } from "../../core/http/api-error";
import { createId, createToken, sha256 } from "../../core/security/crypto";
import type { PasswordService } from "../../core/security/password";
import { normalizeEmail, now, slugify } from "../../core/utils/text";
import type { AuthTokensInsert } from "./auth.tokens";
import type { AuthRepository } from "./auth.repository";
import type { AuthActor } from "./auth.types";
import { userDto } from "./auth.types";
import type { MailService } from "../mail/mail.service";
import type { RateLimitService } from "../security/rate-limit.service";
import type { TurnstileService } from "../security/turnstile.service";

const DAY = 86_400_000;
const SESSION_TTL = 30 * DAY;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordService: PasswordService,
    private readonly turnstile: TurnstileService,
    private readonly rateLimit: RateLimitService,
    private readonly mail: MailService,
    private readonly runtime: RuntimeContext,
  ) {}

  async signup(input: { name: string; email: string; password: string; turnstile: string }) {
    const email = normalizeEmail(input.email);
    await this.rateLimit.check("auth", `signup:${this.rateLimit.requestIp()}`);
    await this.turnstile.verify(input.turnstile, "signup");
    if (await this.repository.findUserByEmail(email)) throw conflict("An account with this email already exists", "email");

    const timestamp = now();
    const userId = createId();
    const orgId = createId();
    const sessionId = createId();
    const rawSessionToken = createToken();
    const rawVerifyToken = createToken();
    const user = {
      id: userId,
      email,
      emailVerifiedAt: null,
      name: input.name.trim(),
      avatarUrl: null,
      passwordHash: await this.passwordService.hash(input.password),
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
      tokenHash: await sha256(rawSessionToken),
      userAgent: this.runtime.request.headers.get("user-agent"),
      ip: this.runtime.request.headers.get("cf-connecting-ip"),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: timestamp + SESSION_TTL,
    };
    const authToken: AuthTokensInsert = {
      id: createId(),
      userId,
      kind: "verify",
      tokenHash: await sha256(rawVerifyToken),
      expiresAt: timestamp + DAY,
      usedAt: null,
      createdAt: timestamp,
    };

    await this.repository.createSignup({ user, org, session, authToken });
    this.mail.sendVerification({ name: user.name, email, token: rawVerifyToken });
    return { user: userDto(user), token: rawSessionToken, expiresAt: session.expiresAt, personalOrgId: orgId };
  }

  async signin(input: { email: string; password: string }) {
    const email = normalizeEmail(input.email);
    await Promise.all([
      this.rateLimit.check("auth", `signin-ip:${this.rateLimit.requestIp()}`),
      this.rateLimit.check("auth", `signin-email:${email}`),
    ]);
    const user = await this.repository.findUserByEmail(email);
    const valid = user?.passwordHash ? await this.passwordService.verify(input.password, user.passwordHash) : false;
    if (!user || !valid) throw new ApiError(401, "unauthenticated", "Invalid email or password");

    const timestamp = now();
    const token = createToken();
    const session = {
      id: createId(),
      userId: user.id,
      tokenHash: await sha256(token),
      userAgent: this.runtime.request.headers.get("user-agent"),
      ip: this.runtime.request.headers.get("cf-connecting-ip"),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: timestamp + SESSION_TTL,
    };
    await this.repository.createSession(session);
    return { user: userDto(user), token, expiresAt: session.expiresAt };
  }

  async authenticate(authorization: string | undefined): Promise<AuthActor | null> {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
    if (!match?.[1]) return null;
    const found = await this.repository.findActorByTokenHash(await sha256(match[1]));
    if (!found) return null;
    const timestamp = now();
    if (found.session.expiresAt <= timestamp) {
      this.runtime.executionCtx.waitUntil(this.repository.deleteSession(found.session.id));
      return null;
    }
    if (timestamp - found.session.lastSeenAt >= 3_600_000) {
      this.runtime.executionCtx.waitUntil(
        this.repository.touchSession(found.session.id, timestamp, timestamp + SESSION_TTL),
      );
    }
    return found;
  }

  async signout(actor: AuthActor): Promise<void> {
    await this.repository.deleteSession(actor.session.id);
  }

  async signoutAll(actor: AuthActor): Promise<void> {
    await this.repository.deleteOtherSessions(actor.user.id, actor.session.id);
  }

  async resendVerification(actor: AuthActor): Promise<void> {
    if (actor.user.emailVerifiedAt) return;
    await this.rateLimit.check("email", `verify:${actor.user.id}`);
    const token = createToken();
    const timestamp = now();
    await this.repository.createAuthToken({
      id: createId(), userId: actor.user.id, kind: "verify", tokenHash: await sha256(token),
      expiresAt: timestamp + DAY, usedAt: null, createdAt: timestamp,
    });
    this.mail.sendVerification({ name: actor.user.name, email: actor.user.email, token });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const found = await this.repository.findAuthToken(await sha256(rawToken), "verify");
    if (!found) throw new ApiError(410, "expired", "Verification link is invalid or expired");
    if (found.token.usedAt || found.token.expiresAt <= now()) throw new ApiError(410, "expired", "Verification link is invalid or expired");
    const firstVerification = !found.user.emailVerifiedAt;
    if (!(await this.repository.verifyEmail(found.user.id, found.token.id, now()))) {
      throw new ApiError(410, "expired", "Verification link is invalid or expired");
    }
    if (firstVerification) this.mail.sendWelcome({ email: found.user.email, name: found.user.name });
  }

  async requestReset(input: { email: string; turnstile: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    await this.turnstile.verify(input.turnstile, "reset_request");
    await this.rateLimit.check("email", `reset:${email}`);
    const user = await this.repository.findUserByEmail(email);
    if (!user?.passwordHash) return;
    const token = createToken();
    const timestamp = now();
    await this.repository.createAuthToken({
      id: createId(), userId: user.id, kind: "reset", tokenHash: await sha256(token),
      expiresAt: timestamp + 3_600_000, usedAt: null, createdAt: timestamp,
    });
    this.mail.sendReset({ email, token });
  }

  async resetPassword(rawToken: string, password: string): Promise<void> {
    const found = await this.repository.findAuthToken(await sha256(rawToken), "reset");
    if (!found || found.token.usedAt || found.token.expiresAt <= now()) {
      throw new ApiError(410, "expired", "Reset link is invalid or expired");
    }
    const timestamp = now();
    if (!(await this.repository.resetPassword(found.user.id, found.token.id, await this.passwordService.hash(password), timestamp))) {
      throw new ApiError(410, "expired", "Reset link is invalid or expired");
    }
    this.sendPasswordChanged(found.user.email, timestamp);
  }

  async me(actor: AuthActor) {
    const orgRows = await this.repository.listUserOrgs(actor.user.id);
    return {
      user: userDto(actor.user),
      orgs: orgRows.map(({ org, role }) => ({ ...org, role })),
      currentOrgId: orgRows[0]?.org.id ?? null,
    };
  }

  async updateMe(actor: AuthActor, patch: { name?: string; avatarUrl?: string | null }) {
    return userDto(await this.repository.updateProfile(actor.user.id, patch, now()));
  }

  async changePassword(actor: AuthActor, current: string, next: string): Promise<void> {
    if (!actor.user.passwordHash || !(await this.passwordService.verify(current, actor.user.passwordHash))) {
      throw unauthenticated();
    }
    const timestamp = now();
    await this.repository.changePassword(actor.user.id, actor.session.id, await this.passwordService.hash(next), timestamp);
    this.sendPasswordChanged(actor.user.email, timestamp);
  }

  private sendPasswordChanged(email: string, timestamp: number): void {
    const request = this.runtime.request;
    this.mail.sendPasswordChanged({
      email,
      date: new Date(timestamp).toUTCString(),
      browser: request.headers.get("user-agent") ?? "an unknown browser",
      city: typeof request.cf?.city === "string" ? request.cf.city : "an unknown location",
    });
  }
}
