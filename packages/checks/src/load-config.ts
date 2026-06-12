/**
 * `design-parity.checks.json` schema, loader, and validator.
 *
 * The checks config is the committed, per-repo a11y + i18n policy file.
 * `@design-parity/baseline` materializes a starter file during bootstrap; this
 * module loads it at run time so its tuned thresholds (contrast level,
 * touch-target min, hardcoded-string opt-in, themes) actually reach the engine
 * instead of being inert. Read deterministically — never decided at run time
 * (docs/PRINCIPLES.md, Principle 1).
 *
 * Mirrors `@design-parity/policy`'s `loadParityConfig` /
 * `loadParityConfigOrDefault` and `@design-parity/core`'s design-map loader.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AjvModule, { type ValidateFunction } from "ajv";

import schema from "../schema/checks-config.schema.json" with { type: "json" };
import { type ChecksConfig, resolveConfig } from "./config.js";

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/** Conventional path (repo-relative) of the committed checks config. */
export const CHECKS_CONFIG_FILENAME = "design-parity.checks.json";

/**
 * The config a repo has before any `design-parity.checks.json` is committed:
 * an empty object, which {@link resolveConfig} fills with committed defaults.
 * A repo in steady state with no setup still works.
 */
export function defaultChecksConfig(): ChecksConfig {
  return {};
}

/** The JSON Schema (draft-07) for `design-parity.checks.json`, as an object. */
export const checksConfigSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const checksConfigSchemaPath = fileURLToPath(
  new URL("../schema/checks-config.schema.json", import.meta.url),
);

const ajv = new Ajv({ allErrors: true });
const validateFn: ValidateFunction<ChecksConfig> =
  ajv.compile<ChecksConfig>(schema);

export interface ValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the checks-config schema. */
export function validateChecksConfig(value: unknown): ValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

/** Strip the `$schema` self-reference; it isn't part of {@link ChecksConfig}. */
function normalize(parsed: Record<string, unknown>): ChecksConfig {
  const { $schema: _schema, ...rest } = parsed;
  return rest as ChecksConfig;
}

/**
 * Read, parse, and validate a `design-parity.checks.json` from disk.
 *
 * @throws Error with a readable message if the file is missing, not JSON, or
 *   fails schema validation. Use {@link loadChecksConfigOrDefault} when a
 *   missing file should fall back to committed defaults instead.
 */
export async function loadChecksConfig(path: string): Promise<ChecksConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`checks-config: cannot read '${path}'`, { cause });
  }
  return parse(path, raw);
}

/**
 * Like {@link loadChecksConfig}, but a *missing* file resolves to the committed
 * defaults rather than throwing — the deterministic behavior the Action relies
 * on for repos that wired up the bot without running setup. A file that exists
 * but is malformed or schema-invalid still throws.
 */
export async function loadChecksConfigOrDefault(
  path: string,
): Promise<ChecksConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultChecksConfig();
    }
    throw new Error(`checks-config: cannot read '${path}'`, { cause });
  }
  return parse(path, raw);
}

function parse(path: string, raw: string): ChecksConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`checks-config: '${path}' is not valid JSON`, { cause });
  }

  const result = validateChecksConfig(parsed);
  if (!result.valid) {
    throw new Error(
      `checks-config: '${path}' failed schema validation:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return normalize(parsed as Record<string, unknown>);
}

export { resolveConfig };
