/**
 * Reading a committed kit index, with the schema enforced on the way in.
 *
 * Validation matters more here than for a hand-authored file, not less. The
 * index is generated, so nobody proof-reads it; the failure mode of a
 * half-written or stale-shaped index is a resolver that silently finds nothing
 * and a report that says "no counterpart in the kit" about a kit full of
 * counterparts.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import AjvModule, { type ValidateFunction } from "ajv";

import type { KitIndex } from "./types.js";
import schema from "../schema/kit-index.schema.json" with { type: "json" };

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/** The conventional filename, so callers agree without restating it. */
export const KIT_INDEX_FILENAME = "figma-kit-index.json";

/** The JSON Schema (draft-07) for the kit index, as a plain object. */
export const kitIndexSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const kitIndexSchemaPath = fileURLToPath(
  new URL("../schema/kit-index.schema.json", import.meta.url),
);

// `allowUnionTypes` because a component property's `default` is genuinely
// either a boolean or a string — the kit's own type system says so, and
// splitting it into a `oneOf` would describe the same thing less clearly.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateFn: ValidateFunction<KitIndex> = ajv.compile<KitIndex>(schema);

export interface ValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the kit-index schema. */
export function validateKitIndex(value: unknown): ValidationResult {
  if (validateFn(value)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validateFn.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
    ),
  };
}

/** Parse and validate kit-index JSON text. */
export function parseKitIndex(raw: string, label = "<input>"): KitIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`kit-index: '${label}' is not valid JSON`, { cause });
  }
  const result = validateKitIndex(parsed);
  if (!result.valid) {
    throw new Error(
      `kit-index: '${label}' failed schema validation:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return parsed as KitIndex;
}

/**
 * Read, parse and validate a kit index from disk.
 *
 * @throws Error with a readable message if the file is missing, not JSON, or
 *   fails schema validation.
 */
export async function loadKitIndex(path: string): Promise<KitIndex> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`kit-index: cannot read '${path}'`, { cause });
  }
  return parseKitIndex(raw, path);
}
