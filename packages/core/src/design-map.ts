/**
 * `design-map.json` types, loader, and validator.
 *
 * The design-map is the manifest correspondence layer: it links a code
 * component to a design reference for sources that have no machine link
 * (Stitch, Claude Design), and can override Code Connect for Figma.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AjvModule, { type ValidateFunction } from "ajv";

import type { DesignSource } from "./types.js";
import schema from "../schema/design-map.schema.json" with { type: "json" };

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/** One manifest entry: code handle → design reference. */
export interface DesignMapEntry {
  /** Code handle, e.g. `"ui/Button.kt#PrimaryButton"`. */
  code: string;
  source: DesignSource;
  /** Source-specific reference handle (see schema for per-source format). */
  ref: string;
  /**
   * Optional compose-ai-tools preview id (`"a.b.C.fn"`) this code handle
   * renders as. The authoritative link between a preview-bundle / daemon
   * candidate (keyed by preview id) and this reference (keyed by code handle) —
   * see issue #44. When omitted, the resolver falls back to a low-confidence
   * convention (`sourceFile#functionName`).
   */
  previewId?: string;
}

export interface DesignMap {
  $schema?: string;
  components: DesignMapEntry[];
}

/** The JSON Schema (draft-07) for `design-map.json`, as a plain object. */
export const designMapSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const designMapSchemaPath = fileURLToPath(
  new URL("../schema/design-map.schema.json", import.meta.url),
);

const ajv = new Ajv({ allErrors: true });
const validateFn: ValidateFunction<DesignMap> =
  ajv.compile<DesignMap>(schema);

export interface ValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the design-map schema. */
export function validateDesignMap(value: unknown): ValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

/**
 * Read, parse, and validate a `design-map.json` from disk.
 *
 * @throws Error with a readable message if the file is missing, not JSON, or
 *   fails schema validation.
 */
export async function loadDesignMap(path: string): Promise<DesignMap> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`design-map: cannot read '${path}'`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`design-map: '${path}' is not valid JSON`, { cause });
  }

  const result = validateDesignMap(parsed);
  if (!result.valid) {
    throw new Error(
      `design-map: '${path}' failed schema validation:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return parsed as DesignMap;
}

/** Look up the manifest entry for a code handle, or `undefined`. */
export function findByCode(
  map: DesignMap,
  code: string,
): DesignMapEntry | undefined {
  return map.components.find((c) => c.code === code);
}
