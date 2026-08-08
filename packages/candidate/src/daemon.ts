/**
 * The compose-ai-tools **daemon** candidate source (issue #43, Phase 2 of #38).
 *
 * Unlike the static bundle reader, this path talks to a **live** compose-ai-tools
 * renderer (the session daemon) and uses its **native** accessibility / i18n
 * findings rather than re-deriving them. The maintainer's decision (issue #43):
 * on the daemon path design-parity ingests the renderer's own
 * `a11y/atf`, `a11y/touchTargets`, `text/strings`, and `i18n/translations`
 * data products as `Finding[]`, and builds the {@link SemanticTree} (for the
 * parity token/visual/semantic diff) from `a11y/hierarchy`. design-parity's own
 * `@design-parity/checks` stays the path for sources with no native findings
 * (static bundle, figma, stitch, claude-design) — superseded here, not removed.
 *
 * The transport is the {@link DaemonDataClient} seam: production drives the
 * JSON-RPC-over-stdio protocol (`docs/daemon/PROTOCOL.md` in compose-ai-tools,
 * via e.g. `compose-preview bundle daemon <bundle>`); tests inject a fake. This
 * module is otherwise **pure mappers** over the documented data-product shapes,
 * so the contract is unit-testable against captured/mocked payloads with no live
 * daemon (issue #43 acceptance). It depends only on `@design-parity/core`.
 *
 * Data-product shapes consumed (the subset this reader depends on, parsed
 * defensively so additive producer changes don't break it) are documented in
 * compose-ai-tools `docs/daemon/DATA-PRODUCTS.md`.
 */
import type {
  Bounds,
  CandidateRender,
  DesignTokens,
  Finding,
  Image,
  SemanticNode,
  SemanticTree,
  Severity,
  Theme,
  TypographyToken,
} from "@design-parity/core";

import type { CandidateSource } from "./source.js";

// ---------------------------------------------------------------------------
// Consumed data-product payload shapes (defensive subset).
// ---------------------------------------------------------------------------

/** `a11y/atf` — Accessibility Test Framework findings (incl. contrast). */
export interface AtfFinding {
  /** ATF severity: typically `"ERROR"` | `"WARNING"` | `"INFO"`. */
  level?: string;
  /** Check class, e.g. `"TextContrastCheck"`, `"TouchTargetSizeCheck"`. */
  type?: string;
  message?: string;
  viewDescription?: string;
  /** `"left,top,right,bottom"` in PNG pixels. */
  boundsInScreen?: string;
}
export interface AtfPayload {
  findings?: AtfFinding[];
}

/** `a11y/touchTargets` — per-node touch-target geometry + findings. */
export interface TouchTarget {
  nodeId?: string;
  boundsInScreen?: string;
  widthDp?: number;
  heightDp?: number;
  /** e.g. `["belowMinimum"]`, `["overlap"]`. */
  findings?: string[];
}
export interface TouchTargetsPayload {
  targets?: TouchTarget[];
}

/** `a11y/hierarchy` — flat accessibility node list (schemaVersion 1). */
export interface HierarchyNode {
  label?: string;
  role?: string | null;
  states?: string[];
  merged?: boolean;
  /** `"left,top,right,bottom"` in PNG pixels. */
  boundsInScreen?: string;
}
export interface HierarchyPayload {
  nodes?: HierarchyNode[];
}

/**
 * `compose/semantics` — the SemanticsNode projection (schemaVersion 2). Unlike
 * the flat `a11y/hierarchy` list this is a **real tree** (`root` + per-node
 * `children`), and each node carries the text style's resolved fg/bg colours
 * (`layout*Color`, as `#AARRGGBB`) and font size, so the {@link SemanticTree}
 * built from it supports tree-side contrast. `ref` is a stable match key (not a
 * parent pointer) — the nesting is structural, so no reassembly is needed.
 */
