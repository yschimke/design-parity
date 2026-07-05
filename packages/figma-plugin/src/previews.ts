/**
 * The `/api/previews` client model — the discovery half of the override editor.
 *
 * `compose-preview serve` (compose-ai-tools) exposes, at `serveSchema`
 * **`compose-preview-serve/v2`**, a JSON list of a system's previews and, per
 * preview, its author-declared editable **knobs** (`PreviewOverrideDeclaration`).
 * The override editor lists those knobs, collects edited values, and turns them
 * into a {@link RenderSource} the live-render client re-fetches. That mapping —
 * editor state → render request — is the testable core here; the UI is glue.
 *
 * Pure: types + parsing + URL/override encoding, no `fetch`. Types mirror the
 * server's DTOs; the knob wire-encoding composes `render.ts`.
 */
import {
  knobKey,
  knobValue,
  type KnobKind,
  type OverrideKey,
  type RenderFormat,
  type RenderSource,
  encodeSegment,
} from "./render.js";

/** The `serveSchema` at which `/api/previews` carries override declarations. */
export const SERVE_SCHEMA_V2 = "compose-preview-serve/v2";

/** Whether a server's `serveSchema` (from `/version`) serves override declarations. */
export function servesOverrides(serveSchema: string): boolean {
  return serveSchema === SERVE_SCHEMA_V2;
}

/**
 * A knob's value, discriminated by `type` — mirrors the server's sealed
 * `PreviewOverrideValue`. Colours carry `argb` (`#AARRGGBB`); the rest carry
 * `value`.
 */
export type OverrideValue =
  | { type: "string"; value: string }
  | { type: "int"; value: number }
  | { type: "float"; value: number }
  | { type: "bool"; value: boolean }
  | { type: "color"; argb: string };

/** One author-declared editable knob a preview exposes (`compose/overrides`). */
export interface OverrideDeclaration {
  /** Author key, e.g. `"label"` or `"rowCount"`. */
  key: string;
  /** The control kind — a {@link KnobKind}, picking the widget + wire encoding. */
  type: KnobKind;
  /** Human label for the control (defaults to `key` server-side). */
  label: string;
  /** The fallback value with no override applied. */
  default: OverrideValue;
  /** The value after the latest render, when the server knows it. */
  current?: OverrideValue;
  /** Present for one instance of a repeated/indexed knob. */
  index?: number | null;
}

/** One servable preview in a system. */
export interface Preview {
  id: string;
  label: string;
  modes: string[];
  overrides: OverrideDeclaration[];
}

/** The `/api/previews` response. */
export interface PreviewsResponse {
  schema: string;
  module: string;
  /** Producer-trust verdict for a bundle/catalog session; absent for a live module. */
  trust?: string | null;
  previews: Preview[];
}

/**
 * The API URL for a system's previews on a serve host: `<base>[/system]/api/previews`
 * with the token in the query when the server is token-gated (public servers omit it).
 */
export function previewsUrl(serverBase: string, system: string, token?: string): string {
  const origin = serverBase.replace(/\/+$/, "");
  const mount = system ? `/${encodeSegment(system)}` : "";
  const query = token ? `?token=${encodeSegment(token)}` : "";
  return `${origin}${mount}/api/previews${query}`;
}

/** The composite wire key the server seeds a knob against: `key` or `key[index]`. */
export function seedKey(declaration: OverrideDeclaration): string {
  return declaration.index == null
    ? declaration.key
    : `${declaration.key}[${declaration.index}]`;
}

/** A knob value rendered as the editable text a control seeds from / collects. */
export function overrideValueText(value: OverrideValue): string {
  return value.type === "color" ? value.argb : String(value.value);
}

/** The text a knob's control should start from — its current value, else its default. */
export function declarationText(declaration: OverrideDeclaration): string {
  return overrideValueText(declaration.current ?? declaration.default);
}

/**
 * Map edited knob text (keyed by {@link seedKey}) onto the override bag the render
 * URL takes: `knob.<seedKey> = <kind>:<text>` for each declaration whose edit is
 * present and non-blank. Unedited / blank knobs are dropped so the render keeps
 * their declared defaults.
 */
