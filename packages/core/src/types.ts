/**
 * Core contracts for design-parity.
 *
 * Every reference source (Figma, Stitch, Claude Design) normalizes into a
 * {@link DesignReference}; the candidate side (the rendered PR code) is a
 * {@link CandidateRender}. The diff engine consumes the pair and emits a
 * {@link Verdict}. These types are the only thing downstream packages share,
 * so keep them source-agnostic.
 */

/** A design source the bot knows how to resolve a reference from. */
export type DesignSource = "figma" | "stitch" | "claude-design" | "bundle";

/**
 * How a code component was linked to its design reference.
 *
 * - `code-connect`: machine link via Figma Code Connect (highest confidence).
 * - `manifest`: explicit entry in the repo's `design-map.json`.
 * - `convention`: best-effort name match; always low confidence.
 */
export type LinkMethod = "code-connect" | "manifest" | "convention";

/** UI theme an image or semantic tree was captured under. */
export type Theme = "light" | "dark";

/** A single rasterized image variant of a component. */
export interface Image {
  /**
   * Variant state, e.g. `"default"`, `"pressed"`, `"disabled"`. Pairs with
   * `theme`/`size` to key a candidate image against its reference.
   */
  state: string;
  theme?: Theme;
  /** Logical breakpoint label, e.g. `"compact"`, `"medium"`, `"expanded"`. */
  size?: string;
  /**
   * Extra named variant axes beyond `state`/`theme`/`size` — e.g.
   * `{ content: "icon+label" }` or `{ density: "compact" }`. Each becomes a
   * variant property on the Figma component set, so a component can vary along
   * axes the fixed fields don't name. Absent for the plain default render.
   */
  props?: Record<string, string>;
  /** Repo-relative path or `data:` URI to the PNG. */
  uri: string;
  width: number;
  height: number;
}

/**
 * Kind of a {@link ReferenceProperty}, in source-agnostic terms.
 *
 * - `variant`: an enumerated axis the source names in the variant itself
 *   (Figma `Size=Small`); its value is visible in the reference's own name.
 * - `boolean`: an on/off knob (Figma `Show icon`).
 * - `text`: an author-supplied string (a label override).
 * - `instance-swap`: which sub-component is nested (a leading icon).
 *
 * Only `variant` is self-describing. The other three are the silent ones: they
 * change what the reference *depicts* without appearing anywhere in its name.
 */
export type ReferencePropertyType =
  | "variant"
  | "boolean"
  | "text"
  | "instance-swap";

/**
 * One property the source exposes on the component behind a reference, with the
 * value the reference render actually used.
 *
 * A rendered reference is not the component — it is the component at one point
 * in its property space, and the source picks that point from its own defaults
 * when nobody says otherwise. A kit whose `Button` defaults `Show icon` to
 * `true` renders an icon+label reference for a variant whose name says only
 * `Type=Round, Size=Small`; diffing label-only code against it reports a
 * missing icon as though the code were wrong.
 *
 * Recording what the render depicted makes that diagnosable rather than silent,
 * and gives the diff enough to tell a *pairing* problem (this reference is not
 * of the same thing) from a divergence (it is, and they differ).
 */
export interface ReferenceProperty {
  /** Property name as the source publishes it (`"Show icon"`, `"Size"`). */
  name: string;
  type: ReferencePropertyType;
  /**
   * The value the reference render used, stringified (`"true"`, `"Small"`).
   * For a `variant` axis this is read off the reference itself; for the rest it
   * is the source's default, since that is what an unparameterised render gets.
   */
  value: string;
  /** Values the source enumerates for this property, when it enumerates any. */
  options?: string[];
}

/** Typographic token, units are sp/px depending on source. */
export interface TypographyToken {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  /** `"normal"` / `"italic"` (compose-ai-tools#1934). */
  fontStyle?: string;
  /**
   * The variable-font axes actually applied, as `"<axis> <value>"` pairs sorted
   * by tag (e.g. `"opsz 18.0, wght 700.0"`). For a variable font these pin the
   * rendered instance where `fontWeight` alone can't (compose-ai-tools#1934).
   */
  fontVariationSettings?: string;
  /** OpenType feature settings (compose-ai-tools#1934). */
  fontFeatureSettings?: string;
  lineHeight?: number;
  letterSpacing?: number;
}

/**
 * Design tokens extracted from a source or a candidate render. All maps are
 * optional and partial — a source only provides what it exposes.
 */
