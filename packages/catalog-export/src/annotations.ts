/**
 * Project a catalog's layout and typography facts into the **annotation manifest**
 * a preview server draws over a compare panel.
 *
 * The compare page diffs pixels: it shows *that* a render and its design
 * reference differ, never *why*. An annotation carries the spec a designer reads
 * off the mock — the padding and gap, the type style and size — anchored to a
 * region, so the two sides can be read against each other rather than eyeballed.
 *
 * Nothing here measures anything. The layout layer is the {@link Redline} set
 * `redlines.ts` already walks out of the semantics tree; the typography layer is
 * the per-node `tokens.typography` the renderer resolved. This module only
 * reshapes them into the transport the server consumes
 * (`compose-preview-annotations/v1`) and formats the one-line labels.
 *
 * Pure functions over core types — no I/O, trivially testable.
 */
import type {
  DesignReference,
  SemanticNode,
  SemanticTree,
  TypographyToken,
} from "@design-parity/core";

import { stickerId } from "./manifest.js";
import { buildRedlines } from "./redlines.js";
import type { CatalogComponent, Redline } from "./types.js";

/** Schema id the preview server validates before reading a manifest. */
export const ANNOTATION_SCHEMA = "compose-preview-annotations/v1";

/** Which spec layer an annotation belongs to; a viewer toggles them separately. */
export type AnnotationKind = "layout" | "typography";

export interface AnnotationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One annotation, anchored in the annotated image's own pixel space. */
export interface DesignAnnotation {
  kind: AnnotationKind;
  bounds: AnnotationBounds;
  /** One-line spec as a designer would read it, e.g. `"pad 16dp · gap 8dp"`. */
  label: string;
  /** Node / slot name, shown as the annotation's title. */
  role?: string;
  /** Structured payload for machine consumers. */
  detail?: Record<string, string>;
}

export interface AnnotationManifest {
  schema: typeof ANNOTATION_SCHEMA;
  /** Keyed by exact compose-preview id — annotations over the *rendered* frame. */
  previews: Record<string, DesignAnnotation[]>;
  /** Keyed by design-reference id — annotations over the *reference* raster. */
  references: Record<string, DesignAnnotation[]>;
}

