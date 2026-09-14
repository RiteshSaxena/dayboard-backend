import type { Hono } from "hono";
import type { ApiModule } from "../../core/di/module";
import type { ProviderRegistry } from "../../core/di/container";
import { DATABASE_SERVICE } from "../../core/di/tokens";
import type { AppBindings } from "../../core/http/app-bindings";
import { AUTHORIZATION_SERVICE } from "../authorization/authorization.tokens";
import { ActivityController } from "./activity.controller";
import { ActivityRepository } from "./activity.repository";
import { ActivityService } from "./activity.service";
import { ACTIVITY_REPOSITORY, ACTIVITY_SERVICE } from "./activity.tokens";

export class ActivityModule implements ApiModule {
  register(registry: ProviderRegistry): void {
    registry
      .register(ACTIVITY_REPOSITORY, (c) => new ActivityRepository(c.resolve(DATABASE_SERVICE)))
      .register(ACTIVITY_SERVICE, (c) => new ActivityService(c.resolve(ACTIVITY_REPOSITORY), c.resolve(AUTHORIZATION_SERVICE)));
  }
  mount(app: Hono<AppBindings>): void {
    new ActivityController().mount(app);
  }
}
