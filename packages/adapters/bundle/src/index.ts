/**
 * `@design-parity/adapter-bundle` — the image-bundle reference driver.
 *
 * For a source with **no read API and no HTML export** — a designer just hands
 * over a folder or `.zip` of exported PNGs. The reference is a committed
 * directory or `.zip` (linked via `design-map.json`) holding reference PNGs and
 * a tiny `manifest.json`; this adapter normalizes it to a {@link DesignReference}
 * with `linkMethod: "manifest"`. Depends only on `@design-parity/core` (plus the
 * dependency-free `fflate` for in-memory unzip).
 */
export { BundleAdapter, createBundleAdapter } from "./adapter.js";
export type { BundleAdapterOptions } from "./adapter.js";

export {
  parseManifest,
  type BundleManifest,
  type BundleManifestImage,
} from "./manifest.js";

export { openBundle, type BundleContents } from "./bundle-source.js";

export { parsePngSize, type PngSize } from "./png.js";

export {
  BundleError,
  BundleNotFoundError,
  BundleManifestError,
  BundleImageNotFoundError,
  type BundleErrorCode,
} from "./errors.js";
