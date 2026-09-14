import type { Hono } from "hono";
import type { ApiModule } from "../../core/di/module";
import type { ProviderRegistry } from "../../core/di/container";
import { DATABASE_SERVICE } from "../../core/di/tokens";
import type { AppBindings } from "../../core/http/app-bindings";
import { AUTHORIZATION_SERVICE } from "../authorization/authorization.tokens";
import { ACTIVITY_SERVICE } from "../activity/activity.tokens";
import { ProjectController } from "./project.controller";
import { ProjectRepository } from "./project.repository";
import { ProjectService } from "./project.service";
import { PROJECT_REPOSITORY, PROJECT_SERVICE } from "./project.tokens";

export class ProjectModule implements ApiModule {
  register(registry: ProviderRegistry): void {
    registry
      .register(PROJECT_REPOSITORY, (c) => new ProjectRepository(c.resolve(DATABASE_SERVICE)))
      .register(PROJECT_SERVICE, (c) => new ProjectService(
        c.resolve(PROJECT_REPOSITORY), c.resolve(AUTHORIZATION_SERVICE), c.resolve(ACTIVITY_SERVICE),
      ));
  }
  mount(app: Hono<AppBindings>): void {
    new ProjectController().mount(app);
  }
}
