/**
 * The live-render client contract for `compose-preview serve` (the preview
 * server in **compose-ai-tools**, not this repo). The plugin is an HTTP client
 * of it: for the refreshable import modes (b: live PNG, c: live SVG) it rebuilds
 * a `/render/<id>.<fmt>` URL with the chosen overrides and re-fetches — the same
 * URL the server's own viewer builds.
 *
 * This module is **pure** — types + URL/override encoding, no `fetch`. It mirrors
 * the server's `ServeUrls.renderUrl` + `ServeOverrides` so the two can't drift;
 * {@link encodeSegment} matches the server's RFC-3986 `urlEncodeSegment`.
 *
 * A {@link RenderSource} is also the **provenance** stamped on an imported node
 * (via `setPluginData`) so a later Refresh re-renders it against updated code.
 */

/** `png` renders live today; `svg` awaits the serve SVG route (compose-ai-tools). */
export type RenderFormat = "png" | "svg";

/**
 * The fixed override knobs the serve `/render` endpoint accepts — mirrors
 * `ServeOverrides.SUPPORTED_KEYS`. Author-declared knobs use {@link KNOB_PREFIX}.
 */
export const SUPPORTED_OVERRIDE_KEYS = [
  "uiMode",
  "device",
  "localeTag",
  "fontScale",
  "density",
  "widthPx",
  "heightPx",
  "orientation",
  "inspectionMode",
] as const;
export type OverrideKey = (typeof SUPPORTED_OVERRIDE_KEYS)[number];

/** Prefix for author-declared named-override knobs: `knob.<wireKey>=<kind>:<value>`. */
export const KNOB_PREFIX = "knob.";

/** A knob kind, matching the server's `PreviewOverrideValue` kinds. */
export type KnobKind = "string" | "int" | "float" | "bool" | "color";

/** The query key for an author knob: `knob.<wireKey>`. */
export function knobKey(wireKey: string): string {
  return `${KNOB_PREFIX}${wireKey}`;
}

/** The `<kind>:<value>` payload the server parses for a knob override. */
export function knobValue(kind: KnobKind, value: string): string {
  return `${kind}:${value}`;
}

/** True for a key the server understands: a fixed key or a `knob.*`. */
export function isSupportedOverrideKey(key: string): boolean {
  return (
    (SUPPORTED_OVERRIDE_KEYS as readonly string[]).includes(key) ||
    key.startsWith(KNOB_PREFIX)
  );
}

/**
 * Everything needed to (re)build a render request — and thus the provenance a
 * refreshable node stores. `serverBase` is the origin (`http://host:port`);
 * `basePath` is the per-system mount segment (e.g. `compose-m3`) when the server
 * fronts several systems.
 */
export interface RenderSource {
  serverBase: string;
  basePath?: string;
  token: string;
  previewId: string;
  /** Override key → value (fixed keys + `knob.<k>`). Blank values are dropped. */
  overrides: Record<string, string>;
  format: RenderFormat;
}

/**
 * Percent-encode a string as one URL path/query segment, byte-for-byte matching
 * the server's `WebEscaping.urlEncodeSegment` (RFC 3986: everything outside
 * `A-Za-z0-9-_.~` becomes `%XX`). `encodeURIComponent` leaves `!'()*` unescaped,
 * so those are encoded explicitly.
 */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Drop blank-valued overrides, as the server's `renderUrl` does. */
export function nonBlankOverrides(overrides: Record<string, string>): [string, string][] {
  return Object.entries(overrides).filter(([, v]) => v.trim() !== "");
}

/**
 * Build the `/render/<id>.<fmt>` URL for a {@link RenderSource} (pure). Mirrors
 * `ServeUrls.renderUrl`: the id is a percent-encoded path segment, the token and
 * each override *value* are percent-encoded (keys are passed through, as the
 * server does), blank overrides are dropped. Override order is preserved.
 */
export function buildRenderUrl(source: RenderSource): string {
  const origin = source.serverBase.replace(/\/+$/, "");
  const mount = source.basePath
    ? `/${source.basePath.replace(/^\/+|\/+$/g, "")}`
    : "";
  const query = [
    `token=${encodeSegment(source.token)}`,
    ...nonBlankOverrides(source.overrides).map(
      ([k, v]) => `${k}=${encodeSegment(v)}`,
    ),
  ].join("&");
  return `${origin}${mount}/render/${encodeSegment(source.previewId)}.${source.format}?${query}`;
}
