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
import type { DesignTokens, Image, ParityDirection, Theme } from "@design-parity/core";

import type {
  Catalog,
  CatalogComponent,
  CatalogDisplay,
  CatalogImage,
  CatalogScreen,
  ComponentReference,
  Greenline,
  Redline,
} from "./types.js";

/** Which sticker-sheet variant an image belongs to. */
export type VariantKind = "ideal" | "layout";

/** One image entry in the manifest — bundle-relative path + variant keys. */
export interface CatalogManifestImage {
  variant: VariantKind;
  /** Bundle-relative PNG path (forward slashes). */
  path: string;
  /** Compose preview that produced this render; used for exact mapped upgrades. */
  previewId?: string;
  state: string;
  theme?: Theme;
  size?: string;
  /** Extra named variant axes (e.g. `{ content: "icon+label" }`) → set variant props. */
  props?: Record<string, string>;
  width: number;
  height: number;
  /**
   * Deep link into a live preview server where this exact variant can be opened
   * and customised — the cross-tool bridge that makes browsing the published
   * `design-artifacts/<system>` branch and a live, editable preview the same
   * render. Present only when a {@link ManifestOptions.previewServer} base is
   * configured. See {@link livePreviewUrl}.
   */
  livePreview?: string;
}

/** One component entry in the manifest. */
export interface CatalogManifestComponent {
  componentId: string;
  /**
   * Top-level section (tab) this component belongs to — see
   * {@link CatalogComponent.section}. A preview host groups components by
   * `section` into tabs, with {@link group} as the sub-heading inside a tab.
   */
  section?: string;
  group?: string;
  caption?: string;
  reference?: ComponentReference;
  images: CatalogManifestImage[];
  tokens?: DesignTokens;
  greenlines: Greenline[];
  /** Layout spacing spec — per-node box + padding + gap + corner radius. */
  redlines: Redline[];
  /**
   * Bundle-relative path to the pre-generated **wireframe SVG** (one bordered box
   * per composable), when the component carries box geometry. The importer places
   * it as the vector wireframe comparison lane. Absent ⇒ no wireframe.
   */
  wireframe?: string;
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
  /**
   * The consumer repo's parity direction (from its `.design-parity.json`), so a
   * design-tool importer knows who owns the source of truth without reaching the
   * repo. `code-led` ⇒ the importer may own the design catalog; `design-led` ⇒
   * renders are reference-only and writes need confirmation; `auto`/absent ⇒ the
   * importer applies its safe default. Set by the generator, not by the renderer.
   */
  direction?: ParityDirection;
  /**
   * The screen graph — main screens + their related secondaries/dialogs — for a
   * per-screen import. Carried through from the catalog spec; absent ⇒ flat.
   */
  screens?: CatalogScreen[];
  /**
   * Presentation hints (stage surface + hero preview) carried through from the
   * catalog spec, so a viewer/index reads the system's own choice. Absent ⇒ the
   * consumer's defaults.
   */
  display?: CatalogDisplay;
  components: CatalogManifestComponent[];
}

/**
 * A live preview server the catalog should deep-link into, so each image carries
 * a `livePreview` URL where a designer can open and customise that variant. The
 * upstream `compose-preview serve --catalogs <system>` hosts the same published
 * catalog, so the link round-trips to the same render the sticker sheet shows.
 */
export interface PreviewServerOptions {
  /** Base URL of the live server, e.g. `"https://preview.coo.ee"`. */
  base: string;
}

export interface ManifestOptions {
  /** Bundle-relative DTCG token filename. Default `"tokens.dtcg.json"`. */
  tokensFile?: string;
  /**
   * The consumer repo's parity direction to stamp into the manifest (from its
   * `.design-parity.json`). Omitted ⇒ no `direction` field; the importer applies
   * its own safe default.
   */
  direction?: ParityDirection;
  /**
   * When set, every image entry gets a {@link CatalogManifestImage.livePreview}
   * deep link into this server. Omitted ⇒ no `livePreview` fields (the catalog is
   * still complete; the links are an additive convenience).
   */
  previewServer?: PreviewServerOptions;
}

const DEFAULT_TOKENS_FILE = "tokens.dtcg.json";

/**
 * The live-preview deep link for a manifest image. Targets the server's **viewer**
 * route `/p/{name}` (not `/?preview=`, which only renders the session landing
 * page) with `?session=<system>` selecting the catalog. The preview id is the
 * image's bundle path without the `images/` prefix and `.png` suffix, with the
 * component-subdir `/` flattened to `__` — exactly how `compose-preview serve
 * --catalogs` derives a route-safe (single-path-segment) catalog preview id, so
 * the link resolves to the matching live render. Pure; trailing slashes on
 * `base` are normalized away.
 */
