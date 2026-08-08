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
 * Two things the labels must never blur, both of which cost the compare page its
 * comparison when they do:
 *
 * - **Units.** A render resolves `dp`/`sp`; a design board reports its own
 *   pixels. Quoting a 3× board's 52.5px as `52.5sp` invents a threefold
 *   discrepancy (issue #277). A tree that carries a `density` is converted to the
 *   code's units so the two columns can be read against each other; one that does
 *   not has its own unit named and its numbers left alone.
 * - **Provenance.** Spacing a source *declared* is a spec; spacing measured off
 *   child geometry, because the source declared none, is an observation. Derived
 *   phrases are prefixed `≈` and tagged in the detail, so a reference's measured
 *   inset never reads as a number the design file actually asserts.
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
  /**
   * One-line spec as a designer would read it, e.g. `"pad 16dp · gap 8dp"`.
   * A `≈` prefix marks a phrase measured off geometry rather than declared.
   */
  label: string;
  /** Node / slot name, shown as the annotation's title. */
  role?: string;
  /**
   * Structured payload for machine consumers: the same numbers as the label, in
   * the unit `detail.unit` names. When the layer was converted from a design
   * board's pixels, `detail.density` is the factor applied and
   * `detail.sourceUnit` the unit it came from, so the source number is
   * recoverable. `detail.spacingSource` is `"derived"` on a measured redline.
   */
  detail?: Record<string, string>;
}

export interface AnnotationManifest {
  schema: typeof ANNOTATION_SCHEMA;
  /** Keyed by exact compose-preview id — annotations over the *rendered* frame. */
  previews: Record<string, DesignAnnotation[]>;
  /** Keyed by design-reference id — annotations over the *reference* raster. */
  references: Record<string, DesignAnnotation[]>;
}

/**
 * The unit a **spacing** measurement is quoted in — the layout-layer counterpart
 * of {@link TypeUnit}, and paired with it: a source that reports type in its own
 * pixels reports padding in them too.
 */
export type SpaceUnit = "dp" | "px";

/** The spacing unit that goes with a type unit. */
function spaceUnitFor(unit: TypeUnit): SpaceUnit {
  return unit === "px" ? "px" : "dp";
}

