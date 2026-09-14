import { createToken } from "../../core/di/container";
import type { RateLimitService } from "./rate-limit.service";
import type { TurnstileService } from "./turnstile.service";

export const RATE_LIMIT_SERVICE = createToken<RateLimitService>("RateLimitService");
export const TURNSTILE_SERVICE = createToken<TurnstileService>("TurnstileService");
