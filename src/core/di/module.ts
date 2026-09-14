import type { Hono } from "hono";
import type { AppBindings } from "../http/app-bindings";
import type { ProviderRegistry } from "./container";

export interface ApiModule {
  register(registry: ProviderRegistry): void;
  mount(app: Hono<AppBindings>): void;
}