/** Render a dp measurement the way a spec sheet writes it, without trailing zeros. */
function dp(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}dp`;
}

/**
 * Collapse a redline's per-edge padding into the shortest honest phrase.
 *
 * Four equal edges read as one `pad 16dp`; a symmetric box as `pad 12/16dp`
 * (vertical/horizontal, the order a designer says it); anything else is spelled
 * out per edge, because averaging asymmetric padding would state a spec the
 * component does not have.
 */
function paddingPhrase(padding: Redline["padding"]): string | undefined {
  if (!padding) return undefined;
  const { top, bottom, start, end } = padding;
  if (top === undefined && bottom === undefined && start === undefined && end === undefined) {
    return undefined;
  }
  if (top !== undefined && bottom !== undefined && start !== undefined && end !== undefined) {
    if (top === bottom && start === end && top === start) return `pad ${dp(top)}`;
    if (top === bottom && start === end) return `pad ${dp(top)}/${dp(start)}`;
  }
  const parts: string[] = [];
  if (top !== undefined) parts.push(`t ${dp(top)}`);
  if (end !== undefined) parts.push(`e ${dp(end)}`);
  if (bottom !== undefined) parts.push(`b ${dp(bottom)}`);
  if (start !== undefined) parts.push(`s ${dp(start)}`);
  return `pad ${parts.join(" ")}`;
}

/** Build the one-line label and structured detail for a layout redline. */
function layoutAnnotation(redline: Redline): DesignAnnotation | undefined {
  const parts: string[] = [];
  const detail: Record<string, string> = {};

  const pad = paddingPhrase(redline.padding);
  if (pad) {
    parts.push(pad);
    for (const [edge, value] of Object.entries(redline.padding ?? {})) {
      if (typeof value === "number") detail[`padding.${edge}`] = String(value);
    }
  }
  if (redline.gap !== undefined) {
    parts.push(`gap ${dp(redline.gap)}`);
    detail.gap = String(redline.gap);
  }
  if (redline.cornerRadius !== undefined) {
    parts.push(`r ${dp(redline.cornerRadius)}`);
    detail.cornerRadius = String(redline.cornerRadius);
  }

  // A redline with a box but no spacing spec says nothing a reader can act on —
  // the box is already visible in the render. Drop it rather than draw an
  // unlabelled rectangle.
  if (parts.length === 0) return undefined;

  return {
    kind: "layout",
    bounds: redline.bounds,
    label: parts.join(" · "),
    ...(redline.label ?? redline.role ? { role: redline.label ?? redline.role } : {}),
    detail,
  };
}

/**
 * The unit a type size is quoted in.
 *
 * A candidate's semantics resolve real `sp` — the value in the code. A design
 * tool reports the frame's own pixels, which are only `sp` if the frame happens
 * to be authored 1:1 with the code's density; on a 2x/3x board they are not, and
 * quoting them as `sp` states a spec several times larger than the design's.
 * Naming the unit keeps the number checkable instead of quietly wrong.
 */
export type TypeUnit = "sp" | "px";

/** `"bodyLarge 16sp/24"` — token name, size, and line height when it is known. */
function typographyLabel(
  name: string,
  token: TypographyToken,
  unit: TypeUnit,
): string | undefined {
  if (token.fontSize === undefined) return undefined;
  const size = Number.isInteger(token.fontSize) ? token.fontSize : Number(token.fontSize.toFixed(1));
  const lineHeight =
    token.lineHeight === undefined
      ? ""
      : `/${Number.isInteger(token.lineHeight) ? token.lineHeight : Number(token.lineHeight.toFixed(1))}`;
  return `${name} ${size}${unit}${lineHeight}`;
}

/**
 * Walk the semantics tree for nodes that resolved a type style.
 *
 * A node can carry more than one typography token; each becomes its own
 * annotation so the layer stays a flat list of drawable boxes. Nodes without
 * bounds are skipped — there is nowhere to anchor them.
 */
function typographyAnnotations(
  tree: SemanticTree | undefined,
  unit: TypeUnit = "sp",
): DesignAnnotation[] {
  if (!tree) return [];
  const out: DesignAnnotation[] = [];
  const visit = (node: SemanticNode): void => {
    const styles = node.tokens?.typography;
    if (styles && node.bounds) {
      for (const [name, token] of Object.entries(styles)) {
        const label = typographyLabel(name, token, unit);
        if (!label) continue;
        const detail: Record<string, string> = { token: name, unit };
        if (token.fontSize !== undefined) detail.fontSize = String(token.fontSize);
        if (token.lineHeight !== undefined) detail.lineHeight = String(token.lineHeight);
        if (token.fontWeight !== undefined) detail.fontWeight = String(token.fontWeight);
        if (token.fontFamily !== undefined) detail.fontFamily = token.fontFamily;
        out.push({
          kind: "typography",
          bounds: node.bounds,
          label,
          ...(node.label ?? node.role ? { role: node.label ?? node.role } : {}),
          detail,
        });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree.root);
  return out;
}

/** Both layers for one component, in draw order (layout beneath typography). */
export function componentAnnotations(component: CatalogComponent): DesignAnnotation[] {
  const layout = component.redlines
    .map(layoutAnnotation)
    .filter((a): a is DesignAnnotation => a !== undefined);
  return [...layout, ...typographyAnnotations(component.semantics)];
}

/**
 * Both layers for any bounded tree — the shape the two sides of a comparison share.
 *
 * A catalog component arrives with its redlines already walked, so
 * {@link componentAnnotations} reuses them; a design reference carries only the
 * raw tree, so this walks it first. Same extraction either way, which is the
 * point: the reference and actual columns have to be built the same way or
 * comparing them means comparing two different measurements.
 */
export function treeAnnotations(
  tree: SemanticTree | undefined,
  unit: TypeUnit = "sp",
): DesignAnnotation[] {
  const layout = buildRedlines(tree)
    .map(layoutAnnotation)
    .filter((a): a is DesignAnnotation => a !== undefined);
  return [...layout, ...typographyAnnotations(tree, unit)];
}

/**
 * Both layers for a design reference, from the geometry its adapter captured.
 *
 * Empty for a source that captures no geometry — `layout` is optional on
 * {@link DesignReference}, and a reference that is only a raster has nothing to
 * annotate. That is a property of the source, not a failure.
 */
export function referenceAnnotations(
  reference: DesignReference,
  unit: TypeUnit = "px",
): DesignAnnotation[] {
  return treeAnnotations(reference.layout, unit);
}

/**
 * Add reference-side layers to a manifest, keyed by the id the *publisher* uses.
 *
 * The key has to be the serve/catalog reference id, which is minted by whoever
 * writes `references/index.json` — not something this package can derive from a
 * {@link DesignReference}. So callers pass the mapping they already hold rather
 * than having a guess baked in here; a wrong key is invisible at build time and
 * silently draws nothing.
 *
 * References that produced no annotations are skipped, keeping the manifest to
 * entries that will actually draw.
 */
export function withReferenceAnnotations(
  manifest: AnnotationManifest,
  references: Readonly<Record<string, DesignReference>>,
): AnnotationManifest {
  const out: Record<string, DesignAnnotation[]> = { ...manifest.references };
  for (const [referenceId, reference] of Object.entries(references)) {
    const annotations = referenceAnnotations(reference);
    if (annotations.length === 0) continue;
    out[referenceId] = annotations;
  }
  return { ...manifest, references: out };
}

/**
 * Build the manifest for a catalog's components.
 *
 * Keyed by `previewId`, which is what the preview server routes on — a component
 * whose images carry no preview id cannot be addressed by the compare page, so it
 * is skipped rather than keyed by something the server will never look up. A
 * component that produced no annotations is likewise omitted, keeping the
 * manifest to entries that will actually draw.
 *
 * The `references` map is left empty here: reference-side annotations describe a
 * *design tool's* geometry, which this code-led catalog is not the source of.
 * Fill it with {@link withReferenceAnnotations}, which needs the publisher's
 * reference ids.
 */
export function buildAnnotationManifest(
  components: readonly CatalogComponent[],
): AnnotationManifest {
  const previews: Record<string, DesignAnnotation[]> = {};
  for (const component of components) {
    const annotations = componentAnnotations(component);
    if (annotations.length === 0) continue;
    for (const image of component.variants.ideal) {
      // Key on the **sticker id** — what a preview server actually routes on, and what appears in
      // a compare URL (`…/compare/device-populated__ideal__default__compact`).
      //
      // `previewId` is deliberately NOT the primary key. It holds the fully-qualified Compose id
      // (`ee.schimke.…PreviewsKt.SomePreview_Foundation___MeshCore_light`), which the compare page
      // never looks up; keying on it produced a manifest the server silently ignored. It is still
      // emitted as an alias so a consumer holding that id resolves too.
      const sticker = stickerId(component.componentId, "ideal", image);
      // Every ideal variant of a component shares its geometry, so the same layer
      // is correct for each id it renders under (light/dark, locales).
      if (sticker) previews[sticker] = annotations;
      if (image.previewId) previews[image.previewId] = annotations;
    }
  }
  return { schema: ANNOTATION_SCHEMA, previews, references: {} };
}

/** True when a manifest would draw nothing — callers skip writing it entirely. */
export function isEmptyAnnotationManifest(manifest: AnnotationManifest): boolean {
  return (
    Object.keys(manifest.previews).length === 0 && Object.keys(manifest.references).length === 0
  );
}
