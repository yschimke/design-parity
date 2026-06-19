/**
 * The wrapper's view of the upstream `compose-preview` CLI.
 *
 * This package does **not** reimplement rendering — it shells out to the
 * published CLI (see https://github.com/yschimke/compose-ai-tools), reads the
 * artifacts it writes, and normalizes them into the shapes the diff engine
 * consumes. {@link ComposePreviewCli} is the seam: production uses
 * {@link SpawnComposePreviewCli}; tests inject a fake.
 *
 * The upstream JSON shapes are documented by the `compose-preview` skill; the
 * interfaces below are the **consumption contract** — the subset of fields this
 * wrapper depends on, parsed defensively so additive CLI changes don't break it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  DesignTokens,
  SemanticNode,
  SemanticTree,
  Theme,
  TypographyToken,
} from "@design-parity/core";

import { normalizeFontFamily } from "./daemon.js";
import { execFileRunner, isNotFound, type CommandRunner } from "./exec.js";
import {
  MissingComposePreviewError,
  NoPreviewsError,
  RenderError,
} from "./errors.js";
import { readPngSize } from "./png.js";

// ---------------------------------------------------------------------------
// Upstream shapes we consume (subset of `compose-preview show --json`).
// ---------------------------------------------------------------------------

/** Preview parameters the CLI reports per entry (the subset we read). */
export interface PreviewParams {
  device?: string;
  widthDp?: number;
  heightDp?: number;
  fontScale?: number;
  /** Android `Configuration.UI_MODE_*` int, or a resolved theme string. */
  uiMode?: number | string;
  /**
   * Explicit theme hint (`"light"`/`"dark"`). The authoritative theme when a
   * project themes via a `CompositionLocal` rather than `uiMode` (so `uiMode`
   * is always `0`); a producer sets this per preview/capture. See issue #48.
   */
  theme?: Theme | string;
  locale?: string;
  /** Variant state, if the renderer surfaces one (default/pressed/disabled). */
  state?: string;
}

/** One entry of `compose-preview show --json`. */
export interface ShowEntry {
  /** Unique preview id (e.g. `com.example.ButtonPreview_dark`). */
  id: string;
  /** Absolute path to the rendered PNG. */
  pngPath: string;
  sha256?: string;
  changed?: boolean;
  params: PreviewParams;
}

/** A rendered preview plus the derived bits the mapper needs. */
export interface RenderedPreview {
  entry: ShowEntry;
  /** Pixel width from the PNG IHDR. */
  pngWidth: number;
  /** Pixel height from the PNG IHDR. */
  pngHeight: number;
  /** Normalized semantics, when the renderer emitted the hierarchy product. */
  semantics?: SemanticTree;
}

/** What previews to render and how. */
export interface RenderRequest {
  /** Gradle module to target (`--module`); default is CLI auto-detect. */
  module?: string;
  /** Substring match on preview id (`--filter`). */
  filter?: string;
  /** Exact preview id (`--id`); takes precedence over `filter`. */
  id?: string;
  /** Android build variant (`--variant`). */
  variant?: string;
  /** Gradle build timeout in seconds (`--timeout`). */
  timeoutSeconds?: number;
}

/**
 * The wrapper's view of the upstream renderer. Production is
 * {@link SpawnComposePreviewCli}; fake it in tests.
 */
export interface ComposePreviewCli {
  /** Verify the CLI is installed; throws {@link MissingComposePreviewError}. */
  ensureInstalled(): Promise<void>;
  /** Render the requested previews and return them with derived metadata. */
  render(req: RenderRequest): Promise<RenderedPreview[]>;
}

// ---------------------------------------------------------------------------
// Pure param → contract mappers (exported so they can be unit-tested directly).
// ---------------------------------------------------------------------------

// Android Configuration UI mode night bits.
const UI_MODE_NIGHT_MASK = 0x30;
const UI_MODE_NIGHT_NO = 0x10;
const UI_MODE_NIGHT_YES = 0x20;

