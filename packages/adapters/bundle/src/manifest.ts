/**
 * The tiny `manifest.json` that sits inside an image bundle.
 *
 * A bundle is "raw images + a description": no HTML, no handoff block, just a
 * list of exported PNGs with their variant keys. This module owns the manifest
 * shape and its validation; the adapter owns reading bytes and producing the
 * normalized {@link DesignReference}.
 */
import type { DesignTokens, Theme } from "@design-parity/core";

import { BundleManifestError } from "./errors.js";

/** One declared image variant in a bundle manifest. */
export interface BundleManifestImage {
  /** Variant state, e.g. `"default"`, `"pressed"`. Defaults to `"default"`. */
  state?: string;
  theme?: Theme;
  /** Producer's size/breakpoint label; canonicalized via `normalizeSize`. */
  size?: string;
  /** Bundle-relative path to the PNG (forward slashes). */
  path: string;
  /** Hints only — the adapter reads the real dimensions from the PNG bytes. */
  width?: number;
  height?: number;
}

/** The parsed, validated `manifest.json`. */
export interface BundleManifest {
  componentId?: string;
  tokens?: DesignTokens;
  images: BundleManifestImage[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse and validate a bundle `manifest.json` payload.
 *
 * @param raw the manifest file contents (UTF-8 JSON).
 * @param ref the bundle `ref`, for error messages.
 * @throws {@link BundleManifestError} if the JSON is invalid or the shape is
 *   wrong (no `images` array, an image without a `path`, …).
 */
export function parseManifest(raw: string, ref: string): BundleManifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new BundleManifestError(ref, "not valid JSON", { cause });
  }
  if (!isObject(json)) {
    throw new BundleManifestError(ref, "expected a JSON object");
  }

  const { componentId, tokens, images } = json;
  if (componentId !== undefined && typeof componentId !== "string") {
    throw new BundleManifestError(ref, "'componentId' must be a string");
  }
  if (tokens !== undefined && !isObject(tokens)) {
    throw new BundleManifestError(ref, "'tokens' must be an object");
  }
  if (!Array.isArray(images) || images.length === 0) {
    throw new BundleManifestError(ref, "'images' must be a non-empty array");
  }

  const parsedImages: BundleManifestImage[] = images.map((img, i) => {
    if (!isObject(img)) {
      throw new BundleManifestError(ref, `images[${i}] must be an object`);
    }
    if (typeof img.path !== "string" || img.path.length === 0) {
      throw new BundleManifestError(ref, `images[${i}].path must be a non-empty string`);
    }
    if (img.state !== undefined && typeof img.state !== "string") {
      throw new BundleManifestError(ref, `images[${i}].state must be a string`);
    }
    if (img.theme !== undefined && img.theme !== "light" && img.theme !== "dark") {
      throw new BundleManifestError(ref, `images[${i}].theme must be 'light' or 'dark'`);
    }
    if (img.size !== undefined && typeof img.size !== "string") {
      throw new BundleManifestError(ref, `images[${i}].size must be a string`);
    }
    const out: BundleManifestImage = { path: img.path };
    if (typeof img.state === "string") out.state = img.state;
    if (img.theme === "light" || img.theme === "dark") out.theme = img.theme;
    if (typeof img.size === "string") out.size = img.size;
    if (typeof img.width === "number") out.width = img.width;
    if (typeof img.height === "number") out.height = img.height;
    return out;
  });

  const manifest: BundleManifest = { images: parsedImages };
  if (typeof componentId === "string") manifest.componentId = componentId;
  if (isObject(tokens)) manifest.tokens = tokens as DesignTokens;
  return manifest;
}
