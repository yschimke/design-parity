/**
 * The pure **single-component picker** — the model behind "insert one component"
 * instead of dumping the whole catalog.
 *
 * `buildImportPlan` (plan.ts) is the bulk flow: every component onto a sheet.
 * This module is the selective flow: index a {@link CatalogManifest} into the
 * choices a designer picks from — a component, an optional **variant** (the
 * component's own state axis), and optional **dimensions** (the presentation
 * axes the catalog actually carries: theme, size, and any extra `props` axis
 * such as content, or the i18n dimensions locale / direction / font-scale) —
 * then resolve a concrete selection to the single image (or wireframe) to place.
 *
 * Pure: no `figma`, no `fetch`. The UI reflects {@link CatalogIndex} into
 * dropdowns and hands a {@link PickSelection} back to {@link selectCatalogImage};
 * `insert.ts` places the resolved bytes. Which axes a given catalog exposes is
 * data-driven — a catalog rendered with only light/dark yields just a Theme
 * dimension; one rendered across breakpoints/locales yields those too — so the
 * plugin "picks useful dimensions for each catalog" without hardcoding a system.
 */
import type {
  CatalogManifest,
  CatalogManifestComponent,
  CatalogManifestImage,
} from "@design-parity/catalog-export";

import { resolveImageUrl } from "./plan.js";

/** The prefix that tags a dimension key derived from an image `props` axis. */
export const PROP_AXIS_PREFIX = "prop:";

/**
 * One pickable axis: its stable key, a human label for the dropdown, and the
 * distinct values found across the component's `ideal` images (first-seen order,
 * so the picker is deterministic and matches the catalog's declaration order).
 */
export interface PickAxis {
  /** `"state"` for the variant axis; `"theme"` / `"size"`; or `prop:<name>`. */
  key: string;
  /** Human label for the control (e.g. `"Variant"`, `"Theme"`, `"Content"`). */
  label: string;
  /** Distinct values in first-seen order. */
  values: string[];
  /**
   * A short "what this checks" hint for the control, present only for axes the
   * plugin recognises — the i18n dimensions (locale / direction / font-scale,
   * issue #220). Lets the UI caption why inserting the axis matters (text
   * expansion, RTL mirroring, dynamic type) without hardcoding a design system.
   */
  caption?: string;
}

/** One component a designer can insert, with the axes it can be narrowed by. */
export interface PickComponent {
  componentId: string;
  group?: string;
  caption?: string;
  /**
   * The component's own **variant** axis — its `state` values (`default`,
   * `pressed`, `disabled`, …). Absent when the component has a single state.
   */
  variant?: PickAxis;
  /**
   * The presentation **dimensions** the catalog carries for this component —
   * theme, size, and any extra `props` axis — each an optional narrower. Empty
   * when the component renders in a single theme/size with no prop axes.
   */
  dimensions: PickAxis[];
  /** Whether a wireframe SVG exists, so the UI can offer the SVG format. */
  hasWireframe: boolean;
}

/** The catalog indexed for selective insertion — the picker's whole view model. */
export interface CatalogIndex {
  system: string;
  title: string;
  components: PickComponent[];
}

/**
 * A resolved selection from the picker: the chosen component, an optional
 * variant (state), and optional dimension values keyed by {@link PickAxis.key}.
 * A blank / omitted axis means "any" — the first matching image is used.
 */
export interface PickSelection {
  componentId: string;
  /** Chosen `state`; omitted / blank ⇒ any state. */
  variant?: string;
  /** Chosen dimension values, keyed by axis key; blank entries are ignored. */
  dimensions?: Record<string, string>;
}

/** A resolved image to place: the manifest entry plus its absolute URL. */
export interface PickedImage {
  image: CatalogManifestImage;
  url: string;
}

/**
 * Friendlier label + a short "what this checks" caption for the **i18n
 * dimensions** (issue #220). These arrive as `props` axes from the render matrix
 * (locale / direction / font-scale), so the picker surfaces them data-driven;
 * this table only makes the known ones read nicely — `fontScale` → `Font scale`
 * rather than the default `FontScale`, and a caption a designer can act on. Any
 * other axis falls back to the generic capitalised label.
 */
const I18N_AXIS_METADATA: Record<string, { label: string; caption: string }> = {
  locale: { label: "Locale", caption: "checks text expansion / truncation" },
  direction: { label: "Direction", caption: "checks RTL mirroring" },
  fontScale: { label: "Font scale", caption: "checks dynamic type" },
};

/** The bare axis name behind a key (`prop:locale` → `locale`, `theme` → `theme`). */
function axisName(key: string): string {
  return key.startsWith(PROP_AXIS_PREFIX) ? key.slice(PROP_AXIS_PREFIX.length) : key;
}

