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
export type DesignSource = "figma" | "stitch" | "claude-design";

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
  /** Repo-relative path or `data:` URI to the PNG. */
  uri: string;
  width: number;
  height: number;
}

/** Typographic token, units are sp/px depending on source. */
export interface TypographyToken {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
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
  bounds?: Bounds;
  /** Tokens resolved at this node (theme-aware). */
  tokens?: DesignTokens;
  children?: SemanticNode[];
}

/** Layout + a11y + theme snapshot for one rendered variant. */
export interface SemanticTree {
  root: SemanticNode;
  theme?: Theme;
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
  linkMethod: LinkMethod;
  /** Raw source handle (Figma node-id, html path, …) kept for trace/debug. */
  ref?: string;
}

/**
 * The candidate: the PR's code, rendered. Produced by the upstream
 * `compose-preview` CLI and parsed by `@design-parity/candidate`.
 */
export interface CandidateRender {
  componentId: string;
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
}

// ---------------------------------------------------------------------------
// Correspondence (code <-> design) — produced by the resolver, Issue 7.
// ---------------------------------------------------------------------------

/** Resolved link between a code component and its design reference. */
export interface Correspondence {
  /** Code handle, e.g. `"ui/Button.kt#PrimaryButton"`. */
  code: string;
  source: DesignSource;
  /** Source-specific reference handle passed to the adapter. */
  ref: string;
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
  | "i18n";

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
}