/** Map a preview's `uiMode` to a {@link Theme}, or `undefined` if unknown. */
export function themeFromUiMode(
  uiMode: number | string | undefined,
): Theme | undefined {
  if (uiMode === undefined) return undefined;
  if (typeof uiMode === "string") {
    const v = uiMode.toLowerCase();
    // Order matters: "notnight" contains "night".
    if (v.includes("notnight") || v.includes("light")) return "light";
    if (v.includes("night") || v.includes("dark")) return "dark";
    return undefined;
  }
  const night = uiMode & UI_MODE_NIGHT_MASK;
  if (night === UI_MODE_NIGHT_YES) return "dark";
  if (night === UI_MODE_NIGHT_NO) return "light";
  return undefined;
}

/**
 * Derive a {@link Theme} from a preview id by its trailing token (issue #48).
 *
 * Many projects theme via a `CompositionLocal` (so `uiMode` is `0` and the theme
 * is undiscoverable from params), but encode the variant in the preview name —
 * e.g. `Tile_LightOn` (light) vs `Tile_LightOn_Dark` (dark). We look only at the
 * **last** `[_\-. ()]`-separated token so a `dark`/`light`/`night` suffix is
 * recognised while an embedded word (`LightOn`) is not — that substring ambiguity
 * is exactly why a whole-string match would misfire here. Low confidence; an
 * explicit {@link PreviewParams.theme} hint always wins.
 */
export function themeFromName(id: string | undefined): Theme | undefined {
  if (!id) return undefined;
  const tokens = id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (last === "dark" || last === "night") return "dark";
  if (last === "light") return "light";
  return undefined;
}

/**
 * The theme for a preview's rendered image, in precedence order (issue #48):
 * an explicit {@link PreviewParams.theme} hint, then the Android `uiMode`, then
 * the preview-id name convention. `undefined` when none applies.
 */
export function themeForPreview(
  params: PreviewParams,
  id?: string,
): Theme | undefined {
  return (
    themeFromUiMode(params.theme) ??
    themeFromUiMode(params.uiMode) ??
    themeFromName(id)
  );
}

/**
 * Map preview params to a logical size label using Material window-size
 * classes (compact <600dp, medium <840dp, expanded otherwise), falling back to
 * the device label when no width is reported.
 */
export function sizeFromParams(params: PreviewParams): string | undefined {
  const w = params.widthDp;
  if (typeof w === "number" && w > 0) {
    if (w < 600) return "compact";
    if (w < 840) return "medium";
    return "expanded";
  }
  return params.device;
}

/** The variant state of a render; `"default"` when the renderer omits one. */
export function stateFromParams(params: PreviewParams): string {
  return params.state ?? "default";
}

// ---------------------------------------------------------------------------
// Semantics normalization (a11y/hierarchy or compose/semantics data product).
// ---------------------------------------------------------------------------

/** Loosely-typed node as the renderer's hierarchy product emits it. */
/**
 * The compose/semantics producer's resolved design-token shape (schema v3
 * compose-ai-tools#1897, extended in v4 compose-ai-tools#1908): a node's container
 * background and border colours, corner radius (dp or percent-resolved), shape
 * descriptor, arrangement gap, and padding, extracted from its
 * `Modifier.background`/`border`/`clip`/`padding` and the layout's arrangement. This
 * is the producer wire format — distinct from the core {@link DesignTokens} — and is
 * translated by {@link composeTokensToDesign}.
 */
export interface RawComposeTokens {
  /** Container/fill colour as ARGB hex `#AARRGGBB` (e.g. from `Modifier.background`). */
  backgroundColor?: string;
  /** Outline/stroke colour as ARGB hex `#AARRGGBB` from `Modifier.border` (compose-ai-tools#1908). */
  borderColor?: string;
  /** Corner radius in dp: `"12.0dp"` uniform, or four comma-separated corners. */
  cornerRadius?: string;
  /** Shape-family descriptor (`"circle"` / `"cut"`) for non-dp shapes (compose-ai-tools#1908). */
  shape?: string;
  /** `Row`/`Column` `Arrangement.spacedBy` inter-child spacing in dp, `"8.0dp"` (compose-ai-tools#1908). */
  gap?: string;
  /** Per-edge padding in dp (`"16.0dp"`). */
  padding?: { start?: string; top?: string; end?: string; bottom?: string };
}

