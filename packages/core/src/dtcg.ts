/**
 * W3C DTCG token-document reader, loader, and validator.
 *
 * The design-token ecosystem has converged on the DTCG (Design Tokens Community
 * Group) JSON format: Figma Variables export to it, Tokens Studio is native to
 * it, Style Dictionary consumes it. A token value (colour / dimension / type) is
 * platform-neutral, so design-parity accepts DTCG on the **reference** side as a
 * standards-based token-spec format (issue #89) and normalizes it into the
 * source-agnostic {@link DesignTokens} the diff engine already consumes.
 *
 * This module is deliberately **format-only**: it gets standard token data into
 * the engine. It does *not* map design-system token names onto Material/Compose
 * semantic roles — that's the role-mapping layer in issue #87, which consumes
 * the {@link DesignTokens} produced here.
 *
 * A DTCG document is a tree of nodes. A *token* node carries `$value` (and
 * optionally `$type`); a *group* node nests further nodes and may declare a
 * `$type` its descendants inherit. Token names are the node path joined with
 * `/` (`color/on-surface`), matching the slash-separated vocabulary the alias
 * map and token-compliance diff already use. Alias values (`"{group.token}"`)
 * are resolved against the document, with chains and cycles handled.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AjvModule, { type ValidateFunction } from "ajv";

import type { DesignTokens, TypographyToken } from "./types.js";
import schema from "../schema/dtcg-tokens.schema.json" with { type: "json" };

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/** The JSON Schema (draft-07) for a DTCG token document, as a plain object. */
export const dtcgTokensSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const dtcgTokensSchemaPath = fileURLToPath(
  new URL("../schema/dtcg-tokens.schema.json", import.meta.url),
);

const ajv = new Ajv({ allErrors: true });
const validateFn: ValidateFunction = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the DTCG token schema. */
export function validateDtcgTokens(value: unknown): ValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

/**
 * The outcome of reading a DTCG document. `tokens` is the normalized bag; a
 * token design-parity can't route (unknown `$type`, unresolved alias, a value
 * it can't normalize) is **skipped softly** and recorded in `warnings` rather
 * than aborting the read — a partial reference is more useful than none.
 */
export interface DtcgReadResult {
  tokens: DesignTokens;
  warnings: string[];
}

/** A DTCG node is a plain JSON object; a token node additionally has `$value`. */
type Node = Record<string, unknown>;

function isObject(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenNode(value: unknown): value is Node {
  return isObject(value) && "$value" in value;
}

/** `true` for the `$`-prefixed reserved keys (metadata, not child nodes). */
function isReserved(key: string): boolean {
  return key.startsWith("$");
}

const ALIAS = /^\{(.+)\}$/;

/** A value is an alias reference when it's a `"{dot.path}"` string. */
function aliasPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = ALIAS.exec(value.trim());
  return m ? m[1] : undefined;
}

interface IndexEntry {
  node: Node;
  /** Effective `$type`: the token's own, else the nearest ancestor group's. */
  type?: string;
}

/** Index every token node by its dot-path, threading inherited `$type`. */
function indexTokens(root: Node): Map<string, IndexEntry> {
  const index = new Map<string, IndexEntry>();
  const walk = (node: Node, path: string[], inherited?: string): void => {
    const groupType = typeof node.$type === "string" ? node.$type : inherited;
    if (isTokenNode(node)) {
      index.set(path.join("."), { node, type: groupType });
    }
    for (const [key, child] of Object.entries(node)) {
      if (isReserved(key) || !isObject(child)) continue;
      walk(child, [...path, key], groupType);
    }
  };
  walk(root, []);
  return index;
}

/** A fully de-aliased token value plus the type to route it under. */
interface Resolved {
  value: unknown;
  type?: string;
}

/**
 * Resolve a `$value`, following alias chains. `declaredType` is the resolving
 * token's effective type; an alias token with no type of its own inherits the
 * referenced token's type. `seen` guards against cycles. Unresolved refs and
 * cycles append a warning and yield an `undefined` value.
 */
