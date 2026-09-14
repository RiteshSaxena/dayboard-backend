# Dayboard API

Cloudflare Workers backend for Dayboard. The API is designed for `api.dayboard.space` and uses Hono, D1, Drizzle ORM, bearer-token sessions, Turnstile, and SMTP through [`worker-mailer`](https://github.com/zou-yu/worker-mailer).

## Architecture

The code follows a NestJS-style module boundary while staying native to the Workers runtime:

```text
src/
├── app.module.ts                 application composition and middleware
├── index.ts                      fetch and scheduled entrypoints
├── core/                         DI, HTTP errors, security, runtime context
├── database/                     Drizzle connection and schema
└── modules/
    ├── auth/                     bearer sessions and account flows
    ├── authorization/            role and resource guards
    ├── org/                      organizations, members, invitations
    ├── project/                  projects and board aggregation
    ├── task/                     tasks, movement, archive, assignment
    ├── note/                     notes and pinning
    ├── activity/                 project activity
    ├── mail/                     templates and worker-mailer SMTP transport
    ├── maintenance/              scheduled tombstone purge
    └── security/                 Turnstile and rate limiting
```

Controllers only translate HTTP input and output. Services hold business rules. Repositories own Drizzle queries. A fresh dependency container is created for every request so bindings and request state do not cross Worker requests.

## Local setup

Install packages and generate the Worker binding types:

```sh
npm install
npm run cf-typegen
```

Create `.dev.vars` from `.dev.vars.example` and provide an SMTP account. Port 587 with STARTTLS is the default. Port 465 can be used by setting `SMTP_PORT=465` and changing `SMTP_SECURITY` to `tls` in the Wrangler environment configuration.

Apply the generated Drizzle migration and start the Worker:

```sh
npm run db:migrate:local
npm run dev
```

The local API listens at `http://localhost:8787`. `GET /health` does not require authentication.

## Production configuration

Before deployment:

1. Create a D1 database named `dayboard` and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
2. Confirm the custom domain `api.dayboard.space` exists in the Cloudflare account.
3. Create Turnstile widgets for the `signup` and `reset_request` actions. Set `TURNSTILE_HOSTNAMES` to the exact frontend hostnames.
4. Store `TURNSTILE_SECRET`, `SMTP_HOST`, `SMTP_USERNAME`, and `SMTP_PASSWORD` as Worker secrets.
5. Review the three rate-limit namespace IDs so they are unique within the Cloudflare account.
6. Apply migrations remotely with `npm run db:migrate:remote`, then deploy with `npm run deploy`.

The frontend stores the raw session token in local storage and sends it on every authenticated request:

```http
Authorization: Bearer <token>
```

Only a SHA-256 hash of the session token is stored in D1. The API permits browser requests from the origins listed in `ALLOWED_ORIGINS`.

## API surface

Authentication:

```text
POST  /api/auth/signup
POST  /api/auth/signin
POST  /api/auth/signout
POST  /api/auth/signout-all
POST  /api/auth/verify/resend
POST  /api/auth/verify
POST  /api/auth/reset/request
POST  /api/auth/reset
GET   /api/me
PATCH /api/me
PATCH /api/me/password
```

Organizations and invitations:

```text
POST   /api/orgs
PATCH  /api/orgs/:orgId
DELETE /api/orgs/:orgId
GET    /api/orgs/:orgId/members
PATCH  /api/orgs/:orgId/members/:userId
DELETE /api/orgs/:orgId/members/:userId
POST   /api/orgs/:orgId/transfer
GET    /api/orgs/:orgId/invites
POST   /api/orgs/:orgId/invites
POST   /api/orgs/:orgId/invites/:inviteId/resend
DELETE /api/orgs/:orgId/invites/:inviteId
GET    /api/invites/:token
POST   /api/invites/:token/accept
```

Projects, tasks, notes, and activity:

```text
GET    /api/orgs/:orgId/board
GET    /api/orgs/:orgId/projects
POST   /api/orgs/:orgId/projects
PATCH  /api/projects/:id
DELETE /api/projects/:id
POST   /api/projects/:id/restore

GET    /api/projects/:id/tasks
POST   /api/projects/:id/tasks
PATCH  /api/tasks/:id
POST   /api/tasks/:id/move
POST   /api/tasks/:id/archive
POST   /api/tasks/:id/unarchive
DELETE /api/tasks/:id
POST   /api/tasks/:id/restore
POST   /api/projects/:id/tasks/archive-done
GET    /api/orgs/:orgId/tasks/mine

GET    /api/projects/:id/notes
POST   /api/projects/:id/notes
PATCH  /api/notes/:id
DELETE /api/notes/:id
POST   /api/notes/:id/restore
GET    /api/projects/:id/activity
```

Google login, realtime connections, import/export, and email queues are intentionally outside the current implementation.

## Verification

```sh
npm run typecheck
npm test
npm run deploy:dry
```

Tests run in the Cloudflare Workers runtime with an isolated D1 database and apply the real Drizzle migrations before exercising API routes.
