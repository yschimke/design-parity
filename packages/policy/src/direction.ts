/**
 * Parity direction resolution and the behavior it drives.
 *
 * Pure and deterministic — no network, no model (docs/PRINCIPLES.md,
 * Principle 1). The same {@link resolveDirection} both *materializes* the
 * committed value at setup (issue #11) and serves as the Action's late
 * *fallback* (issue #8) when a repo wired up the bot without running setup.
 */
import type {
  MaturityRung,
  ParityConfig,
  ResolvedDirection,
} from "@design-parity/core";

/**
 * Map a maturity rung to the direction `auto` resolves to: `design-led` only
 * when there's a machine link (Figma + Code Connect), `code-led` otherwise —
 * so a freshly bootstrapped repo is `code-led` by construction
 * (docs/PRINCIPLES.md, Principle 5).
 */
export function resolveAuto(rung: MaturityRung): ResolvedDirection {
  return rung === "machine-link" ? "design-led" : "code-led";
}

/**
 * Resolve a config's {@link ParityConfig.direction} to a concrete
 * {@link ResolvedDirection}.
 *
 * An explicit `design-led`/`code-led` is used **verbatim** — never
 * re-resolved against the rung. Only `auto` consults the rung (via
 * {@link resolveAuto}); the `rung` argument is otherwise ignored.
 */
export function resolveDirection(
  config: ParityConfig,
  rung: MaturityRung,
): ResolvedDirection {
  if (config.direction === "auto") return resolveAuto(rung);
  return config.direction;
}

/**
 * Return a copy of `config` with `direction` materialized to a concrete value
 * — what setup commits so a configured repo never re-resolves at run time. A
 * config that is already explicit is returned unchanged in meaning.
 */
export function materializeDirection(
  config: ParityConfig,
  rung: MaturityRung,
): ParityConfig {
  return { ...config, direction: resolveDirection(config, rung) };
}

/** The enforcement behavior a resolved direction drives. */
export interface DirectionPolicy {
  direction: ResolvedDirection;
  /** `design-led`: parity failures **block** the PR. */
  blocksPr: boolean;
  /** `code-led`: drift may be pushed back to the design tool (issue #9). */
  allowsWriteBack: boolean;
}

/**
 * Translate a resolved direction into the booleans the Action (issue #8) and
 * push-back (issue #9) consume, so neither re-derives them. GitHub remains the
 * verdict surface in both modes regardless.
 */
export function directionPolicy(direction: ResolvedDirection): DirectionPolicy {
  return {
    direction,
    blocksPr: direction === "design-led",
    allowsWriteBack: direction === "code-led",
  };
}