export interface DesignTokens {
  /** Spacing scale, dp/px keyed by token name (e.g. `"padding"`). */
  spacing?: Record<string, number>;
  /** Colors as CSS hex/rgba strings keyed by token name. */
  colors?: Record<string, string>;
  /** Corner radii, dp/px keyed by token name. */
  radius?: Record<string, number>;
  typography?: Record<string, TypographyToken>;
}

/** Axis-aligned bounding box in the image's pixel space. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node in a normalized semantic/accessibility tree. */
export interface SemanticNode {
  /** Accessibility role / semantic kind, e.g. `"button"`, `"text"`. */
  role?: string;
  /** Accessible label / visible text. */
  label?: string;
  /**
   * The developer-authored test handle (`Modifier.testTag`), when the source
   * carries one. Deliberately **not** folded into {@link label}: a11y checks read
   * `label` as the accessible name, and a test tag is not one — a node named only
   * by its tag is still missing its label, and merging the two would silently
   * pass that check. It is a name a *reader* can use though, so an annotation
   * viewer falls back to it before showing a bare numbered box.
   */
  testTag?: string;
  bounds?: Bounds;
  /** Tokens resolved at this node (theme-aware). */
  tokens?: DesignTokens;
  /**
   * Where this node's `tokens.spacing` came from. `"declared"` — the default and
   * the historical meaning — is a spec read off the source: a Compose `padding` /
   * `Arrangement.spacedBy` modifier, a Figma auto-layout frame. `"derived"` is
   * *measured* from child geometry because the source declared nothing, so it
   * describes what the artwork does rather than what its author specified.
   *
   * The distinction is the point: a derived number is honest about being an
   * observation, and consumers mark it as such rather than quoting it as a spec.
   */
  spacingSource?: "declared" | "derived";
  children?: SemanticNode[];
}

/** Layout + a11y + theme snapshot for one rendered variant. */
export interface SemanticTree {
  root: SemanticNode;
  theme?: Theme;
  /**
   * The resolved design-system tokens this render was themed with — the full
   * palette (colors), `typography`, and corner `radius` (shapes), keyed by their
   * code token name (`onBackground`, `bodyLarge`, `medium`). Populated when a
   * source exposes its theme (e.g. the daemon's `compose/theme`); lets a UX-spec
   * review see the design system behind a screen, not just per-node values.
   */
  themeTokens?: DesignTokens;
  /**
   * Source pixels per density-independent pixel for the values in this tree's
   * `tokens` — the scale factor that turns them into `dp`/`sp`.
   *
   * A candidate's semantics already resolve `dp`/`sp`, so it is absent there
   * (equivalently 1). A design tool reports its board's own pixels: a 3× board
   * draws 17sp type at 51px and a 16dp gutter at 48px, and quoting either
   * number against the code side invents a threefold discrepancy. Carrying the
   * factor is what lets a consumer state both columns in the same unit; absent,
   * a consumer must quote the source unit rather than guess (issue #277).
   *
   * Note this scales `tokens` only. `bounds` are anchors in whatever pixel space
   * the annotated image is in, and a publisher rescales them to the raster it
   * draws over without touching the specs those boxes describe.
   */
  density?: number;
}

/**
 * A design reference, normalized from any source. This is the contract every
 * {@link ReferenceAdapter} produces.
 */
export interface DesignReference {
  /** Stable handle matched against code (see {@link Correspondence.code}). */
  componentId: string;
  source: DesignSource;
  /** One image per state / theme / size the source exposes. */
  referenceImages: Image[];
  tokens?: DesignTokens;
  /**
   * The resolved design-system tokens the source exposes — the full palette
   * behind the reference (e.g. the Figma Variables table), keyed by design token
   * name; colours may carry a `<name>.<mode>` mode suffix. Mirrors
   * {@link SemanticTree.themeTokens} on the candidate side and feeds the
   * design-system audit (whole-table parity, once per run) rather than the
   * per-node token diff. Absent for sources that expose no system table.
   */
  themeTokens?: DesignTokens;
  linkMethod: LinkMethod;
  /**
   * The component properties the reference was rendered with — what it
   * **depicts**, as opposed to what its name says (see {@link ReferenceProperty}).
   *
   * Read by the report, so a reviewer can see that a reference carries an icon
   * the variant name never mentions, and by the diff, which treats a candidate
   * contradicting one of these as *unpairable* rather than divergent. Absent for
   * sources with no component-property concept, or when the source exposes none
   * for this node.
   */
  properties?: ReferenceProperty[];
  /**
   * Layout geometry captured from the reference's own render — a tree of
   * labelled, bounded elements (positions/sizes in dp). Lets the structural
   * layout diff compare element placement against the candidate's semantics,
   * element by element. Absent for sources that don't capture geometry.
   */
  layout?: SemanticTree;
  /** Raw source handle (Figma node-id, html path, …) kept for trace/debug. */
  ref?: string;
}

