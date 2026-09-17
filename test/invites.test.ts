import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { createId, createToken, sha256 } from '../src/core/security/crypto';
import { createDatabase } from '../src/database/database';
import { invites } from '../src/database/schema';
import { MailService } from '../src/modules/mail/mail.service';
import { RateLimitService } from '../src/modules/security/rate-limit.service';
import { TurnstileService } from '../src/modules/security/turnstile.service';
import { apiAs, seedOrg } from './helpers';

const DAY = 86_400_000;

class RecordingMailService extends MailService {
  constructor(
    runtime: ConstructorParameters<typeof MailService>[0],
    private readonly sent: string[],
  ) {
    super(runtime);
  }
  override sendVerification(input: { email: string }): void {
    this.sent.push(`verify:${input.email}`);
  }
  override sendWelcome(input: { email: string }): void {
    this.sent.push(`welcome:${input.email}`);
  }
}
class NoRateLimit extends RateLimitService {
  override async check(): Promise<void> {}
}
class PassingTurnstile extends TurnstileService {
  override async verify(): Promise<void> {}
}

async function signup(body: Record<string, unknown>, sent: string[]) {
  const request = new Request('https://api.dayboard.space/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Grace Hopper',
      password: 'password123',
      turnstile: 'test',
      ...body,
    }),
  });
  const ctx = createExecutionContext();
  const runtime = { env, executionCtx: ctx, request };
  const app = new AppModule(runtime, {
    mailService: new RecordingMailService(runtime, sent),
    rateLimitService: new NoRateLimit(runtime),
    turnstileService: new PassingTurnstile(runtime),
  });
  const response = await app.app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, body: (await response.json()) as any };
}

async function seedInvite(
  orgId: string,
  invitedBy: string,
  email: string,
  extra: Partial<typeof invites.$inferInsert> = {},
) {
  const token = createToken();
  const timestamp = Date.now();
  await createDatabase(env.DB)
    .insert(invites)
    .values({
      id: createId(),
      orgId,
      email,
      role: 'member',
      tokenHash: await sha256(token),
      invitedBy,
      expiresAt: timestamp + 7 * DAY,
      createdAt: timestamp,
      ...extra,
    });
  return token;
}

describe('signing up from an invitation', () => {
  it('verifies the invited address, so the invitation can be accepted straight away', async ({
    expect,
  }) => {
    const org = await seedOrg();
    const email = `invited-${createId().toLowerCase()}@example.com`;
    const token = await seedInvite(org.orgId, org.users.owner.id, email);

    const preview = await apiAs('unused-token-00000000000')('GET', `/api/invites/${token}`);
    expect(preview.body.data).toMatchObject({
      email,
      accountExists: false,
      org: { id: org.orgId },
      role: 'member',
    });

    const sent: string[] = [];
    const created = await signup({ email: email.toUpperCase(), inviteToken: token }, sent);
    expect(created.status).toBe(201);
    expect(created.body.data.user.emailVerifiedAt).toEqual(expect.any(Number));
    expect(sent).toEqual([`welcome:${email}`]);

    const api = apiAs(created.body.data.token);
    expect((await api('POST', `/api/invites/${token}/accept`)).status).toBe(200);
    const me = await api('GET', '/api/me');
    expect(me.body.data.orgs.map((item: { id: string }) => item.id)).toContain(org.orgId);
  });

  it('only the invited address can accept the invitation', async ({ expect }) => {
    const org = await seedOrg();
    const token = await seedInvite(
      org.orgId,
      org.users.owner.id,
      `someone-${createId().toLowerCase()}@example.com`,
    );
    const outsider = await seedOrg();
    const response = await outsider.users.owner.api('POST', `/api/invites/${token}/accept`);
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe(
      'This invitation was sent to a different email address',
    );
  });

  it('tells the invite page when the invited address already has an account', async ({
    expect,
  }) => {
    const org = await seedOrg();
    const token = await seedInvite(
      org.orgId,
      org.users.owner.id,
      org.users.member.email.toUpperCase(),
    );
    const preview = await apiAs('unused-token-00000000000')('GET', `/api/invites/${token}`);
    expect(preview.body.data.accountExists).toBe(true);
  });

  it('is an ordinary unverified signup for another address or a stale invitation', async ({
    expect,
  }) => {
    const org = await seedOrg();
    const invited = `invited-${createId().toLowerCase()}@example.com`;
    const token = await seedInvite(org.orgId, org.users.owner.id, invited);
    const expired = `expired-${createId().toLowerCase()}@example.com`;
    const expiredToken = await seedInvite(org.orgId, org.users.owner.id, expired, {
      expiresAt: Date.now() - 1,
    });

    const sent: string[] = [];
    const other = `other-${createId().toLowerCase()}@example.com`;
    const wrongAddress = await signup({ email: other, inviteToken: token }, sent);
    expect(wrongAddress.status).toBe(201);
    expect(wrongAddress.body.data.user.emailVerifiedAt).toBeNull();

    const stale = await signup({ email: expired, inviteToken: expiredToken }, sent);
    expect(stale.body.data.user.emailVerifiedAt).toBeNull();

    const bogus = await signup(
      { email: `bogus-${createId().toLowerCase()}@example.com`, inviteToken: createToken() },
      sent,
    );
    expect(bogus.body.data.user.emailVerifiedAt).toBeNull();
    expect(sent.every((entry) => entry.startsWith('verify:'))).toBe(true);
    expect(sent).toHaveLength(3);
  });
});
