export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "expired"
  | "unverified"
  | "internal";

export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, field?: string): ApiError =>
  new ApiError(422, "validation", message, field);

export const unauthenticated = (): ApiError =>
  new ApiError(401, "unauthenticated", "Authentication is required");

export const forbidden = (message = "You do not have permission to do that"): ApiError =>
  new ApiError(403, "forbidden", message);

export const notFound = (resource: string): ApiError =>
  new ApiError(404, "not_found", `${resource} was not found`);

export const conflict = (message: string, field?: string): ApiError =>
  new ApiError(409, "conflict", message, field);