/**
 * The candidate: the PR's code, rendered. Produced by the upstream
 * `compose-preview` CLI and parsed by `@design-parity/candidate`.
 */
export interface CandidateRender {
  /**
   * The handle the orchestrator pairs on — a code handle
   * (`"ui/Button.kt#PrimaryButton"`) once reconciled, so it lines up with a
   * {@link DesignReference}. A source that can't reconcile leaves its native id
   * here (and the pair simply won't match).
   */
  componentId: string;
  /**
   * The raw compose-ai-tools preview id (`"a.b.C.fn"`), when the candidate came
   * from a preview bundle / daemon. Kept alongside {@link componentId} so the
   * two namespaces stay reconcilable (issue #44); absent for sources with no
   * preview id (e.g. a hand-authored `CandidateRender`).
   */
  previewId?: string;
  /**
   * The `@Preview` **function name** (`"FilledButton"`), when the candidate came
   * from a preview bundle / daemon — the stable identity shared by a function's
   * theme/size multipreview variants, whose {@link previewId}s differ only by an
   * appended `_<mode>` suffix. Catalog assembly keys on this to fold those
   * variants into one component; absent for hand-authored candidates.
   */
  functionName?: string;
  images: Image[];
  semantics: SemanticTree;
}

/** Runtime context handed to an adapter so it can resolve files and secrets. */
export interface AdapterContext {
  /** Absolute path to the consumer repo root; manifest/html paths resolve here. */
  repoRoot: string;
  /** Process environment (PATs, OAuth tokens) — adapters read what they need. */
  env: Record<string, string | undefined>;
}

/** One variant axis, moved: `{ axis: "Size", value: "Medium" }`. */
export interface SiblingTarget {
  /** Axis name as the source spells it; adapters match case-insensitively. */
  axis: string;
  /** The value to move that axis to. */
  value: string;
}

/**
 * One driver per design source. Implementations normalize their source into a
 * {@link DesignReference}; the diff engine never sees source specifics.
 */
