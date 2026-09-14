import type { Hono } from "hono";
import type { ApiModule } from "../../core/di/module";
import type { ProviderRegistry } from "../../core/di/container";
import { DATABASE_SERVICE } from "../../core/di/tokens";
import type { AppBindings } from "../../core/http/app-bindings";
import { ACTIVITY_SERVICE } from "../activity/activity.tokens";
import { AUTHORIZATION_SERVICE } from "../authorization/authorization.tokens";
import { NoteController } from "./note.controller";
import { NoteRepository } from "./note.repository";
import { NoteService } from "./note.service";
import { NOTE_REPOSITORY, NOTE_SERVICE } from "./note.tokens";

export class NoteModule implements ApiModule {
  register(registry: ProviderRegistry): void {
    registry
      .register(NOTE_REPOSITORY, (c) => new NoteRepository(c.resolve(DATABASE_SERVICE)))
      .register(NOTE_SERVICE, (c) => new NoteService(c.resolve(NOTE_REPOSITORY), c.resolve(AUTHORIZATION_SERVICE), c.resolve(ACTIVITY_SERVICE)));
  }
  mount(app: Hono<AppBindings>): void {
    new NoteController().mount(app);
  }
}
