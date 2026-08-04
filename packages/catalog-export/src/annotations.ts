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
import type { SemanticNode, SemanticTree, TypographyToken } from "@design-parity/core";

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

/** `"bodyLarge 16sp/24"` — token name, size, and line height when it is known. */
function typographyLabel(name: string, token: TypographyToken): string | undefined {
  if (token.fontSize === undefined) return undefined;
  const size = Number.isInteger(token.fontSize) ? token.fontSize : Number(token.fontSize.toFixed(1));
  const lineHeight =
    token.lineHeight === undefined
      ? ""
      : `/${Number.isInteger(token.lineHeight) ? token.lineHeight : Number(token.lineHeight.toFixed(1))}`;
  return `${name} ${size}sp${lineHeight}`;
}

/**
 * Walk the semantics tree for nodes that resolved a type style.
 *
 * A node can carry more than one typography token; each becomes its own
 * annotation so the layer stays a flat list of drawable boxes. Nodes without
 * bounds are skipped — there is nowhere to anchor them.
 */
function typographyAnnotations(tree: SemanticTree | undefined): DesignAnnotation[] {
  if (!tree) return [];
  const out: DesignAnnotation[] = [];
  const visit = (node: SemanticNode): void => {
    const styles = node.tokens?.typography;
    if (styles && node.bounds) {
      for (const [name, token] of Object.entries(styles)) {
        const label = typographyLabel(name, token);
        if (!label) continue;
        const detail: Record<string, string> = { token: name };
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
 * They are filled in by the adapter that owns the reference.
 */
export function buildAnnotationManifest(
  components: readonly CatalogComponent[],
): AnnotationManifest {
  const previews: Record<string, DesignAnnotation[]> = {};
  for (const component of components) {
    const annotations = componentAnnotations(component);
    if (annotations.length === 0) continue;
    for (const image of component.variants.ideal) {
      if (!image.previewId) continue;
      // Every ideal variant of a component shares its geometry, so the same layer
      // is correct for each preview id it renders under (light/dark, locales).
      previews[image.previewId] = annotations;
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
