import { createToken } from "../../core/di/container";
import type { PasswordService } from "../../core/security/password";
import { authTokens } from "../../database/schema";
import type { AuthRepository } from "./auth.repository";
import type { AuthService } from "./auth.service";

export type AuthTokensInsert = typeof authTokens.$inferInsert;

export const AUTH_REPOSITORY = createToken<AuthRepository>("AuthRepository");
export const AUTH_SERVICE = createToken<AuthService>("AuthService");
export const PASSWORD_SERVICE = createToken<PasswordService>("PasswordService");
