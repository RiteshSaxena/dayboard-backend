import type { Hono } from "hono";
import type { ApiModule } from "../../core/di/module";
import type { ProviderRegistry } from "../../core/di/container";
import { DATABASE_SERVICE, RUNTIME_CONTEXT } from "../../core/di/tokens";
import type { AppBindings } from "../../core/http/app-bindings";
import { PasswordService } from "../../core/security/password";
import { MAIL_SERVICE } from "../mail/mail.tokens";
import { RATE_LIMIT_SERVICE, TURNSTILE_SERVICE } from "../security/security.tokens";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { AUTH_REPOSITORY, AUTH_SERVICE, PASSWORD_SERVICE } from "./auth.tokens";

export class AuthModule implements ApiModule {
  register(registry: ProviderRegistry): void {
    registry
      .register(PASSWORD_SERVICE, () => new PasswordService())
      .register(AUTH_REPOSITORY, (c) => new AuthRepository(c.resolve(DATABASE_SERVICE)))
      .register(AUTH_SERVICE, (c) => new AuthService(
        c.resolve(AUTH_REPOSITORY),
        c.resolve(PASSWORD_SERVICE),
        c.resolve(TURNSTILE_SERVICE),
        c.resolve(RATE_LIMIT_SERVICE),
        c.resolve(MAIL_SERVICE),
        c.resolve(RUNTIME_CONTEXT),
      ));
  }

  mount(app: Hono<AppBindings>): void {
    new AuthController().mount(app);
  }
}
