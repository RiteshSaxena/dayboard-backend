import type { AuthActor } from '../../modules/auth/auth.types';

export interface AppBindings {
  Bindings: Env;
  Variables: {
    actor: AuthActor | null;
  };
}
