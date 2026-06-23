/**
 * The importable **catalog manifest** — `catalog.json`.
 *
 * This is the index a design tool reads: provenance, a pointer to the DTCG
 * token file, and one entry per component carrying every variant image (ideal +
 * layout) with a stable bundle-relative path, the component's resolved tokens,
 * its greenline layer, and its seed-kit reference. It is a superset of the
 * `@design-parity/adapter-bundle` `manifest.json` shape (same `path` / `state` /
 * `theme` / `size` image keys) so a catalog component is also a valid parity
 * bundle — the same artifact round-trips back through the parity flow.
 *
 * {@link toCatalogManifest} is **pure** (it only computes paths, no I/O); the
 * {@link writeCatalog} step materializes the bytes those paths point at.
 */
import type { DesignTokens, Image, Theme } from "@design-parity/core";

import type { Catalog, CatalogComponent, ComponentReference, Greenline } from "./types.js";

/** Which sticker-sheet variant an image belongs to. */
export type VariantKind = "ideal" | "layout";

/** One image entry in the manifest — bundle-relative path + variant keys. */
export interface CatalogManifestImage {
  variant: VariantKind;
  /** Bundle-relative PNG path (forward slashes). */
  path: string;
  state: string;
  theme?: Theme;
  size?: string;
  width: number;
  height: number;
}

/** One component entry in the manifest. */
export interface CatalogManifestComponent {
  componentId: string;
  group?: string;
  caption?: string;
  reference?: ComponentReference;
  images: CatalogManifestImage[];
  tokens?: DesignTokens;
  greenlines: Greenline[];
}

/** The parsed/serializable `catalog.json`. */
export interface CatalogManifest {
  schema: "design-parity-catalog/v1";
  system: string;
  title: string;
  library?: string[];
  renderer?: string;
  generatedAt?: string;
  /** Bundle-relative path to the DTCG token file, when tokens were exported. */
  tokensFile?: string;
  components: CatalogManifestComponent[];
}

export interface ManifestOptions {
  /** Bundle-relative DTCG token filename. Default `"tokens.dtcg.json"`. */
  tokensFile?: string;
}

const DEFAULT_TOKENS_FILE = "tokens.dtcg.json";

/** Filesystem-safe slug for a component id / variant key segment. */
export function slug(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "x"
  );
}

/**
 * Bundle-relative path for one variant image of a component. Encodes the
 * component id and every variant key so distinct states/themes/sizes never
 * collide:
 * `images/<component>/<variant>__<state>[__<theme>][__<size>].png`.
 */
export function imagePath(
  componentId: string,
  variant: VariantKind,
  image: Image,
): string {
  const parts = [variant, image.state];
  if (image.theme) parts.push(image.theme);
  if (image.size) parts.push(image.size);
  const file = parts.map(slug).join("__");
  return `images/${slug(componentId)}/${file}.png`;
}

function manifestImages(component: CatalogComponent): CatalogManifestImage[] {
  const out: CatalogManifestImage[] = [];
  const push = (variant: VariantKind, images: Image[] | undefined): void => {
    for (const image of images ?? []) {
      const entry: CatalogManifestImage = {
        variant,
        path: imagePath(component.componentId, variant, image),
        state: image.state,
        width: image.width,
        height: image.height,
      };
      if (image.theme) entry.theme = image.theme;
      if (image.size) entry.size = image.size;
      out.push(entry);
    }
  };
  push("ideal", component.variants.ideal);
  push("layout", component.variants.layout);
  return out;
}

function manifestComponent(component: CatalogComponent): CatalogManifestComponent {
  const out: CatalogManifestComponent = {
    componentId: component.componentId,
    images: manifestImages(component),
    greenlines: component.greenlines,
  };
  if (component.group !== undefined) out.group = component.group;
  if (component.caption !== undefined) out.caption = component.caption;
  if (component.reference !== undefined) out.reference = component.reference;
  if (component.tokens !== undefined) out.tokens = component.tokens;
  return out;
}

/** Build the serializable {@link CatalogManifest} for a {@link Catalog} (pure). */
export function toCatalogManifest(
  catalog: Catalog,
  opts: ManifestOptions = {},
): CatalogManifest {
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: catalog.meta.system,
    title: catalog.meta.title,
    components: catalog.components.map(manifestComponent),
  };
  if (catalog.meta.library) manifest.library = catalog.meta.library;
  if (catalog.meta.renderer) manifest.renderer = catalog.meta.renderer;
  if (catalog.meta.generatedAt) manifest.generatedAt = catalog.meta.generatedAt;
  if (catalog.themeTokens) {
    manifest.tokensFile = opts.tokensFile ?? DEFAULT_TOKENS_FILE;
  }
  return manifest;
}
