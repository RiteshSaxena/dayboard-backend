# Dayboard API

Cloudflare Workers API for Dayboard, built with Hono, D1, Drizzle, bearer tokens, Turnstile, R2 for attachments, and SMTP email through `worker-mailer`.

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
2. Set `TURNSTILE_SECRET` and `FILE_URL_SECRET` as Worker secrets, plus `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for attachment uploads, and `SMTP_USERNAME` and `SMTP_PASSWORD` when sending over SMTP.
3. Configure `TURNSTILE_HOSTNAMES`, `ALLOWED_ORIGINS`, and the email settings in `wrangler.jsonc`.
4. Apply migrations with `npm run db:migrate:remote`.
5. Deploy with `npm run deploy`.

## Email

Mail goes out over SMTP through `worker-mailer`, configured with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, and `SMTP_PASSWORD`.

Cloudflare's own relay (`smtp.mx.cloudflare.net`) cannot be used from a Worker: outbound TCP sockets to Cloudflare addresses are blocked. Any other SMTP host works.

Sending happens during `ctx.waitUntil()`, so a slow mail server never delays a request, and no Queue resources are required.

## License

Licensed under the [Apache License 2.0](LICENSE).
