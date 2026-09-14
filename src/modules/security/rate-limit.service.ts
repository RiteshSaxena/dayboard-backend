import type { RuntimeContext } from "../../core/runtime/runtime-context";
import { ApiError } from "../../core/http/api-error";

type Limiter = "auth" | "email" | "invite";

export class RateLimitService {
  constructor(private readonly runtime: RuntimeContext) {}

  async check(limiter: Limiter, key: string): Promise<void> {
    const binding = limiter === "auth"
      ? this.runtime.env.AUTH_RATE_LIMITER
      : limiter === "email"
        ? this.runtime.env.EMAIL_RATE_LIMITER
        : this.runtime.env.INVITE_RATE_LIMITER;
    const result = await binding.limit({ key: `${limiter}:${key}` });
    if (!result.success) {
      throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
    }
  }

  requestIp(): string {
    return this.runtime.request.headers.get("cf-connecting-ip") ?? "unknown";
  }
}
