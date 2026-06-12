/** Errors the Stitch adapter raises. All carry a stable `code` for callers. */

export type StitchErrorCode =
  | "auth"
  | "manifest-miss"
  | "bad-ref"
  | "sdk"
  | "rasterize";

/** Base class so callers can `catch (e) { if (e instanceof StitchError) ... }`. */
export class StitchError extends Error {
  readonly code: StitchErrorCode;
  constructor(code: StitchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** No Stitch credential configured, or the SDK rejected the credential. */
export class StitchAuthError extends StitchError {
  constructor(message: string, options?: ErrorOptions) {
    super("auth", message, options);
  }
}

/**
 * No `design-map.json` entry links this component to a Stitch design. Stitch has
 * no machine link, so the manifest is the only correspondence layer.
 */
export class StitchManifestError extends StitchError {
  readonly componentId: string;
  constructor(componentId: string, detail: string, options?: ErrorOptions) {
    super(
      "manifest-miss",
      `stitch: no design-map entry for '${componentId}' — ${detail}`,
      options,
    );
    this.componentId = componentId;
  }
}

/** The `ref` could not be parsed into a Stitch project/screen handle. */
export class StitchBadRefError extends StitchError {
  constructor(ref: string, options?: ErrorOptions) {
    super(
      "bad-ref",
      `stitch: cannot parse ref '${ref}' — expected 'stitch:<projectId>/<screenId>'`,
      options,
    );
  }
}

/** The SDK was unreachable, not installed, or returned an unusable payload. */
export class StitchSdkError extends StitchError {
  constructor(message: string, options?: ErrorOptions) {
    super("sdk", message, options);
  }
}

/** Headless rasterization of the fetched HTML failed. */
export class StitchRasterizeError extends StitchError {
  constructor(message: string, options?: ErrorOptions) {
    super("rasterize", message, options);
  }
}
