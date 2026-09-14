import { env, exports } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it } from 'vitest';
import { sha256 } from '../src/core/security/crypto';
import { PasswordService } from '../src/core/security/password';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';
import { RateLimitService } from '../src/modules/security/rate-limit.service';
import { TurnstileService } from '../src/modules/security/turnstile.service';

const TOKEN = 'dayboard-test-token-123456789012345';
const USER_ID = 'usr000000000000000000';
const ORG_ID = 'org000000000000000000';

class TestMailService extends MailService {
  override sendVerification(): void {}
}

class TestRateLimitService extends RateLimitService {
  override async check(): Promise<void> {}
}

class TestTurnstileService extends TurnstileService {
  override async verify(): Promise<void> {}
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`https://api.dayboard.space${path}`, init));
}

async function seedActor(): Promise<void> {
  const timestamp = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id,email,email_verified_at,name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).bind(USER_ID, 'test@dayboard.space', timestamp, 'Test User', 'unused', timestamp, timestamp),
    env.DB.prepare(
      'INSERT INTO orgs (id,name,slug,personal,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).bind(ORG_ID, 'Test Board', 'test-board', 1, USER_ID, timestamp, timestamp),
    env.DB.prepare('INSERT INTO memberships (org_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(
      ORG_ID,
      USER_ID,
      'owner',
      timestamp,
    ),
    env.DB.prepare(
      'INSERT INTO sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?)',
    ).bind(
      'ses000000000000000000',
      USER_ID,
      await sha256(TOKEN),
      timestamp,
      timestamp,
      timestamp + 86_400_000,
    ),
  ]);
}

describe('Dayboard Worker', () => {
  it('reports health', async ({ expect }) => {
    const response = await request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
  });

  it('requires a bearer token', async ({ expect }) => {
    const response = await request('/api/me');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Authentication is required' },
    });
  });

  it('hashes and verifies passwords', async ({ expect }) => {
    const passwords = new PasswordService();
    const encoded = await passwords.hash('correct horse battery staple');
    expect(encoded).not.toContain('correct horse battery staple');
    expect(await passwords.verify('correct horse battery staple', encoded)).toBe(true);
    expect(await passwords.verify('wrong password', encoded)).toBe(false);
  });

  it('signs up with a bearer session and personal organization', async ({ expect }) => {
    const ctx = createExecutionContext();
    const signupRequest = new Request('https://api.dayboard.space/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New User',
        email: 'new-user@dayboard.space',
        password: 'password123',
        turnstile: 'test-token',
      }),
    });
    const runtime = { env, executionCtx: ctx, request: signupRequest };
    const application = new AppModule(runtime, {
      mailService: new TestMailService(runtime),
      rateLimitService: new TestRateLimitService(runtime),
      turnstileService: new TestTurnstileService(runtime),
    });
    const signupResponse = await application.app.fetch(signupRequest, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(signupResponse.status).toBe(201);
    const signup = await signupResponse.json<{
      data: { token: string; personalOrgId: string };
    }>();
    expect(signup.data.token.length).toBeGreaterThan(30);
    expect(signup.data.personalOrgId).toHaveLength(21);

    const meResponse = await request('/api/me', {
      headers: { Authorization: `Bearer ${signup.data.token}` },
    });
    expect(meResponse.status).toBe(200);
    const me = await meResponse.json<{
      data: { user: { email: string }; orgs: unknown[] };
    }>();
    expect(me.data.user.email).toBe('new-user@dayboard.space');
    expect(me.data.orgs).toHaveLength(1);
  });

  it('creates and reads board data through the modular API', async ({ expect }) => {
    await seedActor();
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    };
    const projectResponse = await request(`/api/orgs/${ORG_ID}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Website', color: 'moss' }),
    });
    expect(projectResponse.status).toBe(201);
    const projectBody = await projectResponse.json<{ data: { id: string } }>();

    const taskResponse = await request(`/api/projects/${projectBody.data.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Ship API',
        description: 'Test it',
        status: 'doing',
      }),
    });
    expect(taskResponse.status).toBe(201);

    const noteResponse = await request(`/api/projects/${projectBody.data.id}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Architecture', body: 'Scoped DI' }),
    });
    expect(noteResponse.status).toBe(201);

    const boardResponse = await request(`/api/orgs/${ORG_ID}/board`, {
      headers,
    });
    expect(boardResponse.status).toBe(200);
    const board = await boardResponse.json<{
      data: { projects: unknown[]; tasks: unknown[]; notes: unknown[] };
    }>();
    expect(board.data.projects).toHaveLength(1);
    expect(board.data.tasks).toHaveLength(1);
    expect(board.data.notes).toHaveLength(1);
  });
});
