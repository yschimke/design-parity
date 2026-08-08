/** Errors the Figma adapter raises. All carry a stable `code` for callers. */

export type FigmaErrorCode =
  | "auth"
  | "rate-limit"
  | "node-not-found"
  | "bad-ref"
  | "cache-miss"
  | "api";

/** Base class so callers can `catch (e) { if (e instanceof FigmaError) ... }`. */
export class FigmaError extends Error {
  readonly code: FigmaErrorCode;
  constructor(code: FigmaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Missing/invalid token, or 401/403 from the API. */
export class FigmaAuthError extends FigmaError {
  constructor(message: string, options?: ErrorOptions) {
    super("auth", message, options);
  }
}

/** 429 from the API. `retryAfterSeconds` is parsed from `Retry-After` when present. */
export class FigmaRateLimitError extends FigmaError {
  readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number, options?: ErrorOptions) {
    super("rate-limit", message, options);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The requested node is absent from the file, or the image render returned null. */
export class FigmaNodeNotFoundError extends FigmaError {
  readonly fileKey: string;
  readonly nodeId: string;
  constructor(fileKey: string, nodeId: string, options?: ErrorOptions) {
    super(
      "node-not-found",
      `figma: node '${nodeId}' not found in file '${fileKey}'`,
      options,
    );
    this.fileKey = fileKey;
    this.nodeId = nodeId;
  }
}

/** The `ref` could not be parsed into a file key + node id. */
export class FigmaBadRefError extends FigmaError {
  constructor(ref: string, options?: ErrorOptions) {
    super(
      "bad-ref",
      `figma: cannot parse ref '${ref}' — expected 'figma:<fileKey>/<nodeId>' or a figma.com URL`,
      options,
    );
  }
}

/**
 * The node is absent from the committed reference cache, and the run was told
 * to read only from it.
 *
 * Distinct from {@link FigmaNodeNotFoundError} because the remedy is different
 * and mechanical: the node exists, the *import* has not reached it yet. The
 * message says so, since this surfaces per component on an otherwise green run.
 */
export class FigmaCacheMissError extends FigmaError {
  readonly fileKey: string;
  readonly nodeId: string;
  constructor(fileKey: string, nodeId: string, detail?: string, options?: ErrorOptions) {
    super(
      "cache-miss",
      `figma: '${fileKey}/${nodeId}' is not in the reference cache` +
        (detail ? ` (${detail})` : "") +
        " — run `design-parity import` to fetch it",
      options,
    );
    this.fileKey = fileKey;
    this.nodeId = nodeId;
  }
}

/** Any other non-2xx response. */
export class FigmaApiError extends FigmaError {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super("api", message, options);
    this.status = status;
  }
}
