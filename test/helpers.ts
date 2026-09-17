import { env, exports } from 'cloudflare:workers';
import { createId, createToken, sha256 } from '../src/core/security/crypto';

export type Role = 'owner' | 'admin' | 'member' | 'guest';

export interface ApiResponse {
  status: number;
  // Tests assert on shapes directly, so the body is intentionally loosely typed.
  body: any;
}

export type Api = (method: string, path: string, body?: unknown) => Promise<ApiResponse>;

export interface SeededOrg {
  orgId: string;
  users: Record<Role, { id: string; api: Api }>;
}

export function apiAs(token: string): Api {
  return async (method, path, body) => {
    const response = await exports.default.fetch(
      new Request(`https://api.dayboard.space${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
}

/** Seeds a verified user for every role in a fresh org, each with its own session. */
export async function seedOrg(): Promise<SeededOrg> {
  const timestamp = Date.now();
  const orgId = createId();
  const roles: Role[] = ['owner', 'admin', 'member', 'guest'];
  const seeded = await Promise.all(
    roles.map(async (role) => {
      const token = createToken();
      return { role, id: createId(), token, tokenHash: await sha256(token) };
    }),
  );
  const [owner] = seeded;
  if (!owner) throw new Error('No owner seeded');

  await env.DB.batch([
    ...seeded.map((user) =>
      env.DB.prepare(
        'INSERT INTO users (id,email,email_verified_at,name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      ).bind(
        user.id,
        `${user.id.toLowerCase()}@dayboard.test`,
        timestamp,
        `${user.role} user`,
        'unused',
        timestamp,
        timestamp,
      ),
    ),
    env.DB.prepare(
      'INSERT INTO orgs (id,name,slug,personal,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).bind(orgId, 'Test Org', `test-${orgId.toLowerCase()}`, 0, owner.id, timestamp, timestamp),
    ...seeded.flatMap((user) => [
      env.DB.prepare(
        'INSERT INTO memberships (org_id,user_id,role,joined_at) VALUES (?,?,?,?)',
      ).bind(orgId, user.id, user.role, timestamp),
      env.DB.prepare(
        'INSERT INTO sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?)',
      ).bind(createId(), user.id, user.tokenHash, timestamp, timestamp, timestamp + 86_400_000),
    ]),
  ]);

  const users = Object.fromEntries(
    seeded.map((user) => [user.role, { id: user.id, api: apiAs(user.token) }]),
  ) as SeededOrg['users'];
  return { orgId, users };
}