export interface RawSemanticsNode {
  role?: string;
  label?: string;
  /** Android content description — used as the label when `label` is absent. */
  contentDescription?: string;
  /** Visible text — last-resort label source. */
  text?: string;
  bounds?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
  };
  /**
   * compose/semantics geometry as a `"left,top,right,bottom"` (px) string — what
   * the compose-preview *bundle* emits, alongside its {@link RawComposeTokens}.
   * Read as a fallback when the object {@link bounds} form is absent, so the
   * bundle path captures geometry (overlays + structural layout diff), not just
   * the daemon path.
   */
  boundsInRoot?: string;
  /** Same `"l,t,r,b"` px geometry under the hierarchy product's key. */
  boundsInScreen?: string;
  /** Resolved text colours, ARGB `#AARRGGBB` (compose/semantics v6, #1903). */
  textColor?: { foreground?: string; background?: string };
  /** Pre-v6 flat text foreground colour, ARGB `#AARRGGBB` — read as a fallback. */
  layoutForegroundColor?: string;
  /** Pre-v6 flat text background colour, ARGB `#AARRGGBB` — read as a fallback. */
  layoutBackgroundColor?: string;
  /**
   * Resolved text style (compose/semantics v6, #1934/#1903) — face/weight/style
   * and metrics of the drawn text. Maps to a {@link TypographyToken} so the
   * report's typography overlay and the token diff see the candidate's type.
   */
  typography?: {
    fontFamily?: string;
    fontWeight?: number | string;
    fontStyle?: string;
    fontSize?: string;
    lineHeight?: string;
    letterSpacing?: string;
  };
  /** Pre-v6 flat text size, e.g. `"14.0sp"` — read as a fallback for the size. */
  layoutFontSize?: string;
  /**
   * Either the core {@link DesignTokens} bag (the a11y/hierarchy product) or the
   * compose/semantics producer's {@link RawComposeTokens} (schema v3). Detected
   * by key shape and normalized to {@link DesignTokens} in {@link normalizeNode}.
   */
  tokens?: DesignTokens | RawComposeTokens;
  children?: RawSemanticsNode[];
}

/** The hierarchy/semantics data product for one preview. */
export interface RawSemantics {
  theme?: string;
  root?: RawSemanticsNode;
}

function normalizeBounds(
  b: RawSemanticsNode["bounds"],
): SemanticNode["bounds"] | undefined {
  if (!b) return undefined;
  if (typeof b.x === "number" && typeof b.y === "number") {
    return {
      x: b.x,
      y: b.y,
      width: b.width ?? (b.right ?? 0) - b.x,
      height: b.height ?? (b.bottom ?? 0) - b.y,
    };
  }
  if (typeof b.left === "number" && typeof b.top === "number") {
    return {
      x: b.left,
      y: b.top,
      width: b.width ?? (b.right ?? b.left) - b.left,
      height: b.height ?? (b.bottom ?? b.top) - b.top,
    };
  }
  return undefined;
}

/** Parse a compose/semantics `"left,top,right,bottom"` (px) string into bounds. */
function parseBoundsSpec(spec: string | undefined): SemanticNode["bounds"] | undefined {
  if (!spec) return undefined;
  const parts = spec.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [left, top, right, bottom] = parts as [number, number, number, number];
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** ARGB `#AARRGGBB` → CSS `#RRGGBBAA` (alpha last); 6-digit passes through; else undefined. */
function argbToCss(spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const hex = spec.startsWith("#") ? spec.slice(1) : spec;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex))
    return `#${hex.slice(2, 8)}${hex.slice(0, 2)}`.toLowerCase();
  return undefined;
}

