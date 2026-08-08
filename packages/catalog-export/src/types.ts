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

/**
 * One **main screen** and the secondary screens/dialogs directly related to it —
 * the unit a per-screen import page is built from. Screen `id` and every
 * `related` entry are `componentId`s that also appear in the flat groups; the
 * screen graph is *additive* metadata that says which of those are top-level
 * screens and how they cluster, so it never changes the flat catalog.
 */
export interface CatalogScreen {
  /** The main screen's `componentId` (must be declared in a group). */
  id: string;
  /** Page title for this screen; defaults to the component's caption/id. */
  title?: string;
  /**
   * `componentId`s of the secondary screens and dialogs shown alongside the main
   * screen (also declared in groups). Ordered as they should appear on the page.
   */
  related?: string[];
}

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
  /**
   * The screen graph — main screens + their related secondaries/dialogs — for a
   * per-screen import. Additive; absent ⇒ the flat catalog with no screen pages.
   */
  screens?: CatalogScreen[];
  /**
   * Optional presentation hints for a viewer/index (e.g. the public preview
   * server's front door). Declared by the system, so "what stage / which hero"
   * lives with the catalog rather than being inferred by each consumer.
   */
  display?: CatalogDisplay;
}

/**
 * How a catalog wants to be *presented* — the surface its stickers are drawn
 * for, and which preview best represents it. Purely advisory: a consumer that
 * doesn't understand these falls back to its own defaults.
 */
export interface CatalogDisplay {
  /**
   * The stage background surface the system's stickers are designed for —
   * `"dark"` for a dark-first platform (Wear OS is black-watch-face-first), so a
   * light-on-transparent sticker isn't shown on a washed-out white stage.
   * Absent ⇒ the consumer's default (light).
   */
  surface?: "light" | "dark";
  /**
   * The representative preview to feature as the system's hero — a `componentId`
   * (e.g. `"Template/TimeText"`) or a flattened preview id. Absent ⇒ the consumer
   * picks one (e.g. prefer a screen, else a canonical component).
   */
  hero?: string;
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
  ideal: CatalogImage[];
  layout?: CatalogImage[];
}

/** A catalog render plus the Compose preview that produced it. */
export interface CatalogImage extends Image {
  /** Fully-qualified compose-preview id; authoritative for design-map upgrades. */
  previewId?: string;
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

/** Per-edge content padding, in dp. */
export interface RedlinePadding {
  start?: number;
  top?: number;
  end?: number;
  bottom?: number;
}

/**
 * One **redline**: a layout annotation for a node — its box plus the spacing
 * spec a designer reads off (content `padding`, inter-child `gap`, corner
 * radius). Where greenlines annotate accessibility, redlines annotate layout.
 */
export interface Redline {
  role?: string;
  label?: string;
  bounds: Bounds;
  padding?: RedlinePadding;
  gap?: number;
  cornerRadius?: number;
}

/** One component on the sticker sheet, in its primary modes. */
export interface CatalogComponent {
  /** Stable component id, e.g. `"Button/Filled"`. */
  componentId: string;
  /**
   * Top-level **section** the component belongs to — the coarse bucket a preview
   * host renders as a tab (e.g. `"Themes"`, `"Components"`, `"Screens"`,
   * `"Animations"`), sitting one level above {@link group}. Additive and
   * open-ended: absent ⇒ the component is untabbed (a flat catalog); a consumer
   * that understands sections tabs the catalog and shows {@link group} as a
   * sub-heading within the tab. Set from the catalog spec's per-group `section`.
   */
  section?: string;
  /** Human group for sheet layout, e.g. `"Buttons"`. */
  group?: string;
  /** Optional one-line intent / usage note. */
  caption?: string;
  /** Published-kit reference for the seed import (code stays authoritative). */
  reference?: ComponentReference;
  /**
   * Handle of the component **family** {@link reference} is one variant of — a Figma component
   * *set*, or whatever the source calls the node owning a component's variants.
   *
   * A plain handle string rather than a {@link ComponentReference}: it shares its source and kit
   * with `reference`, so the only thing left to say is which node. Kept apart from `reference`
   * because the two are read by consumers wanting opposite things — a parity diff needs the one
   * concrete renderable node, while matching a component *instance* found on a whole screen needs
   * the family, since a screen rarely uses the exact variant a catalog pictured.
   */
  referenceSet?: string;
  variants: ComponentVariants;
  /** Per-component resolved tokens (the padding / radius / type actually used). */
  tokens?: DesignTokens;
  /** Accessibility annotation layer for this component. */
  greenlines: Greenline[];
  /**
   * Layout annotation layer — per-node box + padding + inter-slot gap + corner
   * radius (the spacing spec / redlines), walked from {@link semantics}. Empty
   * when the component carries no semantics geometry.
   */
  redlines: Redline[];
  /**
   * The component's semantic tree — bounds, roles, and per-node tokens — so the
   * layout is identified, not just pictured. Optional; absent for hand-authored
   * components that carry only images.
   */
  semantics?: SemanticTree;
  /**
   * The **wireframe SVG** — one bordered box per composable, generated ahead of
   * time from {@link semantics} (see `buildWireframeSvg`). Baked into the bundle
   * so a static catalog carries the schematic even without a daemon-rendered
   * `layout` variant. Absent when there is no box geometry.
   */
  wireframeSvg?: string;
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
