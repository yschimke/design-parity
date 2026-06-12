/**
 * `@design-parity/policy` — the parity *direction* policy.
 *
 * Owns the committed `.design-parity.json` config (schema, loader, validator
 * CLI) and the deterministic resolver that turns `auto` into a concrete
 * `design-led`/`code-led` from the repo's maturity rung. Depends only on
 * `@design-parity/core`.
 */
export type { ValidationResult } from "./config.js";
export {
  PARITY_CONFIG_FILENAME,
  DEFAULT_DIRECTION,
  defaultParityConfig,
  parityConfigSchema,
  parityConfigSchemaPath,
  validateParityConfig,
  loadParityConfig,
  loadParityConfigOrDefault,
} from "./config.js";

export type { DirectionPolicy } from "./direction.js";
export {
  resolveAuto,
  resolveDirection,
  materializeDirection,
  directionPolicy,
} from "./direction.js";
