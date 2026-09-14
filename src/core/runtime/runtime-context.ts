export interface RuntimeContext {
  readonly env: Env;
  readonly executionCtx: { waitUntil(promise: Promise<unknown>): void };
  readonly request: Request;
}
