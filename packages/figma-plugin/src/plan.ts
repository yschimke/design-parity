/**
 * The pure **import planner** — the testable core of the Figma plugin.
 *
 * A Figma plugin runs in two realms: a sandboxed *main thread* that owns the
 * `figma` scene API but has no network, and a *UI iframe* that has `fetch` but
 * no scene access. Neither realm is unit-testable in a normal Node/vitest run.
 * So all of the interesting logic — turning a {@link CatalogManifest} into a
 * concrete description of what to draw on the canvas — lives here as pure
 * functions with no `figma` and no `fetch`. {@link figma/code.ts} executes the
 * plan against the scene; {@link figma/ui.ts} fetches the bytes; both are thin.
 *
 * The plan is the code → design direction: an authoritative render (the
 * catalog's `ideal` sticker variant) placed onto a Figma canvas, grouped by
 * component group, alongside the design system's token set projected to a Figma
 * variable collection. Figma is a *view* of the code, never the source of truth
 * — the same stance the upstream catalogs and roundtrip take.
 */
import type { DesignTokens } from "@design-parity/core";
import type {
  CatalogManifest,
  CatalogManifestComponent,
  CatalogManifestImage,
} from "@design-parity/catalog-export";
// The pure Figma projection is imported from catalog-export's browser-safe
// `./figma` subpath, not the package barrel: the barrel re-exports the on-disk
// catalog writer (`node:fs`), which can't be bundled into a Figma plugin.
import {
  type FigmaVariableCollection,
  toFigmaVariables,
} from "@design-parity/catalog-export/figma";

/** One image to place on the canvas: an absolute URL plus its pixel box. */
export interface PlannedImage {
  /** Human variant key for the layer name, e.g. `"default · dark · compact"`. */
  key: string;
  /** Absolute URL the UI iframe fetches the PNG bytes from. */
  url: string;
  /** Bundle-relative source path, retained for diagnostics / dedup. */
  path: string;
  width: number;
  height: number;
}

/** One component frame: its ideal-variant images in a row. */
export interface PlannedComponent {
  componentId: string;
  caption?: string;
  images: PlannedImage[];
}

/** A group of components laid out under one section header on the canvas. */
export interface PlannedGroup {
  name: string;
  components: PlannedComponent[];
}

/** The full description of what to import — consumed by the main thread. */
export interface ImportPlan {
  system: string;
  title: string;
  groups: PlannedGroup[];
  /**
   * The design system's tokens as a Figma variable collection, when theme
   * tokens are available. The main thread creates a local variable collection
   * from this; absent ⇒ images only, no variables.
   */
  collection?: FigmaVariableCollection;
  /** Total placed images across all groups, for the UI progress readout. */
  imageCount: number;
}

export interface PlanOptions {
  /**
   * Base URL the manifest's relative image paths resolve against — the raw
   * root of a published `design-artifacts/<system>` branch, or a local server.
   * Absolute (`http(s):`/`data:`) image paths are left untouched.
   */
  baseUrl: string;
  /**
   * The system-wide token set (the catalog's DTCG file, parsed back to
   * {@link DesignTokens}). When present it becomes a Figma variable collection.
   * The UI supplies it; the planner just projects it.
   */
  themeTokens?: DesignTokens;
  /**
   * Which sticker variant to place. The prototype imports the authoritative
   * `ideal` render; `layout` (the wireframe) is a future toggle.
   */
  variant?: "ideal" | "layout";
}

/** Resolve a manifest image path against the base URL (absolute paths pass through). */
export function resolveImageUrl(baseUrl: string, path: string): string {
  if (/^(https?:|data:)/i.test(path)) return path;
  const root = baseUrl.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  return `${root}/${rel}`;
}

/** Human-readable variant key for a layer name: `state · theme · size`. */
export function imageKey(image: CatalogManifestImage): string {
  return [image.state, image.theme, image.size].filter(Boolean).join(" · ");
}

function planImages(
  component: CatalogManifestComponent,
  opts: PlanOptions,
): PlannedImage[] {
  const variant = opts.variant ?? "ideal";
  return component.images
    .filter((image) => image.variant === variant)
    .map((image) => ({
      key: imageKey(image),
      url: resolveImageUrl(opts.baseUrl, image.path),
      path: image.path,
      width: image.width,
      height: image.height,
    }));
}

/**
 * Build the {@link ImportPlan} for a catalog manifest (pure — no I/O, no `figma`).
 *
 * Components are bucketed by their `group` (falling back to `"Ungrouped"`), and
 * group + component order follows first-seen order in the manifest so the sheet
 * is deterministic. A component with no image in the requested variant is
 * dropped rather than placed empty.
 */
export function buildImportPlan(
  manifest: CatalogManifest,
  opts: PlanOptions,
): ImportPlan {
  const byGroup = new Map<string, PlannedComponent[]>();
  let imageCount = 0;

  for (const component of manifest.components) {
    const images = planImages(component, opts);
    if (images.length === 0) continue;
    imageCount += images.length;

    const planned: PlannedComponent = {
      componentId: component.componentId,
      images,
    };
    if (component.caption !== undefined) planned.caption = component.caption;

    const groupName = component.group ?? "Ungrouped";
    const bucket = byGroup.get(groupName);
    if (bucket) bucket.push(planned);
    else byGroup.set(groupName, [planned]);
  }

  const groups: PlannedGroup[] = [...byGroup.entries()].map(
    ([name, components]) => ({ name, components }),
  );

  const plan: ImportPlan = {
    system: manifest.system,
    title: manifest.title,
    groups,
    imageCount,
  };
  if (opts.themeTokens) {
    plan.collection = toFigmaVariables(opts.themeTokens, manifest.title);
  }
  return plan;
}
