import type { Hono } from 'hono';
import type { AppBindings } from '../../core/http/app-bindings';
import { parseJson, requireActor } from '../../core/http/request';
import {
  changePasswordSchema,
  resetRequestSchema,
  resetSchema,
  signinSchema,
  signupSchema,
  updateMeSchema,
  verifySchema,
} from './auth.schemas';
import type { AuthService } from './auth.service';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  mount(app: Hono<AppBindings>): void {
    app.post('/api/auth/signup', async (c) => {
      const input = await parseJson(c, signupSchema);
      const data = await this.authService.signup(input);

      return c.json({ data }, 201);
    });

    app.post('/api/auth/signin', async (c) => {
      const input = await parseJson(c, signinSchema);
      const data = await this.authService.signin(input);

      return c.json({ data });
    });

    app.post('/api/auth/signout', async (c) => {
      const actor = requireActor(c);
      await this.authService.signout(actor);

      return c.json({ data: { success: true } });
    });

    app.post('/api/auth/signout-all', async (c) => {
      const actor = requireActor(c);
      await this.authService.signoutAll(actor);

      return c.json({ data: { success: true } });
    });

    app.post('/api/auth/verify/resend', async (c) => {
      const actor = requireActor(c);
      await this.authService.resendVerification(actor);

      return c.json({ data: { success: true } });
    });

    app.post('/api/auth/verify', async (c) => {
      const input = await parseJson(c, verifySchema);
      await this.authService.verifyEmail(input.token);

      return c.json({ data: { success: true } });
    });

    app.post('/api/auth/reset/request', async (c) => {
      const input = await parseJson(c, resetRequestSchema);
      await this.authService.requestReset(input);

      return c.json({ data: { success: true } });
    });

    app.post('/api/auth/reset', async (c) => {
      const input = await parseJson(c, resetSchema);
      await this.authService.resetPassword(input.token, input.password);

      return c.json({ data: { success: true } });
    });

    app.get('/api/me', async (c) => {
      const actor = requireActor(c);
      const data = await this.authService.me(actor);

      return c.json({ data });
    });

    app.patch('/api/me', async (c) => {
      const actor = requireActor(c);
      const input = await parseJson(c, updateMeSchema);
      const data = await this.authService.updateMe(actor, input);

      return c.json({ data });
    });

    app.patch('/api/me/password', async (c) => {
      const actor = requireActor(c);
      const input = await parseJson(c, changePasswordSchema);
      await this.authService.changePassword(actor, input.current, input.next);

      return c.json({ data: { success: true } });
    });
  }
}