/** Leading dp number of a `"16.0dp"` / `"12.0dp,12.0dp,…"` value, or undefined. */
function parseDp(spec: string | undefined): number | undefined {
  if (!spec) return undefined;
  const m = /^-?\d+(?:\.\d+)?/.exec(spec.trim());
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** A node `tokens` field in the producer's shape rather than core {@link DesignTokens}. */
function isComposeTokens(
  t: DesignTokens | RawComposeTokens,
): t is RawComposeTokens {
  return (
    "backgroundColor" in t ||
    "borderColor" in t ||
    "cornerRadius" in t ||
    "shape" in t ||
    "gap" in t ||
    "padding" in t
  );
}

/**
 * Translate the compose/semantics producer's {@link RawComposeTokens} into core
 * {@link DesignTokens}. The candidate has no reference token *names*, so the
 * resolved values land under generic keys — the fill colour under role `bg`, the
 * outline under `border`, the radius under `corner`, the arrangement spacing under
 * `gap`, and padding per edge (plus a uniform `padding`). The token-compliance diff
 * matches these by role/value, not name (#74, #1897, compose-ai-tools#1908).
 */
function composeTokensToDesign(t: RawComposeTokens): DesignTokens {
  const out: DesignTokens = {};
  const colors: Record<string, string> = {};
  const bg = argbToCss(t.backgroundColor);
  if (bg) colors["bg"] = bg;
  // The outline colour is a background-role (non-`fg`) value, so `roleMatch` lines it
  // up with `outline` / `outlineVariant` spec tokens by value (compose-ai-tools#1908).
  const border = argbToCss(t.borderColor);
  if (border) colors["border"] = border;
  if (Object.keys(colors).length) out.colors = colors;
  // `cornerRadius` carries dp corners verbatim and percent shapes (`CircleShape`) already
  // resolved to dp upstream, so `corner` is the effective radius either way.
  const corner = parseDp(t.cornerRadius);
  if (corner !== undefined) out.radius = { corner };
  const spacing: Record<string, number> = {};
  // Arrangement spacing is a separate signal from the node's own inset; key it `gap` so the
  // numeric value-match satisfies `cardGap` / `rowGap` spec tokens (compose-ai-tools#1908).
  const gap = parseDp(t.gap);
  if (gap !== undefined) spacing["gap"] = gap;
  if (t.padding) {
    const start = parseDp(t.padding.start);
    const top = parseDp(t.padding.top);
    const end = parseDp(t.padding.end);
    const bottom = parseDp(t.padding.bottom);
    if (start !== undefined) spacing["paddingStart"] = start;
    if (top !== undefined) spacing["paddingTop"] = top;
    if (end !== undefined) spacing["paddingEnd"] = end;
    if (bottom !== undefined) spacing["paddingBottom"] = bottom;
    const all = [start, top, end, bottom];
    if (all.every((v): v is number => v !== undefined) && all.every((v) => v === start))
      spacing["padding"] = start!;
  }
  if (Object.keys(spacing).length) out.spacing = spacing;
  return out;
}

/**
 * Resolve a node's {@link DesignTokens}: the text fg/bg colours from the
 * compose/semantics `layout*Color` fields, plus either the pass-through core
 * tokens (a11y/hierarchy) or the translated producer tokens (schema v3,
 * compose-ai-tools#1897). Returns `undefined` when the node declares none.
 */
function nodeTokens(n: RawSemanticsNode): DesignTokens | undefined {
  const out: DesignTokens = {};
  const colors: Record<string, string> = {};
  // v6 (#1903) moved these into `textColor`; fall back to the flat fields for older renders.
  const fg = argbToCss(n.textColor?.foreground ?? n.layoutForegroundColor);
  if (fg) colors["fg"] = fg;
  const bg = argbToCss(n.textColor?.background ?? n.layoutBackgroundColor);
  if (bg) colors["bg"] = bg;

  if (n.tokens) {
    const design = isComposeTokens(n.tokens)
      ? composeTokensToDesign(n.tokens)
      : n.tokens;
    if (design.spacing) out.spacing = { ...out.spacing, ...design.spacing };
    if (design.radius) out.radius = { ...out.radius, ...design.radius };
    if (design.typography)
      out.typography = Object.fromEntries(
        Object.entries(design.typography).map(([k, v]) => [
          k,
          v.fontFamily ? { ...v, fontFamily: normalizeFontFamily(v.fontFamily) } : v,
        ]),
      );
    // A producer container colour (or a hierarchy bag's named colours) wins over
    // the text background read from `layout*Color`.
    if (design.colors) Object.assign(colors, design.colors);
  }
  // Text typography from the v6 `typography` object (face/weight/metrics), or the
  // flat `layoutFontSize` for older renders — what the bundle currently emits.
  // Mirrors the daemon path so the report's typography overlay and the token
  // diff see the candidate's type, not just the daemon's.
  const text: TypographyToken = {};
  const fontSize = parseDp(n.typography?.fontSize ?? n.layoutFontSize); // "14.0sp" → 14
  if (fontSize !== undefined) text.fontSize = fontSize;
  if (n.typography?.fontFamily) text.fontFamily = normalizeFontFamily(n.typography.fontFamily);
  if (n.typography?.fontWeight !== undefined) text.fontWeight = n.typography.fontWeight;
  if (n.typography?.fontStyle) text.fontStyle = n.typography.fontStyle;
  const lineHeight = parseDp(n.typography?.lineHeight);
  if (lineHeight !== undefined) text.lineHeight = lineHeight;
  const letterSpacing = parseDp(n.typography?.letterSpacing);
  if (letterSpacing !== undefined) text.letterSpacing = letterSpacing;
  if (Object.keys(text).length) out.typography = { ...out.typography, text };
  if (Object.keys(colors).length) out.colors = colors;
  return Object.keys(out).length ? out : undefined;
}

function normalizeNode(n: RawSemanticsNode): SemanticNode {
  const node: SemanticNode = {};
  if (n.role !== undefined) node.role = n.role;
  const label = n.label ?? n.contentDescription ?? n.text;
  if (label !== undefined) node.label = label;
  // Object form first (a11y/hierarchy product), else the compose/semantics
  // `boundsInRoot`/`boundsInScreen` string the bundle emits.
  const bounds = normalizeBounds(n.bounds) ?? parseBoundsSpec(n.boundsInRoot ?? n.boundsInScreen);
  if (bounds) node.bounds = bounds;
  const tokens = nodeTokens(n);
  if (tokens) node.tokens = tokens;
  if (n.children?.length) node.children = n.children.map(normalizeNode);
  return node;
}

/**
 * Normalize a hierarchy/semantics data product into a {@link SemanticTree}.
 * Returns `undefined` when there is no root (kind disabled / empty payload).
 */
export function normalizeSemantics(
  raw: RawSemantics | undefined,
  fallbackTheme?: Theme,
): SemanticTree | undefined {
  if (!raw?.root) return undefined;
  const theme = normalizeTheme(raw.theme) ?? fallbackTheme;
  const tree: SemanticTree = { root: normalizeNode(raw.root) };
  if (theme) tree.theme = theme;
  return tree;
}

function normalizeTheme(theme: string | undefined): Theme | undefined {
  if (theme === "light" || theme === "dark") return theme;
  return undefined;
}

// ---------------------------------------------------------------------------
// `show --json` parsing.
// ---------------------------------------------------------------------------

function pickParams(raw: Record<string, unknown>): PreviewParams {
  const p: PreviewParams = {};
  const src = (raw["params"] ?? raw["previewParams"] ?? raw) as Record<
    string,
    unknown
  >;
  if (typeof src["device"] === "string") p.device = src["device"];
  if (typeof src["widthDp"] === "number") p.widthDp = src["widthDp"];
  if (typeof src["heightDp"] === "number") p.heightDp = src["heightDp"];
  if (typeof src["fontScale"] === "number") p.fontScale = src["fontScale"];
  if (typeof src["uiMode"] === "number" || typeof src["uiMode"] === "string")
    p.uiMode = src["uiMode"] as number | string;
  if (typeof src["locale"] === "string") p.locale = src["locale"];
  if (typeof src["state"] === "string") p.state = src["state"];
  return p;
}

function toShowEntry(raw: unknown): ShowEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const id = r["id"] ?? r["previewId"];
  const pngPath = r["pngPath"] ?? r["path"] ?? r["png"];
  if (typeof id !== "string" || typeof pngPath !== "string") return undefined;
  const entry: ShowEntry = { id, pngPath, params: pickParams(r) };
  if (typeof r["sha256"] === "string") entry.sha256 = r["sha256"];
  if (typeof r["changed"] === "boolean") entry.changed = r["changed"];
  return entry;
}

