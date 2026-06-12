/**
 * The image-bundle reference adapter.
 *
 * There is a real workflow with no design-tool API and no HTML export: a
 * designer hands over a **bundle of exported PNGs** — a committed folder or a
 * `.zip` — plus a tiny `manifest.json`. This adapter generalizes the
 * claude-design "committed export + manifest" idea down to "raw images + a
 * description", so it covers Figma/Stitch/Claude exports dumped as PNGs, or any
 * tool with no integration at all. It:
 *
 *   1. resolves the bundle `ref` against the consumer repo root,
 *   2. opens it (directory or in-memory unzip of the `.zip`),
 *   3. parses `manifest.json` (tokens + image variants),
 *   4. reads each PNG's real dimensions from its IHDR, and
 *   5. normalizes everything to a {@link DesignReference} with
 *      `linkMethod: "manifest"` — the only link method a source with no machine
 *      link can have.
 *
 * Size labels are canonicalized through `normalizeSize` so the bundle's images
 * pair with the candidate render.
 */
import { isAbsolute, relative, resolve } from "node:path";

import {
  normalizeSize,
  type AdapterContext,
  type DesignReference,
  type Image,
  type ReferenceAdapter,
} from "@design-parity/core";

import { openBundle } from "./bundle-source.js";
import {
  BundleImageNotFoundError,
  BundleManifestError,
} from "./errors.js";
import { parseManifest } from "./manifest.js";
import { parsePngSize } from "./png.js";

export interface BundleAdapterOptions {
  /** Reserved for future knobs; present so the factory mirrors the others. */
}

const MANIFEST_NAME = "manifest.json";

/** Express an absolute path as a repo-relative, forward-slash URI. */
function repoRelative(repoRoot: string, abs: string): string {
  return relative(repoRoot, abs).split(/[\\/]/).join("/");
}

/** Bundle-relative path, forward slashes, no leading `./`. */
function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export class BundleAdapter implements ReferenceAdapter {
  readonly source = "bundle" as const;

  constructor(_options: BundleAdapterOptions = {}) {}

  /**
   * Resolve an image-bundle reference from a committed directory or `.zip`.
   *
   * @param componentId resolver-supplied code handle (authoritative).
   * @param ref repo-relative path to the bundle (the `design-map` ref).
   * @param ctx consumer repo root + environment.
   * @throws {@link BundleNotFoundError} if the bundle is missing;
   *   {@link BundleManifestError} if `manifest.json` is absent/invalid or its
   *   `componentId` contradicts `componentId`;
   *   {@link BundleImageNotFoundError} if a declared image is not in the bundle.
   */
  async resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference> {
    const abs = isAbsolute(ref) ? ref : resolve(ctx.repoRoot, ref);
    const isZip = abs.toLowerCase().endsWith(".zip");
    const bundleUri = repoRelative(ctx.repoRoot, abs);
    const bundle = await openBundle(abs, ref);

    const manifestBytes = await bundle.file(MANIFEST_NAME);
    if (!manifestBytes) {
      throw new BundleManifestError(ref, `'${MANIFEST_NAME}' is not in the bundle`);
    }
    const manifest = parseManifest(
      new TextDecoder().decode(manifestBytes),
      ref,
    );

    if (manifest.componentId && manifest.componentId !== componentId) {
      throw new BundleManifestError(
        ref,
        `it declares componentId '${manifest.componentId}' but was resolved for '${componentId}'`,
      );
    }

    const referenceImages: Image[] = [];
    for (const variant of manifest.images) {
      const bytes = await bundle.file(variant.path);
      if (!bytes) {
        throw new BundleImageNotFoundError(ref, variant.path);
      }
      const { width, height } = parsePngSize(bytes, variant.path);

      const imgPath = cleanPath(variant.path);
      // A directory bundle exposes each PNG as a real repo file, so its uri is
      // the repo-relative path. A `.zip` has no standalone file per entry, so
      // inline the unzipped bytes as a `data:` URI — the diff engine and HTML
      // report both decode it, making zip bundles end-to-end diff-able.
      const uri = isZip
        ? `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
        : `${bundleUri}/${imgPath}`;
      const image: Image = {
        state: variant.state ?? "default",
        uri,
        width,
        height,
      };
      if (variant.theme) image.theme = variant.theme;
      const size = normalizeSize(variant.size);
      if (size) image.size = size;
      else if (variant.size) image.size = variant.size;
      referenceImages.push(image);
    }

    const reference: DesignReference = {
      componentId,
      source: this.source,
      linkMethod: "manifest",
      ref,
      referenceImages,
    };
    if (manifest.tokens) reference.tokens = manifest.tokens;
    return reference;
  }
}

/** Convenience factory. */
export function createBundleAdapter(
  opts: BundleAdapterOptions = {},
): BundleAdapter {
  return new BundleAdapter(opts);
}