export interface ReferenceAdapter {
  readonly source: DesignSource;
  /**
   * Resolve and normalize a reference for `componentId`. `ref` is the
   * source-specific handle (Figma node-id, manifest `ref`, html path).
   *
   * @throws if auth fails, the ref is missing, or the source is unreachable.
   */
  resolve(
    componentId: string,
    ref: string,
    ctx: AdapterContext,
  ): Promise<DesignReference>;
  /**
   * Optional: warm whatever `resolve` will ask for, given every ref the run
   * will use.
   *
   * A run resolves its correspondences one after another, so an adapter cannot
   * coalesce requests on its own — each `resolve` has finished before the next
   * begins, and there is nothing to batch with. This hook is where an adapter
   * gets to see the whole list at once and fetch it in as few requests as its
   * API allows.
   *
   * Best-effort by contract: a failure here must not fail the run, because
   * everything it warms `resolve` can still fetch alone. Adapters that gain
   * nothing from batching simply omit it.
   */
  prefetch?(refs: readonly string[], ctx: AdapterContext): Promise<void>;
  /**
   * Optional: the handle for **the same component with one variant axis moved**
   * — `Size=Small` → `Size=Medium`.
   *
   * A source whose components vary along named axes can answer this
   * mechanically (a Figma component set's variant names *are* axis vectors), and
   * every consumer comparing more than one default state needs it, so it belongs
   * on the adapter rather than in each consumer's own taxonomy. Sources with no
   * variant concept omit it.
   *
   * Must return `undefined` — not a guess — whenever the translation cannot be
   * made: the ref is not this source's, the node has no axes, the axis is not
   * one this component has, or nothing carries that value. A confident reference
   * to the wrong node is worse than no reference, because the diff that follows
   * looks authoritative.
   */
  resolveSibling?(
    ref: string,
    target: SiblingTarget,
    ctx: AdapterContext,
  ): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Correspondence (code <-> design) — produced by the resolver, Issue 7.
// ---------------------------------------------------------------------------

/**
 * One design reference handle tagged with the variant slot it fills. Lets a
 * single code component bind several design nodes — a screen's states, themes,
 * or breakpoints living in separate frames (issue: multi-node references). The
 * tags key the resolved image against its candidate counterpart in `pairImages`.
 */
export interface RefVariant {
  /** Source-specific reference handle (e.g. `figma:<fileKey>/<nodeId>`). */
  ref: string;
  /** Variant state this node represents, e.g. `"default"`, `"error"`. */
  state?: string;
  theme?: Theme;
  /** Breakpoint label, e.g. `"compact"`. */
  size?: string;
}

/**
 * One candidate preview id tagged with the variant slot it fills — the
 * candidate-side mirror of {@link RefVariant} (design-parity issue #111). Lets a
 * single code component bind several candidate previews when each theme/state/
 * size is authored as its own `@Preview` (e.g. `FooPreview` + `FooDarkPreview`),
 * rather than one multi-capture preview. The tags re-tag the resolved preview's
 * image(s) onto this slot, keying them against the matching reference variant in
 * `pairImages` so the report's theme matrix fills every column for one component.
 */
export interface PreviewIdVariant {
  /** compose-ai-tools preview id, e.g. `"ee.app.FooKt.FooDarkPreview"`. */
  previewId: string;
  /** Variant state this preview represents, e.g. `"default"`, `"error"`. */
  state?: string;
  theme?: Theme;
  /** Breakpoint label, e.g. `"compact"`. */
  size?: string;
}

/** Resolved link between a code component and its design reference. */
export interface Correspondence {
  /** Code handle, e.g. `"ui/Button.kt#PrimaryButton"`. */
  code: string;
  source: DesignSource;
  /** Primary source-specific reference handle (the first/structure node). */
  ref: string;
  /**
   * Present when the manifest bound several variant-tagged nodes to this
   * component. Includes the primary `ref`; the orchestrator resolves each and
   * merges them into one {@link DesignReference}. Absent for single-ref links
   * (Code Connect, convention, a string manifest `ref`).
   */
  refs?: RefVariant[];
  linkMethod: LinkMethod;
  /** `convention` links are always `"low"`; explicit links are `"high"`. */
  confidence: "high" | "low";
}

// ---------------------------------------------------------------------------
// Verdict (diff output) — produced by the diff engine, Issue 6.
// ---------------------------------------------------------------------------

export type VerdictStatus = "pass" | "warn" | "fail";

/**
 * A single dimension a finding can be about.
 *
 * - `visual`: perceptual pixel diff (candidate vs reference image).
 * - `token`: a design-token value drift (spacing, radius, typography, …).
 * - `semantic`: structural / accessibility-tree drift vs the reference.
 * - `contrast`: a WCAG text/non-text contrast result (its own kind because it
 *   is the headline a11y finding and carries a numeric ratio).
 * - `a11y`: an accessibility defect with no reference counterpart — touch-target
 *   size, missing role/label/content-description, focus/announcement gaps.
 * - `i18n`: an internationalization risk — text expansion & truncation, RTL
 *   mirroring, hardcoded locale-specific formatting, un-keyed strings.
 * - `pairing`: the reference and the candidate are not comparable — they depict
 *   different points in the component's property space (see
 *   {@link ReferenceProperty}), so any diff between them would describe the
 *   wrong thing. Deliberately not a divergence: the fix is a better reference,
 *   never a change to correct code.
 *
 * `contrast`, `a11y`, and `i18n` are the spec-backed findings the verdict leads
 * with (docs/PRINCIPLES.md Principle 2); they are produced by
 * `@design-parity/checks`.
 */
export type FindingKind =
  | "visual"
  | "semantic"
  | "token"
  | "contrast"
  | "a11y"
  | "i18n"
  | "layout"
  | "pairing";

export type Severity = "info" | "warn" | "error";

/** One observation from the diff engine. */
export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** Human-readable, one line. */
  message: string;
  /** Structured payload (expected/actual, deltas) for machine consumers. */
  detail?: Record<string, unknown>;
}