export interface ComposeSemanticsNode {
  ref?: string;
  /** Stable SemanticsNode id — the join key for `compose/theme.consumers` (#1847). */
  nodeId?: string;
  /** `"left,top,right,bottom"` in PNG pixels (same shape as boundsInScreen). */
  boundsInRoot?: string;
  label?: string;
  text?: string;
  layoutText?: string;
  /** Resolved typographic identity of the drawn text (compose-ai-tools#1934, #1903). */
  typography?: ComposeSemanticsTypography;
  /** Resolved text colours (compose-ai-tools#1903). */
  textColor?: ComposeSemanticsTextColor;
  /** Pre-v6 flat text size, `"22.0sp"` — read as a fallback for older renders. */
  layoutFontSize?: string;
  /** Pre-v6 flat text foreground, `#AARRGGBB` — read as a fallback for older renders. */
  layoutForegroundColor?: string;
  /** Pre-v6 flat text background, `#AARRGGBB` — read as a fallback for older renders. */
  layoutBackgroundColor?: string;
  role?: string | null;
  testTag?: string;
  children?: ComposeSemanticsNode[];
}

/**
 * `compose/semantics` per-node `typography` object (compose-ai-tools#1934, #1903):
 * the resolved size/face/weight/style/axes of the drawn text, read from the node's
 * `TextLayoutResult`. Each field is present only when every drawn range agrees on
 * it. `fontSize` / `letterSpacing` / `lineHeight` are sp/em strings (e.g. `"0.5sp"`);
 * `fontWeight` is a bare number. `fontSize` was the flat `layoutFontSize` before v6.
 */
export interface ComposeSemanticsTypography {
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
  fontVariationSettings?: string;
  fontFeatureSettings?: string;
  letterSpacing?: string;
  lineHeight?: string;
}

/** `compose/semantics` v6 per-node text colours (compose-ai-tools#1903), ARGB `#AARRGGBB`. */
export interface ComposeSemanticsTextColor {
  foreground?: string;
  background?: string;
}
export interface ComposeSemanticsPayload {
  root?: ComposeSemanticsNode;
}

/** `compose/theme` typography token (producer shape, units carried separately). */
export interface ComposeThemeTypography {
  fontFamily?: string;
  fontSize?: number;
  fontSizeUnit?: string;
  /** e.g. `"FontWeight(weight=400)"` or a bare number. */
  fontWeight?: string | number;
  lineHeight?: number;
  lineHeightUnit?: string;
  letterSpacing?: number;
  letterSpacingUnit?: string;
}

/**
 * `compose/theme` — resolved `MaterialTheme.*` values: the `colorScheme`
 * (`#AARRGGBB` keyed by Material role), `typography` (text styles), and
 * `shapes` (`RoundedCornerShape(...)` descriptions). `consumers` ties nodes to
 * the tokens they read, but is empty in the producer's v1 schema — so per-node
 * attribution falls back to reverse-matching a node's resolved colour against
 * the scheme (see {@link semanticsToSemanticTree}).
 */
export interface ComposeThemePayload {
  resolvedTokens?: {
    colorScheme?: Record<string, string>;
    typography?: Record<string, ComposeThemeTypography>;
    shapes?: Record<string, string>;
  };
  consumers?: Array<{ nodeId?: string; tokens?: string[] }>;
}

/** `text/strings` — drawn-text entries with overflow/truncation flags. */
export interface TextStringEntry {
  text?: string;
  locale?: string;
  truncated?: boolean;
  overflow?: boolean;
  didOverflowWidth?: boolean;
  didOverflowHeight?: boolean;
  lineCount?: number;
  maxLines?: number;
  boundsInScreen?: string;
}
export interface TextStringsPayload {
  /** Producers have used both keys; accept either. */
  entries?: TextStringEntry[];
  strings?: TextStringEntry[];
}

