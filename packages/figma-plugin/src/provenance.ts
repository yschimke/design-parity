/**
 * Render **provenance** — stamp a {@link RenderSource} onto an imported node so a
 * later **Refresh** re-renders it against updated code.
 *
 * This is the composition point of the two foundations already on `main`: the
 * identity **stamp** namespace ({@link STAMP}, from the reconcile work) and the
 * live-render **client contract** ({@link RenderSource}/{@link buildRenderUrl}).
 * A node imported live (modes b/c) carries, in its shared plugin data, exactly
 * what's needed to rebuild its `/render` URL — server, preview id, overrides,
 * format. {@link refreshUrl} is the pure "what do I re-fetch" half of Refresh,
 * the way `reconcile.ts` is the pure decision half of re-import.
 *
 * Pure: it only reads/writes a node's shared plugin data (no `fetch`, no
 * `figma` global), so it's asserted headlessly against the fake node.
 */
import type { FigmaNode } from "./scene.js";
import { STAMP } from "./scene.js";
import { buildRenderUrl, type RenderFormat, type RenderSource } from "./render.js";

/** Shared-plugin-data keys (under {@link STAMP}) that carry a node's render provenance. */
const KEY = {
  serverBase: "render.serverBase",
  basePath: "render.basePath",
  token: "render.token",
  previewId: "render.previewId",
  overrides: "render.overrides",
  format: "render.format",
} as const;

/** Stamp a {@link RenderSource} onto `node` (overwrites any prior provenance). */
export function stampRenderSource(node: FigmaNode, source: RenderSource): void {
  node.setSharedPluginData(STAMP, KEY.serverBase, source.serverBase);
  node.setSharedPluginData(STAMP, KEY.basePath, source.basePath ?? "");
  node.setSharedPluginData(STAMP, KEY.token, source.token);
  node.setSharedPluginData(STAMP, KEY.previewId, source.previewId);
  node.setSharedPluginData(STAMP, KEY.overrides, JSON.stringify(source.overrides));
  node.setSharedPluginData(STAMP, KEY.format, source.format);
}

/** True when `node` carries render provenance (was imported live, not static). */
export function hasRenderSource(node: FigmaNode): boolean {
  return node.getSharedPluginData(STAMP, KEY.previewId) !== "";
}

/**
 * Read a node's render provenance, or `undefined` when it carries none (a static
 * import). Malformed stored overrides degrade to an empty map rather than throw,
 * and a format other than `png`/`svg` falls back to `png`.
 */
export function readRenderSource(node: FigmaNode): RenderSource | undefined {
  const previewId = node.getSharedPluginData(STAMP, KEY.previewId);
  if (previewId === "") return undefined;

  const basePath = node.getSharedPluginData(STAMP, KEY.basePath);
  const rawFormat = node.getSharedPluginData(STAMP, KEY.format);
  const format: RenderFormat = rawFormat === "svg" ? "svg" : "png";

  const source: RenderSource = {
    serverBase: node.getSharedPluginData(STAMP, KEY.serverBase),
    token: node.getSharedPluginData(STAMP, KEY.token),
    previewId,
    overrides: parseOverrides(node.getSharedPluginData(STAMP, KEY.overrides)),
    format,
  };
  if (basePath !== "") source.basePath = basePath;
  return source;
}

/**
 * The URL to re-fetch to refresh `node` against current code, or `undefined`
 * when the node has no provenance (nothing to refresh — a static import).
 */
export function refreshUrl(node: FigmaNode): string | undefined {
  const source = readRenderSource(node);
  return source ? buildRenderUrl(source) : undefined;
}

function parseOverrides(raw: string): Record<string, string> {
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