/** The machine verdict for one component's parity check. */
export interface Verdict {
  componentId: string;
  status: VerdictStatus;
  findings: Finding[];
  /** Per-image perceptual diff score (0 = identical) keyed by image state. */
  visualScores?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Parity direction — who is canonical when design and code disagree.
// ---------------------------------------------------------------------------

/**
 * Which side is authoritative.
 *
 * - `design-led`: the design is the contract; a violation **blocks** the PR
 *   and the fix is in code (never push code back to the design).
 * - `code-led`: the shipped code is reality; violations are **advisory** and
 *   drift can be pushed back to the design tool (see Code-to-Canvas).
 * - `auto`: a transitional default. Setup/bootstrap detects the maturity rung
 *   and **writes a concrete direction** into the committed config, so steady
 *   state normally never sees `auto`. If a repo wires up the Action without
 *   running setup, the resolver maps `auto` to a concrete value deterministically
 *   (`design-led` with a machine link, else `code-led`) — same result, just
 *   resolved late instead of materialized.
 */
export type ParityDirection = "auto" | "design-led" | "code-led";

/** What `auto` is materialized/resolved into. */
export type ResolvedDirection = "design-led" | "code-led";

// ---------------------------------------------------------------------------
// Code-to-Canvas push-back (issue #9) — the code-led, Figma-only stretch.
// ---------------------------------------------------------------------------

/**
 * One candidate render to push back into the design tool so the design file
 * reflects what shipped. Only produced in `code-led` mode for `figma` sources
 * (see docs/PRINCIPLES.md, Principle 5).
 */
export interface CanvasTarget {
  /** Code handle of the component being pushed back (trace/debug). */
  componentId: string;
  /** The design source to write into — only `figma` is supported today. */
  source: DesignSource;
  /** Source-specific handle of the node to update (e.g. `figma:<key>/<node>`). */
  ref: string;
  /** The candidate render image (the shipped pixels) to place on the canvas. */
  image: Image;
}

/** Outcome of writing one {@link CanvasTarget} back to the design tool. */
export interface CanvasWriteResult {
  /** A URL/handle to the written or updated node, when the writer exposes one. */
  url?: string;
  /** Human-readable detail for the log (e.g. which node was updated). */
  detail?: string;
}

/**
 * Writes a candidate render back into the design tool (Code-to-Canvas).
 *
 * The transport is intentionally abstract. The Figma **REST** API is read-only,
 * so a real writer drives a companion Figma plugin / Dev Mode bridge — not the
 * public REST API the {@link ReferenceAdapter} reads from. Keeping this a thin
 * contract lets the Action gate and orchestrate push-back without coupling to
 * any one transport, and lets tests inject a fake.
 */
export interface CanvasWriter {
  /** The source this writer targets; push-back only runs for matching results. */
  readonly source: DesignSource;
  /**
   * Write one candidate image back to the design tool.
   *
   * @throws if the write fails (auth, missing endpoint, unreachable bridge).
   *   The Action treats a throw as fail-soft per component.
   */
  write(target: CanvasTarget, ctx: AdapterContext): Promise<CanvasWriteResult>;
}

/**
 * Where a repo sits on the maturity ladder (docs/PRINCIPLES.md, Principle 3).
 * Detected by setup/bootstrap (issue #11); the only input `auto` direction
 * resolution needs.
 *
 * - `machine-link`: design system with a machine-resolvable link
 *   (Figma + Code Connect) — rung 1.
 * - `manifest`: design system linked only via `design-map.json` — rung 2.
 * - `bootstrap`: no design system; bootstrapped to an opinionated baseline —
 *   rung 3.
 */
export type MaturityRung = "machine-link" | "manifest" | "bootstrap";

/**
 * Committed, per-repo parity policy. Read deterministically by the bot — never
 * decided at run time (see docs/PRINCIPLES.md, Principle 1). Setup writes a
 * concrete {@link ResolvedDirection}; `auto` is only the pre-setup default.
 */
export interface ParityConfig {
  /** Defaults to `"auto"` until setup materializes a concrete direction. */
  direction: ParityDirection;
  /**
   * Whether the repo is Compose Multiplatform capable (docs/PRINCIPLES.md,
   * Principle 6). Recorded by setup/bootstrap from its deterministic CMP scan so
   * the unattended Action can promote CMP to Android-only repos *without
   * re-deriving it on every run* (Principle 1) — the Action only reads this
   * committed flag, it never re-scans. `false` ⇒ Android-only, so the PR comment
   * carries a non-blocking "could run parity faster on CMP" suggestion; `true` ⇒
   * already CMP, nothing to promote; omitted ⇒ setup hasn't recorded it (an
   * older or hand-written config), so the Action stays silent rather than guess.
   * Advisory only — never a gate.
   */
  cmpCapable?: boolean;
}