/** `i18n/translations` — per-string locale coverage from Android string resources. */
export interface I18nVisibleString {
  text?: string;
  resourceName?: string;
  /** Locales the string is translated into. */
  locales?: string[];
  /** Locales missing a translation (when the producer computes it). */
  missingLocales?: string[];
}
export interface I18nTranslationsPayload {
  strings?: I18nVisibleString[];
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/** Parse a `"left,top,right,bottom"` (px) string into {@link Bounds}. */
export function parseScreenBounds(spec: string | undefined): Bounds | undefined {
  if (!spec) return undefined;
  const parts = spec.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [left, top, right, bottom] = parts as [number, number, number, number];
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Convert a Compose/Android `#AARRGGBB` colour (ARGB, alpha-first — what
 * `Color.toArgb()` formats) into the CSS `#RRGGBBAA` (alpha-last) that
 * `@design-parity/checks` `parseColor` reads. A 6-digit `#RRGGBB` (no alpha)
 * passes through. Returns `undefined` for anything that isn't a hex colour so
 * callers drop it rather than emit a token the contrast check can't parse.
 */
export function argbToCssHex(spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const hex = spec.startsWith("#") ? spec.slice(1) : spec;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    const aa = hex.slice(0, 2);
    const rgb = hex.slice(2, 8);
    return `#${rgb}${aa}`.toLowerCase();
  }
  return undefined;
}

/** Parse a `"22.0sp"` / `"22sp"` text size into its leading number (sp). */
export function parseFontSizeSp(spec: string | undefined): number | undefined {
  if (!spec) return undefined;
  const m = /^-?\d+(?:\.\d+)?/.exec(spec.trim());
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalize a resolved font-family identity to a stable display name so the
 * candidate and the reference read alike. The desktop backend resolves a
 * `FontListFontFamily` to its face *file* (`fonts/SpaceGrotesk.ttf`) and Android
 * to a resource path (`res/font/orbitron`), whereas the HTML reference reports the
 * CSS family name (`Space Grotesk`). Strip directory + extension and split
 * CamelCase / separators so a face path converges on `Space Grotesk`; a clean CSS
 * name (no path, no font extension) passes through untouched. Weight/style live in
 * `fontWeight` / `fontStyle`, so the variable-font file carries no weight suffix to
 * strip here.
 */
export function normalizeFontFamily(raw: string): string {
  let v = raw.trim();
  if (!v) return v;
  // A CSS family list ("Space Grotesk", sans-serif) → first family, unquoted.
  v = (v.split(",")[0] ?? v).trim().replace(/^['"]|['"]$/g, "");
  // Only rewrite path-like / font-file identities; leave clean names alone.
  if (/[\\/]/.test(v) || /\.(ttf|otf|ttc|otc|woff2?|dfont|pfb)$/i.test(v)) {
    v = (v.split(/[\\/]/).pop() ?? v)
      .replace(/\.(ttf|otf|ttc|otc|woff2?|dfont|pfb)$/i, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return v;
}

/**
 * Build a node's text {@link TypographyToken} from the resolved [fontSize] plus the
 * `typography` object (compose-ai-tools#1934, #1903) — the resolved face/weight/
 * style/axes of the drawn text. Lets the token diff compare *which face* the
 * candidate resolved against the reference spec, not just its size. Returns
 * undefined when the node carries nothing typographic.
 */
export function textTypography(
  node: ComposeSemanticsNode,
  fontSize: number | undefined,
): TypographyToken | undefined {
  const typo = node.typography;
  const out: TypographyToken = {};
  if (fontSize !== undefined) out.fontSize = fontSize;
  if (typo?.fontFamily) out.fontFamily = normalizeFontFamily(typo.fontFamily);
  if (typo?.fontWeight !== undefined) out.fontWeight = typo.fontWeight;
  if (typo?.fontStyle) out.fontStyle = typo.fontStyle;
  if (typo?.fontVariationSettings) out.fontVariationSettings = typo.fontVariationSettings;
  if (typo?.fontFeatureSettings) out.fontFeatureSettings = typo.fontFeatureSettings;
  const letterSpacing = parseFontSizeSp(typo?.letterSpacing);
  if (letterSpacing !== undefined) out.letterSpacing = letterSpacing;
  const lineHeight = parseFontSizeSp(typo?.lineHeight);
  if (lineHeight !== undefined) out.lineHeight = lineHeight;
  return Object.keys(out).length ? out : undefined;
}

/** Map an ATF `level` to a finding {@link Severity}. */
function atfSeverity(level: string | undefined): Severity {
  switch ((level ?? "").toUpperCase()) {
    case "ERROR":
      return "error";
    case "WARNING":
      return "warn";
    default:
      return "info";
  }
}

/** Contrast checks lead the verdict with their own kind; everything else is a11y. */
function isContrastCheck(type: string | undefined): boolean {
  return /contrast/i.test(type ?? "");
}

// ---------------------------------------------------------------------------
// Native-finding mappers (pure).
// ---------------------------------------------------------------------------

/** `a11y/atf` → `contrast` / `a11y` findings. */
export function atfFindings(payload: AtfPayload | undefined): Finding[] {
  const out: Finding[] = [];
  for (const f of payload?.findings ?? []) {
    const kind = isContrastCheck(f.type) ? "contrast" : "a11y";
    const subject = f.viewDescription ? ` (${f.viewDescription})` : "";
    const detail: Record<string, unknown> = {};
    if (f.type) detail["check"] = f.type;
    if (f.viewDescription) detail["view"] = f.viewDescription;
    const bounds = parseScreenBounds(f.boundsInScreen);
    if (bounds) detail["bounds"] = bounds;
    out.push({
      kind,
      severity: atfSeverity(f.level),
      message: `${f.message ?? f.type ?? "accessibility finding"}${subject}`,
      detail,
    });
  }
  return out;
}

/** `a11y/touchTargets` → `a11y` findings (below-minimum / overlap). */
export function touchTargetFindings(
  payload: TouchTargetsPayload | undefined,
): Finding[] {
  const out: Finding[] = [];
  for (const t of payload?.targets ?? []) {
    if (!t.findings || t.findings.length === 0) continue;
    const size =
      t.widthDp !== undefined && t.heightDp !== undefined
        ? `${t.widthDp}×${t.heightDp}dp `
        : "";
    const below = t.findings.includes("belowMinimum");
    const detail: Record<string, unknown> = { findings: t.findings };
    if (t.nodeId) detail["nodeId"] = t.nodeId;
    if (t.widthDp !== undefined) detail["widthDp"] = t.widthDp;
    if (t.heightDp !== undefined) detail["heightDp"] = t.heightDp;
    const bounds = parseScreenBounds(t.boundsInScreen);
    if (bounds) detail["bounds"] = bounds;
    out.push({
      kind: "a11y",
      severity: below ? "error" : "warn",
      message: `Touch target ${size}${t.findings.join(", ")}`,
      detail,
    });
  }
  return out;
}

/** `text/strings` → `i18n` findings for truncated / overflowing text. */
export function textStringFindings(
  payload: TextStringsPayload | undefined,
): Finding[] {
  const entries = payload?.entries ?? payload?.strings ?? [];
  const out: Finding[] = [];
  for (const e of entries) {
    const overflowed =
      e.truncated === true ||
      e.overflow === true ||
      e.didOverflowWidth === true ||
      e.didOverflowHeight === true;
    if (!overflowed) continue;
    const label = e.text ? `"${e.text}"` : "text";
    const detail: Record<string, unknown> = {};
    for (const k of [
      "truncated",
      "overflow",
      "didOverflowWidth",
      "didOverflowHeight",
      "lineCount",
      "maxLines",
      "locale",
    ] as const) {
      if (e[k] !== undefined) detail[k] = e[k];
    }
    out.push({
      kind: "i18n",
      severity: "warn",
      message: `${label} is truncated/overflowing — at risk under text expansion`,
      detail,
    });
  }
  return out;
}

/** `i18n/translations` → `i18n` findings for strings missing locale coverage. */
export function translationFindings(
  payload: I18nTranslationsPayload | undefined,
): Finding[] {
  const out: Finding[] = [];
  for (const s of payload?.strings ?? []) {
    const missing = s.missingLocales ?? [];
    if (missing.length === 0) continue;
    const label = s.resourceName ?? (s.text ? `"${s.text}"` : "string");
    out.push({
      kind: "i18n",
      severity: "warn",
      message: `${label} is missing translations for ${missing.join(", ")}`,
      detail: {
        ...(s.resourceName ? { resourceName: s.resourceName } : {}),
        missingLocales: missing,
        ...(s.locales ? { locales: s.locales } : {}),
      },
    });
  }
  return out;
}

/** The native data products this source ingests for one preview. */
export interface NativeDataProducts {
  atf?: AtfPayload;
  touchTargets?: TouchTargetsPayload;
  textStrings?: TextStringsPayload;
  translations?: I18nTranslationsPayload;
}

/**
 * All native findings for one preview, in value order (a11y/contrast first, then
 * i18n) to match the verdict's lead (docs/PRINCIPLES.md Principle 2).
 */
export function nativeFindings(products: NativeDataProducts): Finding[] {
  return [
    ...atfFindings(products.atf),
    ...touchTargetFindings(products.touchTargets),
    ...textStringFindings(products.textStrings),
    ...translationFindings(products.translations),
  ];
}

// ---------------------------------------------------------------------------
// a11y/hierarchy → SemanticTree.
// ---------------------------------------------------------------------------

function hierarchyNode(node: HierarchyNode): SemanticNode {
  const out: SemanticNode = {};
  if (node.role) out.role = node.role;
  if (node.label !== undefined) out.label = node.label;
  const bounds = parseScreenBounds(node.boundsInScreen);
  if (bounds) out.bounds = bounds;
  return out;
}

/**
 * Build a {@link SemanticTree} from the **flat** `a11y/hierarchy` node list.
 *
 * `a11y/hierarchy` is a flat list (not nested), so we hang every node off a
 * synthetic root — enough for the parity diff's structural / semantic check
 * (roles, labels, bounds) and design-parity's own touch-target/label checks
 * when no native findings are present. Deeper nesting (and resolved fg/bg
 * colours for contrast) come from `compose/semantics` / `compose/theme` /
 * `text/strings` when those are wired; contrast on the daemon path is supplied
 * by the native `a11y/atf` findings instead.
 */
export function hierarchyToSemanticTree(
  payload: HierarchyPayload | undefined,
  theme?: Theme,
): SemanticTree {
  const nodes = (payload?.nodes ?? []).map(hierarchyNode);
  const root: SemanticNode = nodes.length > 0 ? { children: nodes } : {};
  const tree: SemanticTree = { root };
  if (theme) tree.theme = theme;
  return tree;
}

// ---------------------------------------------------------------------------
// compose/semantics (+ compose/theme) → deeper SemanticTree.
// ---------------------------------------------------------------------------

/**
 * Normalize a Compose `Role` name (`"Button"`, `"RadioButton"`, …) into the
 * lowercase vocabulary `@design-parity/checks` matches on (`"button"`,
 * `"radio"`, …). Plain text and containers carry no role and stay unset.
 */
function normalizeSemanticsRole(
  role: string | null | undefined,
): string | undefined {
  if (!role) return undefined;
  const lower = role.toLowerCase();
  return lower === "radiobutton" ? "radio" : lower;
}

/** A Material "on-" colour (`onPrimary`, `onSurface`) is a foreground role. */
const isOnColor = (name: string): boolean => /^on[A-Z]/.test(name);

/**
 * Choose the colour-token key for a node's resolved `cssValue`: the theme token
 * name when it reverse-matches **exactly one** token of the right role
 * (`fg` → `on*`; `bg` → the rest), else the generic `fg`/`bg`. Keying by the
 * code name surfaces the attribute the element is using (e.g. `onSurface`) and
 * still classifies correctly for contrast (`classifyColor` reads `on*` as fg).
 */
function colorTokenKey(
  cssValue: string,
  role: "fg" | "bg",
  themeTokens: DesignTokens | undefined,
  consumerTokens?: readonly string[],
): string {
  const matches = themeTokenNamesFor(cssValue, themeTokens).filter((n) =>
    role === "fg" ? isOnColor(n) : !isOnColor(n),
  );
  // Exact attribution (#1847): when the producer reported which tokens this node
  // read, intersect them with the value-matched candidates. That disambiguates
  // the values several roles share (white = onPrimary/onError/…) where the
  // reverse-match alone can't, so the node keeps the role it actually read.
  if (consumerTokens?.length) {
    const attributed = matches.filter((n) => consumerTokens.includes(n));
    if (attributed.length === 1) return attributed[0]!;
  }
  return matches.length === 1 ? matches[0]! : role;
}

/** Map one `compose/semantics` node (recursively) to a {@link SemanticNode}. */
function semanticsNode(
  node: ComposeSemanticsNode,
  themeTokens: DesignTokens | undefined,
  consumersByNode: ReadonlyMap<string, readonly string[]>,
): SemanticNode {
  const out: SemanticNode = {};
  const role = normalizeSemanticsRole(node.role);
  if (role) out.role = role;
  const label = node.label ?? node.text ?? node.layoutText;
  if (label !== undefined) out.label = label;
  // Kept out of `label` on purpose — see `SemanticNode.testTag`. It is a name a
  // reader can use (an annotation legend falls back to it rather than showing a
  // bare numbered box), not an accessible name the a11y checks may accept.
  if (node.testTag !== undefined) out.testTag = node.testTag;
  const bounds = parseScreenBounds(node.boundsInRoot);
  if (bounds) out.bounds = bounds;

  const consumerTokens = node.nodeId ? consumersByNode.get(node.nodeId) : undefined;
  const colors: Record<string, string> = {};
  // v6 (#1903) moved these into sub-objects; fall back to the flat fields for older renders.
  const fg = argbToCssHex(node.textColor?.foreground ?? node.layoutForegroundColor);
  if (fg) colors[colorTokenKey(fg, "fg", themeTokens, consumerTokens)] = fg;
  const bg = argbToCssHex(node.textColor?.background ?? node.layoutBackgroundColor);
  if (bg) colors[colorTokenKey(bg, "bg", themeTokens, consumerTokens)] = bg;
  const text = textTypography(node, parseFontSizeSp(node.typography?.fontSize ?? node.layoutFontSize));
  if (Object.keys(colors).length || text) {
    out.tokens = {};
    if (Object.keys(colors).length) out.tokens.colors = colors;
    if (text) out.tokens.typography = { text };
  }

  const children = (node.children ?? []).map((c) =>
    semanticsNode(c, themeTokens, consumersByNode),
  );
  if (children.length) out.children = children;
  return out;
}

/**
 * Index `compose/theme.consumers` (#1847) by nodeId — the theme tokens each node
 * read, keyed by the same SemanticsNode id `compose/semantics` uses, so the two
 * products join directly. Empty when the producer left `consumers` unpopulated
 * (schema v1), in which case attribution falls back to the reverse-match below.
 */
function consumerTokensByNode(
  payload: ComposeThemePayload | undefined,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const c of payload?.consumers ?? []) {
    if (c?.nodeId && c.tokens?.length) map.set(c.nodeId, c.tokens);
  }
  return map;
}

/** Parse a Compose `"FontWeight(weight=400)"` (or bare number) into a number. */
function parseFontWeight(w: string | number | undefined): number | undefined {
  if (typeof w === "number") return w;
  if (typeof w !== "string") return undefined;
  const m = /(\d+)/.exec(w);
  return m ? Number(m[1]) : undefined;
}

/** Pull the first dp size out of a `RoundedCornerShape(... size = 4.0.dp ...)`. */
function parseShapeDp(spec: string | undefined): number | undefined {
  if (!spec) return undefined;
  const m = /size\s*=\s*(-?\d+(?:\.\d+)?)/.exec(spec);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Map a `compose/theme` typography token to the core {@link TypographyToken}. */
function themeTypography(t: ComposeThemeTypography): TypographyToken {
  const out: TypographyToken = {};
  if (t.fontFamily !== undefined) out.fontFamily = normalizeFontFamily(t.fontFamily);
  if (t.fontSize !== undefined) out.fontSize = t.fontSize;
  const weight = parseFontWeight(t.fontWeight);
  if (weight !== undefined) out.fontWeight = weight;
  if (t.lineHeight !== undefined) out.lineHeight = t.lineHeight;
  if (t.letterSpacing !== undefined) out.letterSpacing = t.letterSpacing;
  return out;
}

/**
 * Map a `compose/theme` payload to the resolved {@link DesignTokens} — the full
 * design system behind a render: `colors` (the scheme, `#AARRGGBB` → CSS), the
 * Material `typography` styles, and corner `radius` parsed from the shape specs.
 * Keys keep their code token names (`onBackground`, `bodyLarge`, `medium`).
 */
export function composeThemeToTokens(
  payload: ComposeThemePayload | undefined,
): DesignTokens | undefined {
  const rt = payload?.resolvedTokens;
  if (!rt) return undefined;
  const out: DesignTokens = {};

  const colors: Record<string, string> = {};
  for (const [name, value] of Object.entries(rt.colorScheme ?? {})) {
    const hex = argbToCssHex(value);
    if (hex) colors[name] = hex;
  }
  if (Object.keys(colors).length) out.colors = colors;

  const typography: Record<string, TypographyToken> = {};
  for (const [name, t] of Object.entries(rt.typography ?? {})) {
    typography[name] = themeTypography(t);
  }
  if (Object.keys(typography).length) out.typography = typography;

  const radius: Record<string, number> = {};
  for (const [name, spec] of Object.entries(rt.shapes ?? {})) {
    const dp = parseShapeDp(spec);
    if (dp !== undefined) radius[name] = dp;
  }
  if (Object.keys(radius).length) out.radius = radius;

  return Object.keys(out).length ? out : undefined;
}

/**
 * Reverse-match a node's resolved colour (CSS `#rrggbbaa`) back to the theme
 * token name(s) that resolve to it. Returns names in a stable order; ambiguous
 * values (e.g. white = `onPrimary`/`onError`/…) yield several.
 *
 * This is the **fallback** signal. When the producer populates
 * `compose/theme.consumers` (schema v2, compose-ai-tools#1847), {@link colorTokenKey}
 * uses the per-node attribution to pick exactly the role the node read and only
 * falls back to this reverse-match for nodes/producers without it (v1 emits
 * `consumers: []`).
 */
function themeTokenNamesFor(
  cssValue: string,
  themeTokens: DesignTokens | undefined,
): string[] {
  const colors = themeTokens?.colors;
  if (!colors) return [];
  return Object.entries(colors)
    .filter(([, v]) => v === cssValue)
    .map(([name]) => name)
    .sort();
}

/**
 * Seed a root-level background/foreground from the theme so text nodes without
 * their own background still resolve one for contrast. Keyed by the **code
 * token name** picked (`background`/`surface`, `onBackground`/`onSurface`) so
 * the screen's default theme attributes are visible; `classifyColor` reads
 * those names as bg/fg. Empty when the scheme exposes neither.
 */
function themeRootColors(
  themeTokens: DesignTokens | undefined,
): Record<string, string> | undefined {
  const scheme = themeTokens?.colors;
  if (!scheme) return undefined;
  const bgName = scheme["background"] !== undefined ? "background" : "surface";
  const fgName = scheme["onBackground"] !== undefined ? "onBackground" : "onSurface";
  const out: Record<string, string> = {};
  if (scheme[bgName]) out[bgName] = scheme[bgName]!;
  if (scheme[fgName]) out[fgName] = scheme[fgName]!;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Build a {@link SemanticTree} from the **nested** `compose/semantics` tree,
 * with per-node fg/bg colours + font size resolved so colour-based contrast can
 * run from the tree (issue #55) — deeper than the flat `a11y/hierarchy` path,
 * which hangs every node off a synthetic root and leaves contrast to native
 * `a11y/atf`.
 *
 * `compose/semantics` already carries real structure (`root` + `children`) and
 * each text node's resolved style colours (`layout*Color`, `#AARRGGBB`), so the
 * mapper just walks the tree and converts the colour format. When a
 * `compose/theme` colour scheme is supplied, the root is seeded with the
 * surface/background (and its on-colour) so text nodes that don't carry their
 * own background still resolve one — `resolveColorUp` walks to the root. A
 * node's own colours always win over the seeded root (nearest-first).
 *
 * Returns `undefined` when the payload has no `root`, so the daemon source can
 * fall back to {@link hierarchyToSemanticTree}.
 */
export function semanticsToSemanticTree(
  payload: ComposeSemanticsPayload | undefined,
  theme?: Theme,
  themeColors?: ComposeThemePayload,
): SemanticTree | undefined {
  if (!payload?.root) return undefined;
  const themeTokens = composeThemeToTokens(themeColors);
  const consumersByNode = consumerTokensByNode(themeColors);
  const root = semanticsNode(payload.root, themeTokens, consumersByNode);

  const seed = themeRootColors(themeTokens);
  if (seed) {
    const existing = root.tokens?.colors ?? {};
    // The root's own colours (rare) win; the theme only fills gaps.
    const merged = { ...seed, ...existing };
    root.tokens = { ...root.tokens, colors: merged };
  }

  const tree: SemanticTree = { root };
  if (theme) tree.theme = theme;
  if (themeTokens) tree.themeTokens = themeTokens;
  return tree;
}

// ---------------------------------------------------------------------------
// Transport seam + daemon source.
// ---------------------------------------------------------------------------

/** A rendered image as the daemon surfaces it (data: URI or repo path). */
export interface DaemonImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * The live-renderer transport. Production drives the JSON-RPC-over-stdio daemon
 * (`initialize` → `renderNow` → `renderFinished` → `data/fetch`); tests inject a
 * fake. `fetch` returns the **already-resolved payload object** for a `(preview,
 * kind)` — the implementation reads the on-disk `path` or inline `payload` the
 * `data/fetch` result carries — or `undefined` when the product is unavailable.
 */
export interface DaemonDataClient {
  /** The rendered capture for a preview, or `undefined` if it didn't render. */
  image(previewId: string): Promise<DaemonImage | undefined>;
  /** The resolved payload for a `(previewId, kind)`, or `undefined`. */
  fetch(previewId: string, kind: string): Promise<unknown | undefined>;
}

/** One daemon candidate: the render plus its renderer-native findings. */
export interface DaemonCandidate {
  candidate: CandidateRender;
  /** Renderer-native a11y/i18n findings (the verdict's a11y/i18n source). */
  nativeFindings: Finding[];
}

/**
 * A {@link CandidateSource} backed by the live daemon. In addition to the
 * standard {@link CandidateSource.getCandidate}, it exposes
 * {@link DaemonCandidateSource.nativeFindingsFor} so the orchestrator can inject
 * the renderer's findings as the diff's `checks` provider (issue #43).
 */
export interface DaemonCandidateSource extends CandidateSource {
  getDaemonCandidate(
    componentId: string,
    ctx: { repoRoot: string; env: Record<string, string | undefined> },
  ): Promise<DaemonCandidate | undefined>;
  nativeFindingsFor(
    componentId: string,
    ctx: { repoRoot: string; env: Record<string, string | undefined> },
  ): Promise<Finding[] | undefined>;
}

export interface DaemonSourceOptions {
  /** The live-renderer transport (production: stdio JSON-RPC; tests: a fake). */
  client: DaemonDataClient;
  /** Map a design-parity component id (code handle) to a daemon preview id. */
  previewIdFor: (componentId: string) => string | undefined;
  /** Theme to tag the built SemanticTree with, when known. */
  themeFor?: (componentId: string) => Theme | undefined;
}

/**
 * Build the live-daemon {@link CandidateSource}. For a component it resolves the
 * preview id, renders the image, fetches the native data products, maps them to
 * a {@link CandidateRender} (image + `a11y/hierarchy` semantics) plus
 * `nativeFindings`. Returns `undefined` for a component it has no preview id for
 * (so {@link firstAvailable} can fall through).
 */
export function daemonSource(options: DaemonSourceOptions): DaemonCandidateSource {
  const cache = new Map<string, DaemonCandidate | undefined>();

  async function build(
    componentId: string,
  ): Promise<DaemonCandidate | undefined> {
    if (cache.has(componentId)) return cache.get(componentId);
    const previewId = options.previewIdFor(componentId);
    if (!previewId) {
      cache.set(componentId, undefined);
      return undefined;
    }

    const image = await options.client.image(previewId);
    if (!image) {
      cache.set(componentId, undefined);
      return undefined;
    }

    const theme = options.themeFor?.(componentId);
    const [
      atf,
      touchTargets,
      textStrings,
      translations,
      hierarchy,
      composeSemantics,
      composeTheme,
    ] = (await Promise.all([
      options.client.fetch(previewId, "a11y/atf"),
      options.client.fetch(previewId, "a11y/touchTargets"),
      options.client.fetch(previewId, "text/strings"),
      options.client.fetch(previewId, "i18n/translations"),
      options.client.fetch(previewId, "a11y/hierarchy"),
      options.client.fetch(previewId, "compose/semantics"),
      options.client.fetch(previewId, "compose/theme"),
    ])) as [
      AtfPayload | undefined,
      TouchTargetsPayload | undefined,
      TextStringsPayload | undefined,
      I18nTranslationsPayload | undefined,
      HierarchyPayload | undefined,
      ComposeSemanticsPayload | undefined,
      ComposeThemePayload | undefined,
    ];

    const img: Image = {
      state: "default",
      uri: image.uri,
      width: image.width,
      height: image.height,
    };
    if (theme) img.theme = theme;

    // Prefer the nested compose/semantics tree (real structure + resolved
    // colours for tree-side contrast, #55); fall back to the flat
    // a11y/hierarchy when the richer product isn't available.
    const semantics =
      semanticsToSemanticTree(composeSemantics, theme, composeTheme) ??
      hierarchyToSemanticTree(hierarchy, theme);

    const candidate: CandidateRender = {
      componentId,
      previewId,
      images: [img],
      semantics,
    };

    const result: DaemonCandidate = {
      candidate,
      nativeFindings: nativeFindings({ atf, touchTargets, textStrings, translations }),
    };
    cache.set(componentId, result);
    return result;
  }

  return {
    kind: "daemon",
    async getCandidate(componentId) {
      return (await build(componentId))?.candidate;
    },
    async getDaemonCandidate(componentId) {
      return build(componentId);
    },
    async nativeFindingsFor(componentId) {
      return (await build(componentId))?.nativeFindings;
    },
  };
}
