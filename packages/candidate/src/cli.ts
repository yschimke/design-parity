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

import type { SemanticNode, SemanticTree, Theme } from "@design-parity/core";

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
  tokens?: SemanticNode["tokens"];
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

function normalizeNode(n: RawSemanticsNode): SemanticNode {
  const node: SemanticNode = {};
  if (n.role !== undefined) node.role = n.role;
  const label = n.label ?? n.contentDescription ?? n.text;
  if (label !== undefined) node.label = label;
  const bounds = normalizeBounds(n.bounds);
  if (bounds) node.bounds = bounds;
  if (n.tokens !== undefined) node.tokens = n.tokens;
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
    return normalizeSemantics(parsed, themeFromUiMode(entry.params.uiMode));
  }
}
