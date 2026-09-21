# Dayboard API

Cloudflare Workers API for Dayboard, built with Hono, D1, Drizzle, bearer tokens, Turnstile, and direct SMTP through `worker-mailer`.

## Structure

```text
src/
├── app.module.ts       # creates and connects services and controllers
├── index.ts            # Worker fetch and scheduled entrypoints
├── core/               # shared HTTP, security, and runtime helpers
├── database/           # Drizzle connection and schema
└── modules/
    ├── auth/
    ├── authorization/
    ├── org/
    ├── project/
    ├── task/
    ├── note/
    ├── activity/
    ├── mail/
    ├── maintenance/
    └── security/
```

Dependencies use plain constructor injection. `AppModule` is the composition root:

```ts
const projectService = new ProjectService(db, authorizationService, activityService);

new ProjectController(projectService).mount(app);
```

Controllers define HTTP routes and call their injected service directly. Services contain business rules and Drizzle queries. There are no injection tokens, containers, decorators, or repositories.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

The local API is available at `http://localhost:8787`. Check it with `GET /health`.

Useful checks:

```sh
npm run typecheck
npm test
npm run format:check
npm run deploy:dry
```

## Authentication

The frontend stores the raw session token in local storage and sends it with each authenticated request:

```http
Authorization: Bearer <token>
```

Only the SHA-256 token hash is stored in D1.

## Deployment

Before deployment:

1. Create the `dayboard` D1 database and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
2. Set `TURNSTILE_SECRET`, `SMTP_HOST`, `SMTP_USERNAME`, and `SMTP_PASSWORD` as Worker secrets.
3. Configure `TURNSTILE_HOSTNAMES`, `ALLOWED_ORIGINS`, and the SMTP settings in `wrangler.jsonc`.
4. Apply migrations with `npm run db:migrate:remote`.
5. Deploy with `npm run deploy`.

SMTP sends directly during `ctx.waitUntil()` using `worker-mailer`. No Queue resources are required.

Google login, realtime updates, and import/export are outside the current scope.

## License

Licensed under the [Apache License 2.0](LICENSE).
