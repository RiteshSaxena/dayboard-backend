import type { Context } from "hono";
import { z, type ZodType } from "zod";
import type { AppBindings } from "./app-bindings";
import { ApiError, badRequest, unauthenticated } from "./api-error";

export async function parseJson<T>(c: Context<AppBindings>, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue?.message ?? "Invalid request", issue?.path.join(".") || undefined);
  }
  return result.data;
}

export function requireActor(c: Context<AppBindings>) {
  const actor = c.get("actor");
  if (!actor) throw unauthenticated();
  return actor;
}

export const idParamSchema = z.string().length(21);

export function parseCursor(value: string | undefined): { position: number; id: string } | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(atob(value)) as unknown;
    const result = z.object({ position: z.number().int(), id: idParamSchema }).safeParse(decoded);
    if (!result.success) throw new Error();
    return result.data;
  } catch {
    throw new ApiError(422, "validation", "Invalid cursor", "cursor");
  }
}

export function makeCursor(row: { position: number; id: string } | undefined): string | null {
  return row ? btoa(JSON.stringify({ position: row.position, id: row.id })) : null;
}
