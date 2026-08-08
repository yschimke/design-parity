/**
 * Wire types for the page-backdrop feature.
 *
 * A **page backdrop** is one key screen imported from a design tool as a flat
 * background image, plus the rectangles of every component instance sitting on
 * it, each linked back to the code component that implements it. It is the
 * whole-screen counterpart to the per-component parity run: instead of "does
 * this Button match its Figma node?", it answers "here is the Settings screen —
 * which of its parts do we implement, where, and do our renders sit right on
 * top of the design?".
 *
 * Everything here is committed JSON. The importer writes it once (opt-in, by
 * hand); the viewer and any downstream consumer only read it, so nothing in
 * this package needs a live design-tool call at review time.
 */

/** Schema version of {@link PageBackdropManifest}. Bump on a breaking change. */
export const PAGE_BACKDROP_VERSION = 1;

/**
 * An axis-aligned rectangle in the page's own **frame-local design units**
 * (Figma dp), with the frame's top-left as the origin.
 *
 * Deliberately *not* image pixels: the backdrop PNG is exported at some
 * `scale`, and pinning placements to the unscaled frame means a re-export at a
 * different resolution doesn't invalidate the manifest. Consumers position by
 * ratio (`x / frame.width`), so no density arithmetic is needed.
 */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a placement was linked to a code component. */
export type PlacementLink =
  /** Figma Code Connect — the machine link, highest confidence. */
  | "code-connect"
  /** An explicit entry in the repo's `design-map.json`. */
  | "manifest"
  /** Best-effort name match; always low confidence. */
  | "convention"
  /** Nothing matched — the instance is on the page but not implemented (or not mapped). */
  | "unlinked";

/** One component instance found on a page, and the code it maps to. */
export interface Placement {
  /** Figma node id of the *instance* on the page, e.g. `"12:34"`. */
  nodeId: string;
  /** The instance's layer name, e.g. `"Button/Primary"`. */
  name: string;
  /**
   * Node id of the instance's main component, when the source reports one.
   * This — not {@link nodeId} — is what Code Connect links against.
   */
  componentId?: string;
  /**
   * Node id of the main component's *set*, when the component is one variant of
   * a set. Code Connect commonly links the set rather than a single variant, so
   * it is tried first.
   */
  componentSetId?: string;
  /** Where the instance sits, in frame-local design units. */
  bounds: PageRect;
  /**
   * Nesting depth below the page frame, `0` for a top-level instance. Only ever
   * greater than `0` when the import ran with `nested: true`.
   */
  depth: number;
  /**
   * The instance's own design ref, `"figma:<fileKey>/<nodeId>"`. **Always
   * present**, linked or not: a consumer needs to be able to deep-link a hotspot
   * back into the design tool even for a part of the screen no code implements —
   * which is precisely the case worth clicking through on.
   */
  ref: string;
  /** Code handle, e.g. `"ui/Button.kt#PrimaryButton"`. Absent when unlinked. */
  code?: string;
  /**
   * Fully-qualified preview id of the code component, when the repo's
   * `design-map.json` names one.
   *
   * Present so a consumer can render the component itself without re-deriving
   * the mapping. A preview server keys everything on `previewId`; without it
   * here, the server would need the *producer's* inputs (`design-map.json`) to
   * turn a code handle into something renderable — which would defeat the point
   * of the manifest being self-contained.
   */
  previewId?: string;
  /** How {@link code} was resolved. */
  link: PlacementLink;
  /**
   * How much to trust {@link code}. Stated rather than implied by
   * {@link link}, so a consumer styling low-confidence links doesn't have to
   * hardcode which methods count as weak. Absent when unlinked.
   *
   * `code-connect` and `manifest` are `high` — a human or a machine link said
   * so. `convention` is always `low`: it is a name that happened to match.
   */
  confidence?: "high" | "low";
  /**
   * Design ref the link matched on (`"figma:<fileKey>/<nodeId>"`), so a reader
   * can tell whether the set, the component, or the instance carried the link.
   */
  matchedRef?: string;
}

/** The exported backdrop image for a page. */
export interface BackdropImage {
  /** Path to the PNG, relative to the manifest file. */
  uri: string;
  /** Export scale the PNG was rendered at (`2` → the PNG is 2× `frame`). */
  scale: number;
}

/** One imported key page. */
export interface BackdropPage {
  /** Stable slug derived from the page name, e.g. `"settings"`. */
  id: string;
  /** The frame's layer name in the design file, e.g. `"Settings"`. */
  name: string;
  /** Figma node id of the page frame. */
  nodeId: string;
  /** The frame's size in design units — the coordinate space of every {@link Placement.bounds}. */
  frame: { width: number; height: number };
  image: BackdropImage;
  /** Component instances on the page, in a deterministic top-left-first order. */
  placements: Placement[];
}

/** The committed output of one import run. */
export interface PageBackdropManifest {
  version: number;
  source: "figma";
  /** The Figma file the pages were imported from. */
  fileKey: string;
  pages: BackdropPage[];
}

/**
 * A candidate render to lay over a placement — the code's own output, keyed by
 * code handle. Supplied by the caller (this package never renders), so the
 * viewer stays decoupled from the `compose-preview` lane.
 */
export interface PlacementRender {
  /** Code handle the render belongs to, matching {@link Placement.code}. */
  code: string;
  /** PNG bytes of the render. */
  png: Uint8Array;
}