function resolveValue(
  value: unknown,
  declaredType: string | undefined,
  index: Map<string, IndexEntry>,
  warnings: string[],
  seen: ReadonlySet<string>,
): Resolved {
  const path = aliasPath(value);
  if (path === undefined) return { value, type: declaredType };
  if (seen.has(path)) {
    warnings.push(`alias cycle at '{${path}}'`);
    return { value: undefined, type: declaredType };
  }
  const target = index.get(path);
  if (!target) {
    warnings.push(`unresolved alias '{${path}}'`);
    return { value: undefined, type: declaredType };
  }
  const next = resolveValue(
    target.node.$value,
    target.type,
    index,
    warnings,
    new Set(seen).add(path),
  );
  return { value: next.value, type: declaredType ?? next.type };
}

/** Read a DTCG colour value: a hex/CSS string, or an object with a `hex`. */
function normalizeColor(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isObject(value) && typeof value.hex === "string") return value.hex;
  return undefined;
}

/**
 * Read a DTCG dimension/number into a plain number. Accepts a bare number, a
 * unit string (`"16px"`, `"1.5rem"`), and the object form (`{value, unit}`).
 */
function normalizeDimension(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (isObject(value) && typeof value.value === "number") return value.value;
  return undefined;
}

/** Corner-radius-shaped names route into `radius`; every other dimension is spacing. */
function isRadiusName(name: string): boolean {
  return /(?:radius|corner|rounding)/i.test(name);
}

const FONT_FAMILY = "fontFamily";
const FONT_SIZE = "fontSize";
const FONT_WEIGHT = "fontWeight";
const LINE_HEIGHT = "lineHeight";
const LETTER_SPACING = "letterSpacing";

