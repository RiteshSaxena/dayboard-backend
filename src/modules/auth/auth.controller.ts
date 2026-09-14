import type { Hono } from "hono";
import { parseJson, requireActor } from "../../core/http/request";
import type { AppBindings } from "../../core/http/app-bindings";
import { AUTH_SERVICE } from "./auth.tokens";
import {
  changePasswordSchema,
  resetRequestSchema,
  resetSchema,
  signinSchema,
  signupSchema,
  updateMeSchema,
  verifySchema,
} from "./auth.schemas";

export class AuthController {
  mount(app: Hono<AppBindings>): void {
    app.post("/api/auth/signup", async (c) => {
      const result = await c.get("container").resolve(AUTH_SERVICE).signup(await parseJson(c, signupSchema));
      return c.json({ data: result }, 201);
    });
    app.post("/api/auth/signin", async (c) => {
      const result = await c.get("container").resolve(AUTH_SERVICE).signin(await parseJson(c, signinSchema));
      return c.json({ data: result });
    });
    app.post("/api/auth/signout", async (c) => {
      await c.get("container").resolve(AUTH_SERVICE).signout(requireActor(c));
      return c.json({ data: { success: true } });
    });
    app.post("/api/auth/signout-all", async (c) => {
      await c.get("container").resolve(AUTH_SERVICE).signoutAll(requireActor(c));
      return c.json({ data: { success: true } });
    });
    app.post("/api/auth/verify/resend", async (c) => {
      await c.get("container").resolve(AUTH_SERVICE).resendVerification(requireActor(c));
      return c.json({ data: { success: true } });
    });
    app.post("/api/auth/verify", async (c) => {
      const input = await parseJson(c, verifySchema);
      await c.get("container").resolve(AUTH_SERVICE).verifyEmail(input.token);
      return c.json({ data: { success: true } });
    });
    app.post("/api/auth/reset/request", async (c) => {
      await c.get("container").resolve(AUTH_SERVICE).requestReset(await parseJson(c, resetRequestSchema));
      return c.json({ data: { success: true } });
    });
    app.post("/api/auth/reset", async (c) => {
      const input = await parseJson(c, resetSchema);
      await c.get("container").resolve(AUTH_SERVICE).resetPassword(input.token, input.password);
      return c.json({ data: { success: true } });
    });
    app.get("/api/me", async (c) => c.json({ data: await c.get("container").resolve(AUTH_SERVICE).me(requireActor(c)) }));
    app.patch("/api/me", async (c) => {
      const result = await c.get("container").resolve(AUTH_SERVICE).updateMe(requireActor(c), await parseJson(c, updateMeSchema));
      return c.json({ data: result });
    });
    app.patch("/api/me/password", async (c) => {
      const input = await parseJson(c, changePasswordSchema);
      await c.get("container").resolve(AUTH_SERVICE).changePassword(requireActor(c), input.current, input.next);
      return c.json({ data: { success: true } });
    });
  }
}
