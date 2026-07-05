/**
 * The `/render/<id>.slots` client model — the structured-screen half of the plugin.
 *
 * `compose-preview serve` (compose-ai-tools) exposes, at `/render/<id>.slots`, the
 * named, bounded **slot** regions a preview's author marked: a `dp-slot:<name>`
 * testTag captured into the semantics tree *with its bounds*. A structured-screen
 * builder reads these to place slot frames and size children to fill them — each
 * slot's box (absolute-to-root px) is the size a child rendered to fill it should get.
 *
 * Pure: types + URL building + response parsing, no `fetch`. Types mirror the
 * server's `PreviewSlotsPayload` (data-layoutinspector-core `PreviewSlots.kt`); the
 * URL composes {@link ./render.js} so the slots lane and the render lane can't drift.
 */
import { type RenderSource, encodeSegment, nonBlankOverrides } from "./render.js";

/** A slot's box in absolute-to-root px — mirrors the server's `SlotBounds`. */
export interface SlotBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One named slot region — its author-declared name and its box. */
export interface PreviewSlot {
  name: string;
  bounds: SlotBounds;
}

/** The `/render/<id>.slots` response — mirrors the server's `PreviewSlotsPayload`. */
export interface PreviewSlots {
  previewId: string;
  slots: PreviewSlot[];
}

/** A slot box's width in px. */
export function slotWidth(slot: PreviewSlot): number {
  return slot.bounds.right - slot.bounds.left;
}

/** A slot box's height in px. */
export function slotHeight(slot: PreviewSlot): number {
  return slot.bounds.bottom - slot.bounds.top;
}

/**
 * Build the `/render/<id>.slots` URL for a {@link RenderSource} (pure). Mirrors
 * {@link buildRenderUrl} but targets the slots lane, so `source.format` is ignored —
 * slots are metadata about a preview, not a render format. Same id/token/override
 * encoding as the render URL (the server parses the same query for every suffix), so
 * the two stay in lockstep.
 */
export function buildSlotsUrl(source: RenderSource): string {
  const origin = source.serverBase.replace(/\/+$/, "");
  const mount = source.basePath
    ? `/${source.basePath.replace(/^\/+|\/+$/g, "")}`
    : "";
  const query = [
    `token=${encodeSegment(source.token)}`,
    ...nonBlankOverrides(source.overrides).map(([k, v]) => `${k}=${encodeSegment(v)}`),
  ].join("&");
  return `${origin}${mount}/render/${encodeSegment(source.previewId)}.slots?${query}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBounds(raw: unknown): SlotBounds | undefined {
  if (!isObject(raw)) return undefined;
  const { left, top, right, bottom } = raw;
  if (
    typeof left !== "number" ||
    typeof top !== "number" ||
    typeof right !== "number" ||
    typeof bottom !== "number" ||
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom)
  ) {
    return undefined;
  }
  return { left, top, right, bottom };
}

function parseSlot(raw: unknown): PreviewSlot | undefined {
  if (!isObject(raw) || typeof raw.name !== "string" || raw.name === "") return undefined;
  const bounds = parseBounds(raw.bounds);
  if (bounds === undefined) return undefined;
  return { name: raw.name, bounds };
}

/**
 * Parse a `/render/<id>.slots` JSON body into {@link PreviewSlots} (defensive: a slot
 * with a blank name or malformed bounds is dropped, mirroring the server's
 * `extractSlots`, so a partial/garbled body never throws). Returns `undefined` when
 * the body isn't a slots response at all (no `slots` array).
 */
export function parseSlotsResponse(json: unknown): PreviewSlots | undefined {
  if (!isObject(json) || !Array.isArray(json.slots)) return undefined;
  const slots = json.slots
    .map(parseSlot)
    .filter((s): s is PreviewSlot => s !== undefined);
  return {
    previewId: typeof json.previewId === "string" ? json.previewId : "",
    slots,
  };
}
