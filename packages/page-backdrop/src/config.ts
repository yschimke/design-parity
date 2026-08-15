/**
 * The opt-in gate.
 *
 * Page backdrops are **off by default and stay off** until a repo commits a
 * `design-pages.json` *and* sets `"enabled": true` in it. Both halves are
 * load-bearing:
 *
 * - **No file → off.** Nothing in this package ever discovers pages, calls
 *   Figma, or writes files on its own. A repo that has never heard of the
 *   feature behaves exactly as it did before.
 * - **File without `enabled: true` → off.** A repo can commit the config —
 *   file key, which frames are the key pages, where the output goes — and keep
 *   the feature dark until someone deliberately flips the flag. Landing the
 *   configuration and turning the feature on are separate decisions, so
 *   reviewing the former never silently does the latter.
 *
 * Nothing here is wired into `@design-parity/action`, so the PR bot's steady
 * state is untouched whatever this file says: the importer and the viewer are
 * only ever reached by running the `design-parity-pages` CLI by hand.
 *
 * A malformed config is reported as **off with a reason**, never as a throw —
 * a broken opt-in must not break a caller that merely asked whether the feature
 * is on.
 */
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/** How a placement's overlay render is blended over the backdrop. */
export type OverlayBlend = "normal" | "difference";

/** Viewer defaults for the "show the render on top" layer. */
export interface OverlayConfig {
  /**
   * Whether the overlay starts **on** when the page is opened. Defaults to
   * `false`: the viewer opens showing the design, and laying code on top of it
   * is a deliberate click. The overlay layer is still built (so the toggle
   * works offline) — it just starts hidden.
   */
  enabled: boolean;
  /** Overlay opacity when toggled on, `0`–`1`. */
  opacity: number;
  blend: OverlayBlend;
}

/** How a page's backdrop is exported. */
export type BackdropFormat = "png" | "svg";

/** One key page to import, as named in the committed config. */
export interface PageSelector {
  /** Figma node id of the frame, e.g. `"1:2"`. */
  nodeId: string;
  /** Optional explicit slug; defaults to a slug of the frame's own name. */
  id?: string;
}

/** A validated `design-pages.json`. */
export interface PageBackdropConfig {
  source: "figma";
  /** Figma file key the pages live in. */
  fileKey: string;
  /** The key pages — explicit, never auto-discovered. */
  pages: PageSelector[];
  /**
   * What a backdrop is exported as. `png` is a picture; `svg` is a document
   * carrying `data-node-id` on every element, which lets the viewer cut the
   * design element out from under a code render instead of laying the render
   * over it (see `svg-backdrop.ts`).
   *
   * `png` remains the default: it is the safe answer for a screen assembled
   * from photography and effects, where a vector export is large and can differ
   * from what the design tool itself draws. `svg` is the right answer for the
   * component specimen sheets a design kit is mostly made of.
   */
  backdrop: BackdropFormat;
  /** PNG export scale for the backdrops. Ignored for an SVG, which has no raster size. */
  scale: number;
  /**
   * Record instances nested inside another instance. Off by default: the
   * outermost instance is the placement a reviewer cares about, and descending
   * turns one `Card` into a dozen overlapping rectangles.
   */
  nested: boolean;
  /** Where the manifest + backdrop PNGs are written, absolute. */
  outDir: string;
  overlay: OverlayConfig;
  /** Absolute path of the config file this was loaded from. */
  configPath: string;
}

/** Why the feature is off. */
export type DisabledReason =
  /** No `design-pages.json` — the repo never opted in. */
  | "no-config"
  /** A config exists but does not set `"enabled": true`. */
  | "disabled"
  /** A config exists and is enabled, but is malformed. */
  | "invalid";

/** The result of asking whether page backdrops are on for a repo. */
export type PageBackdropStatus =
  | { enabled: false; reason: DisabledReason; detail?: string }
  | { enabled: true; config: PageBackdropConfig };

/** Default config filename, resolved against the repo root. */
export const CONFIG_FILENAME = "design-pages.json";

const DEFAULT_SCALE = 2;
const DEFAULT_OUT_DIR = "design/pages";

