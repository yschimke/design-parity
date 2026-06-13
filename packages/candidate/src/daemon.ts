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
  Finding,
  Image,
  SemanticNode,
  SemanticTree,
  Severity,
  Theme,
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
    const [atf, touchTargets, textStrings, translations, hierarchy] =
      (await Promise.all([
        options.client.fetch(previewId, "a11y/atf"),
        options.client.fetch(previewId, "a11y/touchTargets"),
        options.client.fetch(previewId, "text/strings"),
        options.client.fetch(previewId, "i18n/translations"),
        options.client.fetch(previewId, "a11y/hierarchy"),
      ])) as [
        AtfPayload | undefined,
        TouchTargetsPayload | undefined,
        TextStringsPayload | undefined,
        I18nTranslationsPayload | undefined,
        HierarchyPayload | undefined,
      ];

    const img: Image = {
      state: "default",
      uri: image.uri,
      width: image.width,
      height: image.height,
    };
    if (theme) img.theme = theme;

    const candidate: CandidateRender = {
      componentId,
      previewId,
      images: [img],
      semantics: hierarchyToSemanticTree(hierarchy, theme),
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
