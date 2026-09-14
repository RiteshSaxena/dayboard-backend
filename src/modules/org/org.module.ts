import type { Hono } from "hono";
import type { ApiModule } from "../../core/di/module";
import type { ProviderRegistry } from "../../core/di/container";
import { DATABASE_SERVICE } from "../../core/di/tokens";
import type { AppBindings } from "../../core/http/app-bindings";
import { AUTHORIZATION_SERVICE } from "../authorization/authorization.tokens";
import { ACTIVITY_SERVICE } from "../activity/activity.tokens";
import { MAIL_SERVICE } from "../mail/mail.tokens";
import { RATE_LIMIT_SERVICE } from "../security/security.tokens";
import { OrgController } from "./org.controller";
import { OrgRepository } from "./org.repository";
import { OrgService } from "./org.service";
import { ORG_REPOSITORY, ORG_SERVICE } from "./org.tokens";

export class OrgModule implements ApiModule {
  register(registry: ProviderRegistry): void {
    registry
      .register(ORG_REPOSITORY, (c) => new OrgRepository(c.resolve(DATABASE_SERVICE)))
      .register(ORG_SERVICE, (c) => new OrgService(
        c.resolve(ORG_REPOSITORY), c.resolve(AUTHORIZATION_SERVICE), c.resolve(RATE_LIMIT_SERVICE), c.resolve(MAIL_SERVICE), c.resolve(ACTIVITY_SERVICE),
      ));
  }
  mount(app: Hono<AppBindings>): void {
    new OrgController().mount(app);
  }
}