export function livePreviewUrl(
  base: string,
  system: string,
  imagePath: string,
): string {
  const id = imagePath
    .replace(/^images\//, "")
    .replace(/\.png$/, "")
    .replace(/\//g, "__");
  const root = base.replace(/\/+$/, "");
  return `${root}/p/${encodeURIComponent(id)}?session=${encodeURIComponent(system)}`;
}

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
 * component id and every variant key — including extra `props` axes — so
 * distinct states/themes/sizes/props never collide:
 * `images/<component>/<variant>__<state>[__<theme>][__<size>][__<k-v>…].png`.
 */
/**
 * The **sticker id** a preview server routes on — `<component>__<variant>__<state>[…]`.
 *
 * This is the id in a compare URL (`…/compare/device-populated__ideal__default__compact`) and the
 * one design references are keyed by, derived from exactly the same parts as {@link imagePath} so
 * the two can never drift. Used as the annotation key when an image carries no explicit
 * `previewId`: a catalog that never recorded one is still addressable, because this is how the
 * server names it either way.
 */
export function stickerId(
  componentId: string,
  variant: VariantKind,
  image: Image,
): string | undefined {
  // `state` is what makes the id addressable; without it there is no stable name to derive and
  // guessing one would key annotations to something the server never looks up.
  if (!image.state) return undefined;
  const file = imagePath(componentId, variant, image)
    .replace(/^images\//, "")
    .replace(/\.png$/, "");
  const [dir, stem] = file.split("/");
  return `${dir}__${stem}`;
}

export function imagePath(
  componentId: string,
  variant: VariantKind,
  image: Image,
): string {
  const parts = [variant, image.state];
  if (image.theme) parts.push(image.theme);
  if (image.size) parts.push(image.size);
  // Sorted so the path is deterministic regardless of prop declaration order.
  for (const [key, value] of Object.entries(image.props ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`${key}-${value}`);
  }
  const file = parts.map(slug).join("__");
  return `images/${slug(componentId)}/${file}.png`;
}

/** Context threaded into the per-component builders: the system id + optional live-link base. */
interface ManifestContext {
  system: string;
  previewServer?: PreviewServerOptions;
}

function manifestImages(
  component: CatalogComponent,
  ctx: ManifestContext,
): CatalogManifestImage[] {
  const out: CatalogManifestImage[] = [];
  const push = (variant: VariantKind, images: CatalogImage[] | undefined): void => {
    for (const image of images ?? []) {
      const path = imagePath(component.componentId, variant, image);
      const entry: CatalogManifestImage = {
        variant,
        path,
        state: image.state,
        width: image.width,
        height: image.height,
      };
      if (image.theme) entry.theme = image.theme;
      if (image.previewId) entry.previewId = image.previewId;
      if (image.size) entry.size = image.size;
      if (image.props && Object.keys(image.props).length > 0) entry.props = image.props;
      if (ctx.previewServer) {
        entry.livePreview = livePreviewUrl(
          ctx.previewServer.base,
          ctx.system,
          path,
        );
      }
      out.push(entry);
    }
  };
  push("ideal", component.variants.ideal);
  push("layout", component.variants.layout);
  return out;
}

/** Bundle-relative path for a component's pre-generated wireframe SVG. */
export function wireframePath(componentId: string): string {
  return `wireframes/${slug(componentId)}.svg`;
}

function manifestComponent(
  component: CatalogComponent,
  ctx: ManifestContext,
): CatalogManifestComponent {
  const out: CatalogManifestComponent = {
    componentId: component.componentId,
    images: manifestImages(component, ctx),
    greenlines: component.greenlines,
    redlines: component.redlines,
  };
  if (component.section !== undefined) out.section = component.section;
  if (component.group !== undefined) out.group = component.group;
  if (component.caption !== undefined) out.caption = component.caption;
  if (component.reference !== undefined) out.reference = component.reference;
  if (component.tokens !== undefined) out.tokens = component.tokens;
  if (component.wireframeSvg !== undefined) out.wireframe = wireframePath(component.componentId);
  return out;
}

/** Build the serializable {@link CatalogManifest} for a {@link Catalog} (pure). */
export function toCatalogManifest(
  catalog: Catalog,
  opts: ManifestOptions = {},
): CatalogManifest {
  const ctx: ManifestContext = {
    system: catalog.meta.system,
    previewServer: opts.previewServer,
  };
  const manifest: CatalogManifest = {
    schema: "design-parity-catalog/v1",
    system: catalog.meta.system,
    title: catalog.meta.title,
    components: catalog.components.map((c) => manifestComponent(c, ctx)),
  };
  if (catalog.meta.library) manifest.library = catalog.meta.library;
  if (catalog.meta.renderer) manifest.renderer = catalog.meta.renderer;
  if (catalog.meta.generatedAt) manifest.generatedAt = catalog.meta.generatedAt;
  if (opts.direction) manifest.direction = opts.direction;
  if (catalog.meta.screens) manifest.screens = catalog.meta.screens;
  if (catalog.meta.display) manifest.display = catalog.meta.display;
  if (catalog.themeTokens) {
    manifest.tokensFile = opts.tokensFile ?? DEFAULT_TOKENS_FILE;
  }
  return manifest;
}
