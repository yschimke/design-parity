/**
 * The **catalog → live** bridge — hand a picked catalog component to the Override
 * editor so browsing flows straight into live customization at a chosen size.
 *
 * The catalog pick gives *baked* renders (fixed sizes/variants); real
 * customization + arbitrary-size rendering is the Override editor (a live
 * `compose-preview serve` host). This module computes the handoff: from a picked
 * component (and, when the catalog carries it, an image's `livePreview` deep
 * link) it derives the server + system to prefill and the preview to select, so
 * the designer lands in the editor with the component teed up.
 *
 * Pure: no `figma`, no `fetch`, no DOM. The UI prefills the fields, switches
 * tabs, and — once previews load — selects {@link matchPreview}'s result.
 */
import type { Preview } from "./previews.js";

/** What the editor should prefill/select to customise a picked catalog component. */
export interface LiveBridgeTarget {
  /** The catalog `componentId` (for the fuzzy match + messaging). */
  componentId: string;
  /** System to load in the editor (from the catalog, or the deep link). */
  system: string;
  /** Serve host to prefill, when the catalog's `livePreview` carries one. */
  serverBase?: string;
  /** Exact serve preview id to select, when the deep link carries one. */
  previewId?: string;
}

/** A filesystem/route-safe slug for a component id (matches `catalog-export`'s `slug`). */
function slug(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "x"
  );
}

/**
 * Parse a catalog `livePreview` deep link — `<serverBase>/p/<previewId>?session=<system>`
 * (see `catalog-export`'s `livePreviewUrl`) — into its server base, preview id, and
 * system. Returns `undefined` when the URL isn't that shape.
 */
export function parseLivePreview(
  url: string,
): { serverBase: string; previewId: string; system: string } | undefined {
  const marker = url.indexOf("/p/");
  if (marker < 0) return undefined;
  const serverBase = url.slice(0, marker);
  const rest = url.slice(marker + 3);
  const q = rest.indexOf("?");
  const idPart = q >= 0 ? rest.slice(0, q) : rest;
  const query = q >= 0 ? rest.slice(q + 1) : "";
  const previewId = decodeURIComponent(idPart);
  const session = query
    .split("&")
    .map((kv) => kv.split("="))
    .find(([k]) => k === "session");
  const system = session ? decodeURIComponent(session[1] ?? "") : "";
  if (!serverBase || !previewId) return undefined;
  return { serverBase, previewId, system };
}

/**
 * Build the editor handoff for a picked component. When the selected image's
 * `livePreview` deep link is present it drives everything (server + system +
 * exact preview id); otherwise only the catalog `system` is known and the editor
 * relies on the {@link matchPreview} fuzzy match once the user supplies a host.
 */
export function liveBridgeTarget(
  componentId: string,
  system: string,
  livePreviewUrl?: string,
): LiveBridgeTarget {
  const target: LiveBridgeTarget = { componentId, system };
  const parsed = livePreviewUrl ? parseLivePreview(livePreviewUrl) : undefined;
  if (parsed) {
    target.serverBase = parsed.serverBase;
    target.previewId = parsed.previewId;
    if (parsed.system) target.system = parsed.system;
  }
  return target;
}

/**
 * Choose which loaded preview to select for a target: the **exact** id from the
 * deep link when it matches, else a best-effort match on the `componentId` — by
 * label equality, then the component slug against the preview id, then a loose
 * substring. `undefined` when nothing plausibly matches (the UI leaves the
 * selection alone and tells the user which component to pick).
 */
export function matchPreview(previews: Preview[], target: LiveBridgeTarget): Preview | undefined {
  if (target.previewId) {
    const exact = previews.find((p) => p.id === target.previewId);
    if (exact) return exact;
  }
  const id = target.componentId.toLowerCase();
  const s = slug(target.componentId);
  return (
    previews.find((p) => p.label.toLowerCase() === id) ??
    previews.find((p) => p.id.toLowerCase() === s || p.id.toLowerCase().startsWith(`${s}__`)) ??
    previews.find((p) => p.label.toLowerCase().includes(id) || p.id.toLowerCase().includes(s))
  );
}
