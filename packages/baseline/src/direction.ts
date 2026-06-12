/**
 * Materialize the parity direction from a maturity rung (Principle 5).
 *
 * The resolution itself lives in `@design-parity/policy` — setup and the
 * Action's late fallback must agree, so there's exactly one implementation.
 * Baseline just applies it at bootstrap time and commits the concrete result,
 * so steady state never carries `auto`.
 */
import type { MaturityRung, ParityConfig, ResolvedDirection } from "@design-parity/core";
import { defaultParityConfig, materializeDirection, resolveAuto } from "@design-parity/policy";

/** The concrete direction a given rung materializes to (via `policy`). */
export function directionForRung(rung: MaturityRung): ResolvedDirection {
  return resolveAuto(rung);
}

/** Build the committed {@link ParityConfig} for a rung — never leaves `auto`. */
export function parityConfigForRung(rung: MaturityRung): ParityConfig {
  return materializeDirection(defaultParityConfig(), rung);
}
