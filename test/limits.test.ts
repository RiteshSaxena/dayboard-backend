import { env } from 'cloudflare:workers';
import { describe, it } from 'vitest';
import { createId } from '../src/core/security/crypto';
import { createDatabase } from '../src/database/database';
import { PurgeService } from '../src/modules/maintenance/purge.service';
import { seedOrg } from './helpers';

describe('large orgs', () => {
  it('loads the board with more than 100 projects', async ({ expect }) => {
    const org = await seedOrg();
    const timestamp = Date.now();
    const projectIds = Array.from({ length: 130 }, () => createId());
    await env.DB.batch(
      projectIds.map((id, index) =>
        env.DB.prepare(
          'INSERT INTO projects (id,org_id,name,color,position,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        ).bind(
          id,
          org.orgId,
          `P${index}`,
          '#617a59',
          index,
          org.users.owner.id,
          timestamp,
          timestamp,
        ),
      ),
    );
    const board = await org.users.guest.api('GET', `/api/orgs/${org.orgId}/board`);
    expect(board.status).toBe(200);
    expect(board.body.data.projects).toHaveLength(130);
  });

  it('purges more rows than fit in one bound-parameter list', async ({ expect }) => {
    const org = await seedOrg();
    const expired = Date.now() - 1000;
    await env.DB.batch(
      Array.from({ length: 650 }, () =>
        env.DB.prepare(
          'INSERT INTO sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?)',
        ).bind(createId(), org.users.guest.id, createId(), expired, expired, expired),
      ),
    );
    const result = await new PurgeService(createDatabase(env.DB)).run();
    expect(result.sessions).toBeGreaterThanOrEqual(650);
    const remaining = await env.DB.prepare(
      'SELECT count(*) AS value FROM sessions WHERE expires_at < ?',
    )
      .bind(Date.now())
      .first<{ value: number }>();
    expect(remaining?.value).toBe(0);
  });
});
