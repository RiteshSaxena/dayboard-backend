import type { Hono } from "hono";
import type { ApiModule } from "../../core/di/module";
import type { ProviderRegistry } from "../../core/di/container";
import { DATABASE_SERVICE } from "../../core/di/tokens";
import type { AppBindings } from "../../core/http/app-bindings";
import { ACTIVITY_SERVICE } from "../activity/activity.tokens";
import { AUTHORIZATION_SERVICE } from "../authorization/authorization.tokens";
import { ORG_REPOSITORY } from "../org/org.tokens";
import { TaskController } from "./task.controller";
import { TaskRepository } from "./task.repository";
import { TaskService } from "./task.service";
import { TASK_REPOSITORY, TASK_SERVICE } from "./task.tokens";

export class TaskModule implements ApiModule {
  register(registry: ProviderRegistry): void {
    registry
      .register(TASK_REPOSITORY, (c) => new TaskRepository(c.resolve(DATABASE_SERVICE)))
      .register(TASK_SERVICE, (c) => new TaskService(
        c.resolve(TASK_REPOSITORY), c.resolve(AUTHORIZATION_SERVICE), c.resolve(ORG_REPOSITORY), c.resolve(ACTIVITY_SERVICE),
      ));
  }
  mount(app: Hono<AppBindings>): void {
    new TaskController().mount(app);
  }
}
