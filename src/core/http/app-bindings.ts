import type { Container } from "../di/container";
import type { AuthActor } from "../../modules/auth/auth.types";

export interface AppBindings {
  Bindings: Env;
  Variables: {
    container: Container;
    actor: AuthActor | null;
  };
}