/** Lowercase, dash-separated slug of a layer name. Stable and filename-safe. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "page";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function off(reason: DisabledReason, detail?: string): PageBackdropStatus {
  return detail === undefined
    ? { enabled: false, reason }
    : { enabled: false, reason, detail };
}

function parseOverlay(raw: unknown): OverlayConfig | string {
  if (raw === undefined) return { enabled: false, opacity: 0.5, blend: "normal" };
  if (!isRecord(raw)) return "'overlay' must be an object";

  const enabled = raw.enabled ?? false;
  if (typeof enabled !== "boolean") return "'overlay.enabled' must be a boolean";

  const opacity = raw.opacity ?? 0.5;
  if (typeof opacity !== "number" || !(opacity >= 0 && opacity <= 1)) {
    return "'overlay.opacity' must be a number between 0 and 1";
  }

  const blend = raw.blend ?? "normal";
  if (blend !== "normal" && blend !== "difference") {
    return "'overlay.blend' must be 'normal' or 'difference'";
  }

  return { enabled, opacity, blend };
}

function parsePages(raw: unknown): PageSelector[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "'pages' must be a non-empty array of { nodeId } entries";
  }
  const pages: PageSelector[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry)) return `'pages[${i}]' must be an object`;
    const { nodeId, id } = entry;
    if (typeof nodeId !== "string" || nodeId.trim() === "") {
      return `'pages[${i}].nodeId' must be a non-empty string`;
    }
    if (id !== undefined && (typeof id !== "string" || id.trim() === "")) {
      return `'pages[${i}].id' must be a non-empty string when present`;
    }
    pages.push(id === undefined ? { nodeId } : { nodeId, id });
  }
  return pages;
}

/**
 * Validate an already-parsed config object. Split out from
 * {@link loadPageBackdropConfig} so callers holding the JSON (a test, an editor
 * integration) get the same verdict without touching the filesystem.
 *
 * `configPath` is only used to resolve a relative `outDir` and to report where
 * a problem came from.
 */
export function readPageBackdropConfig(
  raw: unknown,
  configPath: string,
): PageBackdropStatus {
  if (!isRecord(raw)) return off("invalid", `${configPath}: not a JSON object`);

  // The gate, checked before anything else: an absent or non-`true` `enabled`
  // is a normal, silent "off", not a validation failure.
  if (raw.enabled !== true) return off("disabled");

  const source = raw.source ?? "figma";
  if (source !== "figma") {
    return off("invalid", `${configPath}: 'source' must be 'figma' (got ${JSON.stringify(source)})`);
  }

  const fileKey = raw.fileKey;
  if (typeof fileKey !== "string" || fileKey.trim() === "") {
    return off("invalid", `${configPath}: 'fileKey' must be a non-empty string`);
  }

  const pages = parsePages(raw.pages);
  if (typeof pages === "string") return off("invalid", `${configPath}: ${pages}`);

  const backdrop = raw.backdrop ?? "png";
  if (backdrop !== "png" && backdrop !== "svg") {
    return off("invalid", `${configPath}: 'backdrop' must be 'png' or 'svg'`);
  }

  const scale = raw.scale ?? DEFAULT_SCALE;
  if (typeof scale !== "number" || !(scale > 0 && scale <= 4)) {
    return off("invalid", `${configPath}: 'scale' must be a number in (0, 4]`);
  }

  const nested = raw.nested ?? false;
  if (typeof nested !== "boolean") {
    return off("invalid", `${configPath}: 'nested' must be a boolean`);
  }

  const outDirRaw = raw.outDir ?? DEFAULT_OUT_DIR;
  if (typeof outDirRaw !== "string" || outDirRaw.trim() === "") {
    return off("invalid", `${configPath}: 'outDir' must be a non-empty string`);
  }

  const overlay = parseOverlay(raw.overlay);
  if (typeof overlay === "string") return off("invalid", `${configPath}: ${overlay}`);

  const base = dirname(resolve(configPath));
  return {
    enabled: true,
    config: {
      source: "figma",
      fileKey,
      pages,
      backdrop,
      scale,
      nested,
      outDir: isAbsolute(outDirRaw) ? outDirRaw : resolve(base, outDirRaw),
      overlay,
      configPath: resolve(configPath),
    },
  };
}

/**
 * Load `design-pages.json` from `repoRoot` (or an explicit path) and report
 * whether page backdrops are on.
 *
 * Never throws: a missing file is `no-config`, an unreadable or unparseable one
 * is `invalid`. Callers branch on `status.enabled` and do nothing when off.
 */
export async function loadPageBackdropConfig(
  location: { repoRoot?: string; configPath?: string } = {},
): Promise<PageBackdropStatus> {
  const configPath = location.configPath
    ? resolve(location.configPath)
    : resolve(location.repoRoot ?? process.cwd(), CONFIG_FILENAME);

  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return off("no-config");
    return off("invalid", `${configPath}: cannot be read (${code ?? "unknown error"})`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return off("invalid", `${configPath}: not valid JSON`);
  }

  return readPageBackdropConfig(json, configPath);
}

/** A human-readable explanation of why the feature is off, for CLI output. */
export function explainDisabled(
  status: Extract<PageBackdropStatus, { enabled: false }>,
  configPath: string,
): string {
  switch (status.reason) {
    case "no-config":
      return `page backdrops are off: no ${configPath}. This feature is opt-in — see the @design-parity/page-backdrop README to turn it on.`;
    case "disabled":
      return `page backdrops are off: ${configPath} does not set "enabled": true.`;
    case "invalid":
      return `page backdrops are off: ${status.detail ?? "invalid configuration"}`;
  }
}