/** Trim a measurement to one decimal, without trailing zeros. */
function round(value: number): number {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

/** Render a measurement the way a spec sheet writes it, without trailing zeros. */
function measure(value: number, unit: SpaceUnit): string {
  return `${round(value)}${unit}`;
}

/**
 * How a layer's numbers are to be quoted: the source's own unit, and the density
 * that converts it to the code's.
 *
 * Both columns of a compare page are built by the same walk, so the difference
 * between them is entirely here. The candidate's semantics already resolve
 * `dp`/`sp`; a design board reports its own pixels, and only knows they are
 * `dp`/`sp` if something tells it the board's scale.
 */
interface Quoting {
  space: SpaceUnit;
  type: TypeUnit;
  /** Source pixels per dp, when known and worth applying. */
  density?: number;
  /** The unit the source's own numbers are in, recorded when a conversion applies. */
  sourceSpace?: SpaceUnit;
  sourceType?: TypeUnit;
}

/**
 * Resolve how to quote a tree's numbers.
 *
 * With a usable density the source's pixels are converted, and the layer is
 * quoted in `dp`/`sp` — the code side's units, which is the whole point: it is
 * what lets a reader see that `text 31.5px` and `bodyMedium 14sp` are (or are
 * not) the same type. Without one the source unit is named and left alone
 * (issue #277): an unconverted pixel labelled `px` is checkable, while the same
 * number labelled `sp` is quietly wrong by the density factor.
 *
 * A density of 1 converts nothing, so it is dropped rather than carried into
 * every `detail` as noise.
 */
function quoting(unit: TypeUnit, density: number | undefined): Quoting {
  const usable =
    density !== undefined && Number.isFinite(density) && density > 0 && density !== 1;
  if (!usable) return { space: spaceUnitFor(unit), type: unit };
  return {
    space: "dp",
    type: "sp",
    density,
    sourceSpace: spaceUnitFor(unit),
    sourceType: unit,
  };
}

/** A source measurement in the unit {@link Quoting} says to quote it in. */
function convert(value: number, quote: Quoting): number {
  return quote.density === undefined ? value : value / quote.density;
}

/**
 * Record the conversion on an annotation's `detail`, so a machine consumer can
 * recover the source number instead of having to trust ours.
 */
function stampUnit(detail: Record<string, string>, unit: string, quote: Quoting): void {
  detail.unit = unit;
  if (quote.density === undefined) return;
  detail.density = String(round(quote.density));
  const source = unit === quote.type ? quote.sourceType : quote.sourceSpace;
  if (source) detail.sourceUnit = source;
}

/**
 * Collapse a redline's per-edge padding into the shortest honest phrase.
 *
 * Four equal edges read as one `pad 16dp`; a symmetric box as `pad 12/16dp`
 * (vertical/horizontal, the order a designer says it); anything else is spelled
 * out per edge, because averaging asymmetric padding would state a spec the
 * component does not have.
 */
function paddingPhrase(padding: Redline["padding"], quote: Quoting): string | undefined {
  if (!padding) return undefined;
  const at = (value: number): string => measure(convert(value, quote), quote.space);
  const { top, bottom, start, end } = padding;
  if (top === undefined && bottom === undefined && start === undefined && end === undefined) {
    return undefined;
  }
  if (top !== undefined && bottom !== undefined && start !== undefined && end !== undefined) {
    if (top === bottom && start === end && top === start) return `pad ${at(top)}`;
    if (top === bottom && start === end) return `pad ${at(top)}/${at(start)}`;
  }
  const parts: string[] = [];
  if (top !== undefined) parts.push(`t ${at(top)}`);
  if (end !== undefined) parts.push(`e ${at(end)}`);
  if (bottom !== undefined) parts.push(`b ${at(bottom)}`);
  if (start !== undefined) parts.push(`s ${at(start)}`);
  return `pad ${parts.join(" ")}`;
}

/**
 * The name shown as an annotation's title. A bare numbered box makes the reader
 * map box → number → row with nothing to hold on to, so fall through every
 * handle the source offers: the accessible label, then the developer's test tag,
 * then the role. A node carrying none of them stays untitled — inventing a name
 * for it would be worse than a number.
 */
function titleOf(node: Pick<Redline, "label" | "role" | "testTag">): string | undefined {
  return node.label ?? node.testTag ?? node.role;
}

/**
 * Build the one-line label and structured detail for a layout redline.
 *
 * Derived spacing (measured off child geometry, not declared) is prefixed `≈` on
 * every phrase it covers and tagged `spacingSource` in the detail. The radius is
 * never derived, so it keeps its plain form even on a derived redline — which is
 * the point of marking per phrase rather than per annotation.
 */
function layoutAnnotation(redline: Redline, quote: Quoting): DesignAnnotation | undefined {
  const parts: string[] = [];
  const detail: Record<string, string> = {};
  const derived = redline.spacingSource === "derived";
  const mark = (phrase: string): string => (derived ? `≈${phrase}` : phrase);

  const pad = paddingPhrase(redline.padding, quote);
  if (pad) {
    parts.push(mark(pad));
    for (const [edge, value] of Object.entries(redline.padding ?? {})) {
      if (typeof value === "number") {
        detail[`padding.${edge}`] = String(round(convert(value, quote)));
      }
    }
  }
  if (redline.gap !== undefined) {
    parts.push(mark(`gap ${measure(convert(redline.gap, quote), quote.space)}`));
    detail.gap = String(round(convert(redline.gap, quote)));
  }
  if (redline.cornerRadius !== undefined) {
    parts.push(`r ${measure(convert(redline.cornerRadius, quote), quote.space)}`);
    detail.cornerRadius = String(round(convert(redline.cornerRadius, quote)));
  }

  // A redline with a box but no spacing spec says nothing a reader can act on —
  // the box is already visible in the render. Drop it rather than draw an
  // unlabelled rectangle.
  if (parts.length === 0) return undefined;

  stampUnit(detail, quote.space, quote);
  if (derived) detail.spacingSource = "derived";

  const title = titleOf(redline);
  return {
    kind: "layout",
    bounds: redline.bounds,
    label: parts.join(" · "),
    ...(title ? { role: title } : {}),
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
  quote: Quoting,
): string | undefined {
  if (token.fontSize === undefined) return undefined;
  const size = round(convert(token.fontSize, quote));
  const lineHeight =
    token.lineHeight === undefined ? "" : `/${round(convert(token.lineHeight, quote))}`;
  return `${name} ${size}${quote.type}${lineHeight}`;
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
  quote: Quoting,
): DesignAnnotation[] {
  if (!tree) return [];
  const out: DesignAnnotation[] = [];
  const visit = (node: SemanticNode): void => {
    const styles = node.tokens?.typography;
    if (styles && node.bounds) {
      for (const [name, token] of Object.entries(styles)) {
        const label = typographyLabel(name, token, quote);
        if (!label) continue;
        const detail: Record<string, string> = { token: name };
        stampUnit(detail, quote.type, quote);
        if (token.fontSize !== undefined) {
          detail.fontSize = String(round(convert(token.fontSize, quote)));
        }
        if (token.lineHeight !== undefined) {
          detail.lineHeight = String(round(convert(token.lineHeight, quote)));
        }
        if (token.fontWeight !== undefined) detail.fontWeight = String(token.fontWeight);
        if (token.fontFamily !== undefined) detail.fontFamily = token.fontFamily;
        const title = titleOf(node);
        out.push({
          kind: "typography",
          bounds: node.bounds,
          label,
          ...(title ? { role: title } : {}),
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
  // A rendered catalog is already in the code's own units, so nothing converts.
  const quote = quoting("sp", component.semantics?.density);
  const layout = component.redlines
    .map((redline) => layoutAnnotation(redline, quote))
    .filter((a): a is DesignAnnotation => a !== undefined);
  return [...layout, ...typographyAnnotations(component.semantics, quote)];
}

/**
 * Both layers for any bounded tree — the shape the two sides of a comparison share.
 *
 * A catalog component arrives with its redlines already walked, so
 * {@link componentAnnotations} reuses them; a design reference carries only the
 * raw tree, so this walks it first. Same extraction either way, which is the
 * point: the reference and actual columns have to be built the same way or
 * comparing them means comparing two different measurements.
 *
 * `unit` names the units the tree's own numbers are in. When the tree also
 * carries a {@link SemanticTree.density} they are converted to `dp`/`sp` and the
 * unit given here becomes the recorded `sourceUnit` — that conversion is what
 * makes the two columns of a compare page numerically comparable rather than
 * merely honestly labelled.
 */
export function treeAnnotations(
  tree: SemanticTree | undefined,
  unit: TypeUnit = "sp",
): DesignAnnotation[] {
  const quote = quoting(unit, tree?.density);
  const layout = buildRedlines(tree)
    .map((redline) => layoutAnnotation(redline, quote))
    .filter((a): a is DesignAnnotation => a !== undefined);
  return [...layout, ...typographyAnnotations(tree, quote)];
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
