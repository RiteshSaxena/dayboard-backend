import { createToken } from "../../core/di/container";
import type { AuthorizationService } from "./authorization.service";

export const AUTHORIZATION_SERVICE = createToken<AuthorizationService>("AuthorizationService");
