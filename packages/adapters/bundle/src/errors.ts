/** Errors the bundle adapter raises. All carry a stable `code` for callers. */

export type BundleErrorCode =
  | "missing-bundle"
  | "bad-manifest"
  | "missing-image";

/** Base class so callers can `catch (e) { if (e instanceof BundleError) ... }`. */
export class BundleError extends Error {
  readonly code: BundleErrorCode;
  constructor(code: BundleErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The bundle directory or `.zip` named by the `ref` does not exist. */
export class BundleNotFoundError extends BundleError {
  readonly ref: string;
  constructor(ref: string, options?: ErrorOptions) {
    super(
      "missing-bundle",
      `bundle: cannot read bundle '${ref}' — expected a committed directory or '.zip'`,
      options,
    );
    this.ref = ref;
  }
}

/** `manifest.json` is absent from the bundle, is not valid JSON, or is malformed. */
export class BundleManifestError extends BundleError {
  readonly ref: string;
  constructor(ref: string, detail: string, options?: ErrorOptions) {
    super(
      "bad-manifest",
      `bundle: '${ref}' has an invalid manifest.json — ${detail}`,
      options,
    );
    this.ref = ref;
  }
}

/** A manifest image references a file that is not present in the bundle. */
export class BundleImageNotFoundError extends BundleError {
  readonly ref: string;
  readonly imagePath: string;
  constructor(ref: string, imagePath: string, options?: ErrorOptions) {
    super(
      "missing-image",
      `bundle: '${ref}' manifest references image '${imagePath}' that is not in the bundle`,
      options,
    );
    this.ref = ref;
    this.imagePath = imagePath;
  }
}
