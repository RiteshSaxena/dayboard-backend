import type { RuntimeContext } from '../../core/runtime/runtime-context';
import { ApiError, forbidden } from '../../core/http/api-error';

interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
}

export class TurnstileService {
  constructor(private readonly runtime: RuntimeContext) {}

  async verify(token: string, expectedAction: string): Promise<void> {
    const configuredHostnames = this.runtime.env.TURNSTILE_HOSTNAMES.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const hostnames = new Set(configuredHostnames);
    if (!token || token.length > 2048 || hostnames.size === 0)
      throw forbidden('Bot verification failed');

    const body = new URLSearchParams({
      secret: this.runtime.env.TURNSTILE_SECRET,
      response: token,
    });
    const ip = this.runtime.request.headers.get('cf-connecting-ip');
    if (ip) body.set('remoteip', ip);

    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Siteverify returned ${response.status}`);
      const result = await response.json<TurnstileResponse>();
      if (
        !result.success ||
        result.action !== expectedAction ||
        !result.hostname ||
        !hostnames.has(result.hostname)
      ) {
        throw forbidden('Bot verification failed');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw forbidden('Bot verification failed');
    }
  }
}
