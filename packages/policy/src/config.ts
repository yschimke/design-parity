/**
 * `.design-parity.json` schema, loader, and validator.
 *
 * The parity config is the committed, per-repo policy file. Its lead field is
 * {@link ParityConfig.direction}; setup (issue #11) materializes a concrete
 * `design-led`/`code-led` value, and `auto` is the pre-setup default. It also
 * carries {@link ParityConfig.cmpCapable} and the
 * {@link ParityConfig.tokens} comparison policy. Read deterministically — never
 * decided at run time (docs/PRINCIPLES.md, Principle 1).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AjvModule, { type ValidateFunction } from "ajv";

import type {
  ParityConfig,
  ParityDirection,
  ParityTokenPolicy,
} from "@design-parity/core";
import schema from "../schema/parity-config.schema.json" with { type: "json" };

// ajv ships CJS; under NodeNext the constructable class can land on `.default`.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: <T>(schema: unknown) => ValidateFunction<T>;
};
const Ajv = ((AjvModule as unknown as { default?: AjvCtor }).default ??
  (AjvModule as unknown as AjvCtor)) as AjvCtor;

/** Conventional path (repo-relative) of the committed parity config. */
export const PARITY_CONFIG_FILENAME = ".design-parity.json";

/** The direction a repo has until setup materializes a concrete one. */
export const DEFAULT_DIRECTION: ParityDirection = "auto";

/** The config a repo has before any `.design-parity.json` is committed. */
export function defaultParityConfig(): ParityConfig {
  return { direction: DEFAULT_DIRECTION };
}

/** The JSON Schema (draft-07) for `.design-parity.json`, as a plain object. */
export const parityConfigSchema = schema;

/** Absolute path to the bundled schema file (useful for `$schema` refs). */
export const parityConfigSchemaPath = fileURLToPath(
  new URL("../schema/parity-config.schema.json", import.meta.url),
);

const ajv = new Ajv({ allErrors: true });
const validateFn: ValidateFunction<ParityConfig> =
  ajv.compile<ParityConfig>(schema);

export interface ValidationResult {
  valid: boolean;
  /** Human-readable errors, empty when valid. */
  errors: string[];
}

/** Validate an already-parsed value against the parity-config schema. */
export function validateParityConfig(value: unknown): ValidationResult {
  const valid = validateFn(value);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`,
  );
  return { valid: false, errors };
}

/** What {@link parse} hands {@link normalize} — the schema-validated shape. */
interface ParsedConfig {
  direction?: ParityDirection;
  cmpCapable?: boolean;
  tokens?: ParityTokenPolicy;
}

/** Fill omitted fields so callers always get a complete {@link ParityConfig}. */
function normalize(parsed: ParsedConfig): ParityConfig {
  const config: ParityConfig = { direction: parsed.direction ?? DEFAULT_DIRECTION };
  // Preserve the CMP capability flag verbatim when present; omitted stays
  // omitted (the Action only promotes when it's explicitly false, Principle 6).
  if (typeof parsed.cmpCapable === "boolean") config.cmpCapable = parsed.cmpCapable;
  // Token policy likewise: an omitted knob stays omitted rather than being
  // filled with today's default here, so the engine's committed default is the
  // single place that decides it and a repo's file never pins a value it didn't
  // ask for. `{}` is dropped for the same reason — it says nothing.
  const tokens: ParityTokenPolicy = {};
  if (parsed.tokens?.missingNumerics) tokens.missingNumerics = parsed.tokens.missingNumerics;
  if (parsed.tokens?.textDerivedInsets)
    tokens.textDerivedInsets = parsed.tokens.textDerivedInsets;
  if (parsed.tokens?.acceptedDifferences)
    tokens.acceptedDifferences = parsed.tokens.acceptedDifferences;
  if (Object.keys(tokens).length > 0) config.tokens = tokens;
  return config;
}

/**
 * Read, parse, and validate a `.design-parity.json` from disk. A present file
 * that omits `direction` normalizes to the `auto` default.
 *
 * @throws Error with a readable message if the file is missing, not JSON, or
 *   fails schema validation. Use {@link loadParityConfigOrDefault} when a
 *   missing file should fall back to the default instead.
 */
export async function loadParityConfig(path: string): Promise<ParityConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`parity-config: cannot read '${path}'`, { cause });
  }
  return parse(path, raw);
}

/**
 * Like {@link loadParityConfig}, but a *missing* file resolves to the `auto`
 * default rather than throwing — the deterministic behavior the Action relies
 * on for repos that wired up the bot without committing a config. A file that
 * exists but is malformed or schema-invalid still throws.
 */
export async function loadParityConfigOrDefault(
  path: string,
): Promise<ParityConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultParityConfig();
    }
    throw new Error(`parity-config: cannot read '${path}'`, { cause });
  }
  return parse(path, raw);
}

function parse(path: string, raw: string): ParityConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`parity-config: '${path}' is not valid JSON`, { cause });
  }

  const result = validateParityConfig(parsed);
  if (!result.valid) {
    throw new Error(
      `parity-config: '${path}' failed schema validation:\n  ${result.errors.join("\n  ")}`,
    );
  }
  return normalize(parsed as ParsedConfig);
}
