import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { ProviderRegistry } from "./core/di/container";
import type { ApiModule } from "./core/di/module";
import { DATABASE_SERVICE, RUNTIME_CONTEXT } from "./core/di/tokens";
import { ApiError } from "./core/http/api-error";
import type { AppBindings } from "./core/http/app-bindings";
import { DatabaseService } from "./database/database.service";
import { ActivityModule } from "./modules/activity/activity.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AUTH_SERVICE } from "./modules/auth/auth.tokens";
import { AuthorizationService } from "./modules/authorization/authorization.service";
import { AUTHORIZATION_SERVICE } from "./modules/authorization/authorization.tokens";
import { MailService } from "./modules/mail/mail.service";
import { MAIL_SERVICE } from "./modules/mail/mail.tokens";
import { PurgeService } from "./modules/maintenance/purge.service";
import { PURGE_SERVICE } from "./modules/maintenance/maintenance.tokens";
import { NoteModule } from "./modules/note/note.module";
import { OrgModule } from "./modules/org/org.module";
import { ProjectModule } from "./modules/project/project.module";
import { RateLimitService } from "./modules/security/rate-limit.service";
import { RATE_LIMIT_SERVICE, TURNSTILE_SERVICE } from "./modules/security/security.tokens";
import { TurnstileService } from "./modules/security/turnstile.service";
import { TaskModule } from "./modules/task/task.module";

export class AppModule {
  readonly app = new Hono<AppBindings>();
  readonly providers = new ProviderRegistry();
  private readonly modules: ApiModule[] = [
    new AuthModule(),
    new OrgModule(),
    new ProjectModule(),
    new ActivityModule(),
    new TaskModule(),
    new NoteModule(),
  ];

  constructor() {
    this.registerProviders();
    this.configureMiddleware();
    for (const module of this.modules) module.mount(this.app);
    this.configureFallbacks();
  }

  createScope(env: Env, executionCtx: { waitUntil(promise: Promise<unknown>): void }, request: Request) {
    return this.providers.createScope().set(RUNTIME_CONTEXT, { env, executionCtx, request });
  }

  private registerProviders(): void {
    this.providers
      .register(DATABASE_SERVICE, (c) => new DatabaseService(c.resolve(RUNTIME_CONTEXT).env.DB))
      .register(AUTHORIZATION_SERVICE, (c) => new AuthorizationService(c.resolve(DATABASE_SERVICE)))
      .register(MAIL_SERVICE, (c) => new MailService(c.resolve(RUNTIME_CONTEXT)))
      .register(RATE_LIMIT_SERVICE, (c) => new RateLimitService(c.resolve(RUNTIME_CONTEXT)))
      .register(TURNSTILE_SERVICE, (c) => new TurnstileService(c.resolve(RUNTIME_CONTEXT)))
      .register(PURGE_SERVICE, (c) => new PurgeService(c.resolve(DATABASE_SERVICE)));
    for (const module of this.modules) module.register(this.providers);
  }

  private configureMiddleware(): void {
    this.app.use("*", async (c, next) => {
      const origin = c.req.header("origin");
      const allowed = c.env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
      return cors({
        origin: origin && allowed.includes(origin) ? origin : "",
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: 86400,
      })(c, next);
    });
    this.app.use("*", secureHeaders({ crossOriginResourcePolicy: "cross-origin" }));
    this.app.use("*", async (c, next) => {
      const container = this.createScope(c.env, c.executionCtx, c.req.raw);
      c.set("container", container);
      c.set("actor", await container.resolve(AUTH_SERVICE).authenticate(c.req.header("Authorization")));
      await next();
    });
    this.app.use("*", async (c, next) => {
      const startedAt = Date.now();
      await next();
      console.log(JSON.stringify({
        message: "request", method: c.req.method, path: c.req.path, status: c.res.status,
        durationMs: Date.now() - startedAt,
      }));
    });
  }

  private configureFallbacks(): void {
    this.app.get("/health", (c) => c.json({ data: { status: "ok" } }));
    this.app.notFound((c) => c.json({ error: { code: "not_found", message: "Route was not found" } }, 404));
    this.app.onError((error, c) => {
      if (error instanceof ApiError) {
        return c.json({ error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) } }, error.status);
      }
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        return c.json({ error: { code: "validation", message: issue?.message ?? "Invalid request", ...(issue?.path.length ? { field: issue.path.join(".") } : {}) } }, 422);
      }
      console.error(JSON.stringify({ message: "unhandled error", path: c.req.path, error: error instanceof Error ? error.message : String(error) }));
      return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
    });
  }
}
