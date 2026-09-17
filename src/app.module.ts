import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { ApiError } from './core/http/api-error';
import type { AppBindings } from './core/http/app-bindings';
import type { RuntimeContext } from './core/runtime/runtime-context';
import { PasswordService } from './core/security/password';
import { createDatabase } from './database/database';
import { ActivityController } from './modules/activity/activity.controller';
import { ActivityService } from './modules/activity/activity.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { AuthorizationService } from './modules/authorization/authorization.service';
import { CommentController } from './modules/comment/comment.controller';
import { CommentService } from './modules/comment/comment.service';
import { MailService } from './modules/mail/mail.service';
import { NoteController } from './modules/note/note.controller';
import { NoteService } from './modules/note/note.service';
import { OrgController } from './modules/org/org.controller';
import { OrgService } from './modules/org/org.service';
import { ProjectController } from './modules/project/project.controller';
import { ProjectService } from './modules/project/project.service';
import { RateLimitService } from './modules/security/rate-limit.service';
import { TurnstileService } from './modules/security/turnstile.service';
import { StageController } from './modules/stage/stage.controller';
import { StageService } from './modules/stage/stage.service';
import { TaskTypeController } from './modules/task-type/task-type.controller';
import { TaskTypeService } from './modules/task-type/task-type.service';
import { TaskController } from './modules/task/task.controller';
import { TaskService } from './modules/task/task.service';

export interface AppOverrides {
  mailService?: MailService;
  rateLimitService?: RateLimitService;
  turnstileService?: TurnstileService;
}

export class AppModule {
  readonly app = new Hono<AppBindings>();

  constructor(runtime: RuntimeContext, overrides: AppOverrides = {}) {
    const db = createDatabase(runtime.env.DB);
    const authorizationService = new AuthorizationService(db);
    const activityService = new ActivityService(db, authorizationService);
    const mailService = overrides.mailService ?? new MailService(runtime);
    const rateLimitService = overrides.rateLimitService ?? new RateLimitService(runtime);
    const turnstileService = overrides.turnstileService ?? new TurnstileService(runtime);
    const authService = new AuthService(
      db,
      new PasswordService(),
      turnstileService,
      rateLimitService,
      mailService,
      runtime,
    );
    const orgService = new OrgService(
      db,
      authorizationService,
      rateLimitService,
      mailService,
      activityService,
    );
    const stageService = new StageService(db, authorizationService, activityService);
    const taskTypeService = new TaskTypeService(db, authorizationService, activityService);
    const projectService = new ProjectService(
      db,
      authorizationService,
      activityService,
      taskTypeService,
    );
    const taskService = new TaskService(
      db,
      authorizationService,
      activityService,
      stageService,
      taskTypeService,
    );
    const noteService = new NoteService(db, authorizationService, activityService);
    const commentService = new CommentService(db, authorizationService, activityService);

    this.configureMiddleware(authService);
    new AuthController(authService).mount(this.app);
    new OrgController(orgService).mount(this.app);
    new ProjectController(projectService).mount(this.app);
    new StageController(stageService).mount(this.app);
    new TaskTypeController(taskTypeService).mount(this.app);
    new TaskController(taskService).mount(this.app);
    new CommentController(commentService).mount(this.app);
    new NoteController(noteService).mount(this.app);
    new ActivityController(activityService).mount(this.app);
    this.configureFallbacks();
  }

  private configureMiddleware(authService: AuthService): void {
    this.app.use('*', async (c, next) => {
      const origin = c.req.header('origin');
      const allowed = c.env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
      return cors({
        origin: origin && allowed.includes(origin) ? origin : '',
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: 86400,
      })(c, next);
    });
    this.app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }));
    this.app.use('*', async (c, next) => {
      c.set('actor', await authService.authenticate(c.req.header('Authorization')));
      await next();
    });
    this.app.use('*', async (c, next) => {
      const startedAt = Date.now();
      await next();
      console.log(
        JSON.stringify({
          message: 'request',
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Date.now() - startedAt,
        }),
      );
    });
  }

  private configureFallbacks(): void {
    this.app.get('/health', (c) => c.json({ data: { status: 'ok' } }));
    this.app.notFound((c) =>
      c.json({ error: { code: 'not_found', message: 'Route was not found' } }, 404),
    );
    this.app.onError((error, c) => {
      if (error instanceof ApiError) {
        return c.json(
          {
            error: {
              code: error.code,
              message: error.message,
              ...(error.field ? { field: error.field } : {}),
            },
          },
          error.status,
        );
      }
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        return c.json(
          {
            error: {
              code: 'validation',
              message: issue?.message ?? 'Invalid request',
              ...(issue?.path.length ? { field: issue.path.join('.') } : {}),
            },
          },
          422,
        );
      }
      console.error(
        JSON.stringify({
          message: 'unhandled error',
          path: c.req.path,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json({ error: { code: 'internal', message: 'Internal server error' } }, 500);
    });
  }
}