/** Parse `compose-preview show --json` stdout into entries. */
export function parseShow(stdout: string): ShowEntry[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (cause) {
    throw new RenderError("compose-preview show emitted invalid JSON", {
      stderr: String(cause),
    });
  }
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { previews?: unknown[] })?.previews)
      ? (data as { previews: unknown[] }).previews
      : [];
  return arr
    .map(toShowEntry)
    .filter((e): e is ShowEntry => e !== undefined);
}

// ---------------------------------------------------------------------------
// Production driver.
// ---------------------------------------------------------------------------

/** Reads file bytes; injectable so tests can stub data-product reads. */
export type ReadFile = (path: string) => Promise<Uint8Array>;

export interface SpawnOptions {
  /** Gradle project root; the CLI's cwd and base for data-product files. */
  projectDir: string;
  /** Binary to invoke; default `"compose-preview"`. */
  cliPath?: string;
  /** Process runner; default {@link execFileRunner}. */
  runner?: CommandRunner;
  /** File reader (PNG bytes + data-product JSON); default `node:fs`. */
  readFile?: ReadFile;
  /** Data-product root; default `<projectDir>/build/compose-previews/data`. */
  dataDir?: string;
  /** Semantics data-product kind; default `"a11y/hierarchy"`. */
  semanticsKind?: string;
  /** Timeout applied when a request omits one. */
  defaultTimeoutSeconds?: number;
}