/** Human label for an axis key (`prop:content` → `Content`, `prop:fontScale` → `Font scale`). */
function axisLabel(key: string): string {
  const name = axisName(key);
  const meta = I18N_AXIS_METADATA[name];
  if (meta) return meta.label;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The i18n "what this checks" caption for an axis key, or `undefined`. */
function axisCaption(key: string): string | undefined {
  return I18N_AXIS_METADATA[axisName(key)]?.caption;
}

/** The value an image carries on a given axis key (undefined ⇒ not set). */
function axisValue(image: CatalogManifestImage, key: string): string | undefined {
  if (key === "state") return image.state;
  if (key === "theme") return image.theme;
  if (key === "size") return image.size;
  if (key.startsWith(PROP_AXIS_PREFIX)) return image.props?.[key.slice(PROP_AXIS_PREFIX.length)];
  return undefined;
}

/** Collect the distinct values for an axis across images, in first-seen order. */
function distinctValues(images: CatalogManifestImage[], key: string): string[] {
  const seen: string[] = [];
  for (const image of images) {
    const value = axisValue(image, key);
    if (value !== undefined && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

/**
 * Whether an axis offers a real choice — more than one *effective* state. A
 * `props` axis some images lack has an implicit "absent" state, so a single
 * declared value (`content: icon+label` vs the label-only default) still counts;
 * a fully-populated axis (theme, size) needs two declared values to be worth a
 * dropdown.
 */
function isMeaningfulAxis(images: CatalogManifestImage[], key: string, values: string[]): boolean {
  const someAbsent = images.some((image) => axisValue(image, key) === undefined);
  return values.length + (someAbsent ? 1 : 0) > 1;
}

/** The `ideal` (shipping-render) images — the surface single-insert draws from. */
function idealImages(component: CatalogManifestComponent): CatalogManifestImage[] {
  return component.images.filter((image) => image.variant === "ideal");
}

/** Build the {@link PickComponent} for one manifest component (pure). */
function indexComponent(component: CatalogManifestComponent): PickComponent {
  const images = idealImages(component);

  // The variant axis is `state`; only expose it when there's a real choice.
  const states = distinctValues(images, "state");
  const variant: PickAxis | undefined =
    states.length > 1 ? { key: "state", label: "Variant", values: states } : undefined;

  // Dimensions: theme, size, then every extra `props` axis the images carry.
  // Preserve first-seen prop-key order so the UI is deterministic.
  const propKeys: string[] = [];
  for (const image of images) {
    for (const key of Object.keys(image.props ?? {})) {
      if (!propKeys.includes(key)) propKeys.push(key);
    }
  }
  const dimensionKeys = ["theme", "size", ...propKeys.map((k) => `${PROP_AXIS_PREFIX}${k}`)];
  const dimensions: PickAxis[] = [];
  for (const key of dimensionKeys) {
    const values = distinctValues(images, key);
    if (!isMeaningfulAxis(images, key, values)) continue;
    const axis: PickAxis = { key, label: axisLabel(key), values };
    const caption = axisCaption(key);
    if (caption) axis.caption = caption;
    dimensions.push(axis);
  }

  const out: PickComponent = {
    componentId: component.componentId,
    dimensions,
    hasWireframe: component.wireframe !== undefined,
  };
  if (component.group !== undefined) out.group = component.group;
  if (component.caption !== undefined) out.caption = component.caption;
  if (variant) out.variant = variant;
  return out;
}

/** A group of pickable components under one header — for a grouped/searchable picker. */
export interface ComponentGroup {
  name: string;
  components: PickComponent[];
}

/** Whether a component matches a lowercased query (its id, caption, or group). */
function componentMatches(component: PickComponent, query: string): boolean {
  if (!query) return true;
  const haystack = [component.componentId, component.caption ?? "", component.group ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Group the indexed components by their `group` (fallback `"Ungrouped"`), in
 * first-seen order, optionally filtered by a free-text `query` matched
 * case-insensitively against each component's id, caption, and group. Empty
 * groups are dropped. Powers the searchable, `<optgroup>`-grouped component picker.
 */
export function groupComponents(index: CatalogIndex, query = ""): ComponentGroup[] {
  const q = query.trim().toLowerCase();
  const order: string[] = [];
  const byGroup = new Map<string, PickComponent[]>();
  for (const component of index.components) {
    if (!componentMatches(component, q)) continue;
    const name = component.group ?? "Ungrouped";
    const bucket = byGroup.get(name);
    if (bucket) bucket.push(component);
    else {
      byGroup.set(name, [component]);
      order.push(name);
    }
  }
  return order.map((name) => ({ name, components: byGroup.get(name)! }));
}

/**
 * Index a manifest into the picker's view model: one {@link PickComponent} per
 * catalog component, each carrying the variant + dimension axes it can be
 * narrowed by. Components with no `ideal` render are dropped (nothing to place).
 */
export function indexCatalog(manifest: CatalogManifest): CatalogIndex {
  const components = manifest.components
    .filter((component) => idealImages(component).length > 0)
    .map(indexComponent);
  return { system: manifest.system, title: manifest.title, components };
}

/**
 * Resolve a {@link PickSelection} to the single `ideal` image to place: the
 * first image matching every *specified* axis (variant + non-blank dimensions);
 * unspecified axes are "any". Returns `undefined` when the component is unknown
 * or nothing matches the requested combination.
 */
export function selectCatalogImage(
  manifest: CatalogManifest,
  selection: PickSelection,
  baseUrl: string,
): PickedImage | undefined {
  const component = manifest.components.find((c) => c.componentId === selection.componentId);
  if (!component) return undefined;

  const constraints: [string, string][] = [];
  if (selection.variant) constraints.push(["state", selection.variant]);
  for (const [key, value] of Object.entries(selection.dimensions ?? {})) {
    if (value) constraints.push([key, value]);
  }

  const image = idealImages(component).find((candidate) =>
    constraints.every(([key, value]) => axisValue(candidate, key) === value),
  );
  if (!image) return undefined;
  return { image, url: resolveImageUrl(baseUrl, image.path) };
}

/** The absolute URL of a component's wireframe SVG, or `undefined` when it has none. */
export function selectCatalogWireframe(
  manifest: CatalogManifest,
  componentId: string,
  baseUrl: string,
): string | undefined {
  const component = manifest.components.find((c) => c.componentId === componentId);
  if (!component?.wireframe) return undefined;
  return resolveImageUrl(baseUrl, component.wireframe);
}

/** A filesystem-safe slug for a component id (matches `catalog-export`'s `slug`). */
function componentSlug(componentId: string): string {
  return (
    componentId
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "x"
  );
}

/**
 * Bundle-relative path to a component's **editable design vector** — the
 * `compose/figma-svg` export the delivery branch now ships at `figma/<slug>.svg`
 * (a design-fidelity vector render, not the schematic wireframe). The slug matches
 * the wireframe's, so when a wireframe path is present it's reused verbatim (just
 * the `wireframes/` → `figma/` directory); otherwise it's derived from the id.
 */
function designVectorPath(component: CatalogManifestComponent): string {
  if (component.wireframe) return component.wireframe.replace(/^wireframes\//, "figma/");
  return `figma/${componentSlug(component.componentId)}.svg`;
}

/**
 * The absolute URL of a component's **editable design vector** (`figma/<slug>.svg`,
 * the `compose/figma-svg` export) by delivery-branch convention. Returned for any
 * known component — the file's presence is confirmed at fetch time, with the
 * wireframe as the fallback. `undefined` only when the component id is unknown.
 */
export function selectCatalogDesignVector(
  manifest: CatalogManifest,
  componentId: string,
  baseUrl: string,
): string | undefined {
  const component = manifest.components.find((c) => c.componentId === componentId);
  if (!component) return undefined;
  return resolveImageUrl(baseUrl, designVectorPath(component));
}

/** One variant cell of a component set: the render plus its Figma variant-property name. */
export interface ComponentSetCell {
  /** Bundle-relative source path (for dedup / diagnostics). */
  path: string;
  /** Absolute URL the UI fetches the PNG bytes from. */
  url: string;
  /** Figma variant-property string, e.g. `state=default, theme=light, size=compact`. */
  name: string;
  width: number;
  height: number;
}

/** The Figma variant-property name for a manifest image (mirrors `scene.ts` `variantName`). */
function variantPropsName(image: CatalogManifestImage): string {
  const parts = [`state=${image.state ?? "default"}`];
  if (image.theme) parts.push(`theme=${image.theme}`);
  if (image.size) parts.push(`size=${image.size}`);
  // Extra axes (e.g. content=icon+label), sorted for a stable property order.
  for (const [key, value] of Object.entries(image.props ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`${key}=${value}`);
  }
  return parts.join(", ");
}

/**
 * The cells of a native Figma **component set** for one component: every `ideal`
 * render as a `{ path, url, name, width, height }`, `name` being its
 * variant-property string. Empty when the component is unknown or carries no
 * ideal render. The whole-catalog Components page builds the same set per
 * component (`scene.ts` `renderComponentSet`); this exposes it for a single-
 * component insert without importing the whole catalog.
 */
export function componentSetCells(
  manifest: CatalogManifest,
  componentId: string,
  baseUrl: string,
): ComponentSetCell[] {
  const component = manifest.components.find((c) => c.componentId === componentId);
  if (!component) return [];
  return idealImages(component).map((image) => ({
    path: image.path,
    url: resolveImageUrl(baseUrl, image.path),
    name: variantPropsName(image),
    width: image.width,
    height: image.height,
  }));
}
