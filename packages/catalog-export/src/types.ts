/**
 * The catalog model — a design system rendered into importable design artifacts.
 *
 * A {@link Catalog} is the code → design-tool counterpart of the parity flow: a
 * component system (Compose M3, Wear M3, Glimmer, Glance, …) is rendered by the
 * upstream `compose-preview` CLI, and its data products (captures,
 * `compose/semantics-wireframe`, `compose/theme`, the a11y findings) are folded
 * into a sticker-sheet catalog that exports as a {@link CatalogManifest} + a W3C
 * DTCG token file + a per-component **greenline** (accessibility annotation)
 * layer. Every type here is source-agnostic — it carries normalized
 * {@link DesignTokens}, {@link Image}, {@link SemanticTree}, and {@link Finding}
 * from `@design-parity/core`, so the export is the same whatever rendered it.
 */
import type {
  Bounds,
  DesignTokens,
  FindingKind,
  Image,
  SemanticTree,
  Severity,
} from "@design-parity/core";

/** Provenance for a catalog: which system, library, and renderer produced it. */
export interface CatalogMeta {
  /** Stable system id, kebab-case, e.g. `"compose-m3"`. */
  system: string;
  /** Human title, e.g. `"Compose Material 3"`. */
  title: string;
  /** Library coordinate(s) rendered, e.g. `["androidx.compose.material3:material3"]`. */
  library?: string[];
  /** `compose-preview` CLI version used, for provenance. */
  renderer?: string;
  /** ISO-8601 timestamp the catalog was generated, for provenance. */
  generatedAt?: string;
}

/**
 * The two rendered variants the sticker sheet shows for each component:
 *
 * - `ideal` — the component as shipped (the capture PNGs), one image per
 *   state / theme / size.
 * - `layout` — the same component with every composable bounded, from the
 *   renderer's `compose/semantics-wireframe` product, so a designer sees the
 *   padding / gaps / structure behind the pixels.
 */
export interface ComponentVariants {
  ideal: Image[];
  layout?: Image[];
}

/**
 * One accessibility **greenline**: an annotation anchored (when bounds are
 * known) to a region of the ideal render. Issue greenlines come from the
 * renderer's a11y findings (touch target below minimum, contrast fail, missing
 * label, text overflow); spec greenlines (`info`) annotate interactive nodes
 * with their role and measured size so the sheet documents the a11y contract
 * even when nothing is wrong.
 */
export interface Greenline {
  kind: FindingKind;
  severity: Severity;
  /** One-line, human-readable. */
  message: string;
  /** Region in the ideal render's pixel space, when the finding/node carries one. */
  bounds?: Bounds;
  /** Structured payload (measured size, ratio, role, …) for machine consumers. */
  detail?: Record<string, unknown>;
}

/**
 * A link to the component's published-kit reference frame, for the **one-off
 * seed import** only. The catalog is code-led: this reference exists so the
 * import lines our authoritative render up with the kit's frame (name,
 * position), never to override our values. A divergence is a bug in the kit.
 */
export interface ComponentReference {
  /** Design source the reference frame lives in (usually `"figma"`). */
  source?: string;
  /** Source handle, e.g. `"figma:<fileKey>/<nodeId>"`. */
  ref?: string;
  /** Human URL to the kit / frame. */
  url?: string;
}

/** One component on the sticker sheet, in its primary modes. */
export interface CatalogComponent {
  /** Stable component id, e.g. `"Button/Filled"`. */
  componentId: string;
  /** Human group for sheet layout, e.g. `"Buttons"`. */
  group?: string;
  /** Optional one-line intent / usage note. */
  caption?: string;
  /** Published-kit reference for the seed import (code stays authoritative). */
  reference?: ComponentReference;
  variants: ComponentVariants;
  /** Per-component resolved tokens (the padding / radius / type actually used). */
  tokens?: DesignTokens;
  /** Accessibility annotation layer for this component. */
  greenlines: Greenline[];
  /**
   * The component's semantic tree — bounds, roles, and per-node tokens — so the
   * layout is identified, not just pictured. Optional; absent for hand-authored
   * components that carry only images.
   */
  semantics?: SemanticTree;
}

/** A whole design-system catalog: provenance + token set + components. */
export interface Catalog {
  meta: CatalogMeta;
  /**
   * The design system's resolved token set — the full `colors` palette,
   * `typography` scale, and corner `radius` (shapes) — keyed by code token name
   * (`onSurface`, `bodyLarge`, `medium`). Exported as the catalog's DTCG file.
   */
  themeTokens?: DesignTokens;
  components: CatalogComponent[];
}