/** Drives the real `compose-preview` CLI. */
export class SpawnComposePreviewCli implements ComposePreviewCli {
  constructor(private readonly opts: SpawnOptions) {}

  private get cli(): string {
    return this.opts.cliPath ?? "compose-preview";
  }

  private get runner(): CommandRunner {
    return this.opts.runner ?? execFileRunner;
  }

  private get read(): ReadFile {
    return this.opts.readFile ?? ((p) => readFile(p));
  }

  async ensureInstalled(): Promise<void> {
    let result;
    try {
      result = await this.runner.run(this.cli, ["--version"], {
        cwd: this.opts.projectDir,
        timeoutMs: 30_000,
      });
    } catch (err) {
      if (isNotFound(err)) throw new MissingComposePreviewError(this.cli, err);
      throw err;
    }
    if (result.code !== 0) {
      throw new RenderError(
        `'${this.cli} --version' exited ${result.code} — the CLI is present but not runnable`,
        { code: result.code, stderr: result.stderr },
      );
    }
  }

  async render(req: RenderRequest): Promise<RenderedPreview[]> {
    await this.ensureInstalled();

    const args = ["show", "--json"];
    if (req.module) args.push("--module", req.module);
    if (req.variant) args.push("--variant", req.variant);
    if (req.id) args.push("--id", req.id);
    else if (req.filter) args.push("--filter", req.filter);
    const timeout = req.timeoutSeconds ?? this.opts.defaultTimeoutSeconds;
    if (timeout) args.push("--timeout", String(timeout));

    let result;
    try {
      result = await this.runner.run(this.cli, args, {
        cwd: this.opts.projectDir,
        timeoutMs: timeout ? timeout * 1000 + 5_000 : undefined,
      });
    } catch (err) {
      if (isNotFound(err)) throw new MissingComposePreviewError(this.cli, err);
      throw err;
    }

    // Exit codes (per the compose-preview CLI): 0 ok, 1 build, 2 render, 3 none.
    if (result.code === 3) throw new NoPreviewsError(req);
    if (result.code !== 0) {
      throw new RenderError(
        `compose-preview show failed (exit ${result.code})`,
        { code: result.code, stderr: result.stderr },
      );
    }

    const entries = parseShow(result.stdout);
    if (entries.length === 0) throw new NoPreviewsError(req);

    const rendered: RenderedPreview[] = [];
    for (const entry of entries) {
      const bytes = await this.read(entry.pngPath);
      const { width, height } = readPngSize(bytes);
      const semantics = await this.loadSemantics(entry);
      const preview: RenderedPreview = {
        entry,
        pngWidth: width,
        pngHeight: height,
      };
      if (semantics) preview.semantics = semantics;
      rendered.push(preview);
    }
    return rendered;
  }

  /**
   * Load the semantics data product for a preview, if present. The kind is
   * optional in the consumer's Gradle config, so a missing/unparseable file is
   * not an error — the diff engine degrades gracefully without semantics.
   */
  private async loadSemantics(
    entry: ShowEntry,
  ): Promise<SemanticTree | undefined> {
    const dataDir =
      this.opts.dataDir ??
      join(this.opts.projectDir, "build/compose-previews/data");
    const kind = this.opts.semanticsKind ?? "a11y/hierarchy";
    const file = join(dataDir, entry.id, `${kind}.json`);
    let bytes: Uint8Array;
    try {
      bytes = await this.read(file);
    } catch {
      return undefined;
    }
    let parsed: RawSemantics;
    try {
      parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as RawSemantics;
    } catch {
      return undefined;
    }
    return normalizeSemantics(parsed, themeForPreview(entry.params, entry.id));
  }
}