export function knobOverrides(
  declarations: OverrideDeclaration[],
  edits: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const declaration of declarations) {
    const key = seedKey(declaration);
    const text = edits[key];
    if (text === undefined || text.trim() === "") continue;
    out[knobKey(key)] = knobValue(declaration.type, text);
  }
  return out;
}

/** Options for turning a preview + editor state into a render request. */
export interface RenderSourceOptions {
  serverBase: string;
  /** Per-system mount segment (e.g. `compose-m3`), when the server fronts several. */
  basePath?: string;
  token: string;
  format: RenderFormat;
  /** Edited knob text keyed by {@link seedKey}. */
  knobEdits?: Record<string, string>;
  /** Fixed display axes (uiMode / fontScale / device / …) the editor also exposes. */
  axes?: Partial<Record<OverrideKey, string>>;
}

/**
 * Build the {@link RenderSource} for a preview at the editor's current state:
 * the preview id, the server coordinates, and the merged override bag (knob
 * edits + fixed axes). The result both drives the live fetch and, stamped on the
 * imported node, powers a later Refresh.
 */
export function renderSourceForPreview(
  preview: Preview,
  opts: RenderSourceOptions,
): RenderSource {
  const overrides: Record<string, string> = {
    ...knobOverrides(preview.overrides, opts.knobEdits ?? {}),
  };
  for (const [key, value] of Object.entries(opts.axes ?? {})) {
    if (value !== undefined && value.trim() !== "") overrides[key] = value;
  }
  const source: RenderSource = {
    serverBase: opts.serverBase,
    token: opts.token,
    previewId: preview.id,
    overrides,
    format: opts.format,
  };
  if (opts.basePath) source.basePath = opts.basePath;
  return source;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverrideValue(raw: unknown): OverrideValue | undefined {
  if (!isObject(raw) || typeof raw.type !== "string") return undefined;
  switch (raw.type) {
    case "string":
      return { type: "string", value: String(raw.value ?? "") };
    case "int":
      return { type: "int", value: Number(raw.value ?? 0) };
    case "float":
      return { type: "float", value: Number(raw.value ?? 0) };
    case "bool":
      return { type: "bool", value: Boolean(raw.value) };
    case "color":
      return { type: "color", argb: String(raw.argb ?? "") };
    default:
      return undefined;
  }
}

const KNOB_KINDS: readonly string[] = ["string", "int", "float", "bool", "color"];

function parseDeclaration(raw: unknown): OverrideDeclaration | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.key !== "string" || typeof raw.type !== "string") return undefined;
  if (!KNOB_KINDS.includes(raw.type)) return undefined;
  const def = parseOverrideValue(raw.default);
  if (def === undefined) return undefined;
  const declaration: OverrideDeclaration = {
    key: raw.key,
    type: raw.type as KnobKind,
    label: typeof raw.label === "string" ? raw.label : raw.key,
    default: def,
  };
  const current = parseOverrideValue(raw.current);
  if (current) declaration.current = current;
  if (typeof raw.index === "number") declaration.index = raw.index;
  return declaration;
}

/**
 * Parse a `/api/previews` JSON body into a {@link PreviewsResponse} (defensive:
 * a missing/malformed `overrides` degrades to `[]`, unknown knob kinds are
 * dropped, so an older/partial server never throws). Returns `undefined` when
 * the body isn't a previews response at all.
 */
export function parsePreviewsResponse(json: unknown): PreviewsResponse | undefined {
  if (!isObject(json) || !Array.isArray(json.previews)) return undefined;
  const previews: Preview[] = [];
  for (const raw of json.previews) {
    if (!isObject(raw) || typeof raw.id !== "string") continue;
    const overrides = Array.isArray(raw.overrides)
      ? raw.overrides.map(parseDeclaration).filter((d): d is OverrideDeclaration => d !== undefined)
      : [];
    previews.push({
      id: raw.id,
      label: typeof raw.label === "string" ? raw.label : raw.id,
      modes: Array.isArray(raw.modes) ? raw.modes.filter((m): m is string => typeof m === "string") : [],
      overrides,
    });
  }
  const response: PreviewsResponse = {
    schema: typeof json.schema === "string" ? json.schema : "",
    module: typeof json.module === "string" ? json.module : "",
    previews,
  };
  if (typeof json.trust === "string") response.trust = json.trust;
  return response;
}