/** Build a {@link TypographyToken} from a resolved composite-typography object. */
function buildTypography(
  value: unknown,
  index: Map<string, IndexEntry>,
  warnings: string[],
): TypographyToken | undefined {
  if (!isObject(value)) return undefined;
  const field = (key: string): unknown =>
    resolveValue(value[key], undefined, index, warnings, new Set()).value;

  const out: TypographyToken = {};
  const family = field(FONT_FAMILY);
  if (typeof family === "string") out.fontFamily = family;
  else if (Array.isArray(family) && typeof family[0] === "string")
    out.fontFamily = family[0];

  const size = normalizeDimension(field(FONT_SIZE));
  if (size !== undefined) out.fontSize = size;

  const weight = field(FONT_WEIGHT);
  if (typeof weight === "number" || typeof weight === "string")
    out.fontWeight = weight;

  const line = normalizeDimension(field(LINE_HEIGHT));
  if (line !== undefined) out.lineHeight = line;

  const tracking = normalizeDimension(field(LETTER_SPACING));
  if (tracking !== undefined) out.letterSpacing = tracking;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Read a DTCG token document into the normalized {@link DesignTokens} bag.
 *
 * `color` tokens land in `colors`; `dimension`/`number` tokens land in `radius`
 * when their name is corner-radius-shaped and `spacing` otherwise (DTCG has one
 * `dimension` type with no spacing-vs-radius distinction — the role-mapping
 * layer, issue #87, refines this); composite `typography` tokens land in
 * `typography`. A token with an unknown/absent `$type`, an unresolved alias, or
 * a value that won't normalize is skipped and noted in `warnings`.
 *
 * @throws if the document root is not a JSON object.
 */
export function readDtcgTokens(doc: unknown): DtcgReadResult {
  if (!isObject(doc)) {
    throw new Error("dtcg: token document must be a JSON object");
  }
  const index = indexTokens(doc);
  const tokens: DesignTokens = {};
  const warnings: string[] = [];

  for (const [path, entry] of index) {
    const name = path.replace(/\./g, "/");
    const { value, type } = resolveValue(
      entry.node.$value,
      entry.type,
      index,
      warnings,
      new Set([path]),
    );
    if (value === undefined) continue; // alias warning already recorded

    switch (type) {
      case "color": {
        const color = normalizeColor(value);
        if (color === undefined) warnings.push(`${name}: unreadable color value`);
        else (tokens.colors ??= {})[name] = color;
        break;
      }
      case "dimension":
      case "number": {
        const dim = normalizeDimension(value);
        if (dim === undefined) {
          warnings.push(`${name}: unreadable dimension value`);
        } else if (isRadiusName(name)) {
          (tokens.radius ??= {})[name] = dim;
        } else {
          (tokens.spacing ??= {})[name] = dim;
        }
        break;
      }
      case "typography": {
        const typo = buildTypography(value, index, warnings);
        if (typo === undefined) warnings.push(`${name}: unreadable typography value`);
        else (tokens.typography ??= {})[name] = typo;
        break;
      }
      default:
        warnings.push(
          `${name}: ${type ? `unsupported $type '${type}'` : "missing $type"}, skipped`,
        );
    }
  }

  return { tokens, warnings };
}

/**
 * Read, parse, schema-validate, and normalize a DTCG token file from disk.
 *
 * @throws Error with a readable message if the file is missing, not JSON, or
 *   fails schema validation. A structurally valid document with individual
 *   unreadable tokens does not throw — those surface in {@link DtcgReadResult.warnings}.
 */
export async function loadDtcgTokens(path: string): Promise<DtcgReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`dtcg: cannot read '${path}'`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`dtcg: '${path}' is not valid JSON`, { cause });
  }

  const result = validateDtcgTokens(parsed);
  if (!result.valid) {
    throw new Error(
      `dtcg: '${path}' failed schema validation:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return readDtcgTokens(parsed);
}

/** The `$id` of the bundled DTCG schema, emitted as the document's `$schema`. */
const DTCG_SCHEMA_ID = (dtcgTokensSchema as { $id?: string }).$id ?? "";

/** A DTCG token node: a `$type` tag plus its `$value`. */
interface DtcgTokenNode {
  $type: string;
  $value: unknown;
}

/** Build a DTCG group (name → token node) from a {@link DesignTokens} bag, or
 *  `undefined` when the bag is absent/empty so the group is omitted entirely. */
function dtcgGroup<T>(
  bag: Record<string, T> | undefined,
  node: (value: T) => DtcgTokenNode,
): Record<string, DtcgTokenNode> | undefined {
  if (!bag) return undefined;
  const entries = Object.entries(bag);
  if (entries.length === 0) return undefined;
  const out: Record<string, DtcgTokenNode> = {};
  for (const [name, value] of entries) out[name] = node(value);
  return out;
}

/** A composite-typography `$value` carrying every field the token declares. */
function dtcgTypographyValue(token: TypographyToken): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(token)) {
    if (v !== undefined) value[key] = v;
  }
  return value;
}

/**
 * Serialize a {@link DesignTokens} bag into a W3C DTCG token document — the
 * inverse of {@link readDtcgTokens}.
 *
 * Each category becomes its own top-level group (`color`, `spacing`, `radius`,
 * `type`) rather than a flat list, so the two dimension categories round-trip
 * to the right bag: a `radius/*` token name routes back to `radius` and a
 * `spacing/*` name to `spacing` (DTCG has one `dimension` type, and the reader
 * keys radius-vs-spacing off the token name). Names that already carry a `/`
 * stay verbatim under their group.
 *
 * Emitting DTCG (rather than the raw `DesignTokens` shape) makes the output a
 * standards-based file any DTCG consumer reads — Style Dictionary, Tokens
 * Studio, Claude Design's import — not just design-parity. The result is plain
 * JSON-serializable data; callers `JSON.stringify` it.
 */
export function tokensToDtcg(tokens: DesignTokens): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  if (DTCG_SCHEMA_ID) doc.$schema = DTCG_SCHEMA_ID;

  const color = dtcgGroup(tokens.colors, (v) => ({ $type: "color", $value: v }));
  if (color) doc.color = color;
  const spacing = dtcgGroup(tokens.spacing, (v) => ({ $type: "dimension", $value: v }));
  if (spacing) doc.spacing = spacing;
  const radius = dtcgGroup(tokens.radius, (v) => ({ $type: "dimension", $value: v }));
  if (radius) doc.radius = radius;
  const type = dtcgGroup(tokens.typography, (t) => ({
    $type: "typography",
    $value: dtcgTypographyValue(t),
  }));
  if (type) doc.type = type;

  return doc;
}
