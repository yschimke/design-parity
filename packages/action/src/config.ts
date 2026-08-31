/**
 * Resolve the committed configuration a parity run reads from a repo: the
 * `design-map.json` correspondence manifest and the `.design-parity.json` parity
 * direction, CMP flag, and token-comparison policy. Everything here is committed and read deterministically — no model,
 * no network (Principle 1).
 */
import { join } from "node:path";

import {
  loadDesignMap,
  type AcceptedTokenDifference,
  type DesignMap,
  type ResolvedDirection,
} from "@design-parity/core";
import type { DiffConfig, KnownDifferencesOptions } from "@design-parity/diff";
import {
  loadParityConfigOrDefault,
  PARITY_CONFIG_FILENAME,
} from "@design-parity/policy";
import { specTokenKey } from "./specTokens.js";

export interface RunConfig {
  designMap?: DesignMap;
  direction: ResolvedDirection;
  /**
   * The committed CMP capability flag (Principle 6), read verbatim from
   * `.design-parity.json` — *not* re-derived here (Principle 1). `false` lets
   * the run promote CMP in the PR comment; `true`/omitted stays silent. See
   * {@link ParityConfig.cmpCapable}.
   */
  cmpCapable?: boolean;
  /**
   * Diff overrides the committed `.design-parity.json` asks for — today the
   * `tokens` comparison policy (issues #367 / #368). Absent when the repo says
   * nothing, so the engine's committed defaults stand (Principle 1); the field
   * names are shared with {@link DiffConfig} so this stays a copy, not a
   * translation that can drift.
   */
  diffConfig?: Partial<DiffConfig>;
  /** Per-component exact scopes loaded from committed `design-map.json`. */
  knownDifferences?: ReadonlyMap<string, KnownDifferencesOptions>;
  /** Exact issue-backed token debts, keyed by component correspondence. */
  acceptedTokenDifferences?: ReadonlyMap<string, AcceptedTokenDifference[]>;
  warnings: string[];
}

/**
 * Read `design-map.json` and `.design-parity.json` from `repoRoot`.
 *
 * A concrete `direction` is used verbatim. `auto` means setup never ran to
 * materialize it (Principle 5), so we fall back to `code-led` (advisory) and
 * warn — the steady-state Action never re-derives direction from a maturity
 * scan; that's setup's job.
 */
export async function resolveRunConfig(repoRoot: string): Promise<RunConfig> {
  const warnings: string[] = [];

  let designMap: DesignMap | undefined;
  try {
    designMap = await loadDesignMap(join(repoRoot, "design-map.json"));
  } catch (err) {
    // A missing design-map is fine (Code Connect / convention may still resolve);
    // an invalid one is worth surfacing.
    const message = (err as Error).message;
    if (!/cannot read/.test(message)) warnings.push(message);
  }

  const config = await loadParityConfigOrDefault(
    join(repoRoot, PARITY_CONFIG_FILENAME),
  );
  let direction: ResolvedDirection;
  if (config.direction === "auto") {
    direction = "code-led";
    warnings.push(
      `parity direction is 'auto' (no ${PARITY_CONFIG_FILENAME} from setup); defaulting to code-led (advisory). Run the bootstrap to materialize a concrete direction.`,
    );
  } else {
    direction = config.direction;
  }

  const runConfig: RunConfig = { designMap, direction, warnings };
  // Carry the committed CMP flag through verbatim (only when setup recorded it).
  if (typeof config.cmpCapable === "boolean")
    runConfig.cmpCapable = config.cmpCapable;
  const diffConfig: Partial<DiffConfig> = {
    ...(config.tokens?.missingNumerics
      ? { missingNumerics: config.tokens.missingNumerics }
      : {}),
    ...(config.tokens?.textDerivedInsets
      ? { textDerivedInsets: config.tokens.textDerivedInsets }
      : {}),
  };
  if (Object.keys(diffConfig).length > 0) runConfig.diffConfig = diffConfig;
  const knownDifferences = new Map<string, KnownDifferencesOptions>();
  for (const component of designMap?.components ?? []) {
    if (!component.knownDifferences) continue;
    knownDifferences.set(specTokenKey(component.code, component.source), {
      scopes: component.knownDifferences,
    });
  }
  if (knownDifferences.size > 0) runConfig.knownDifferences = knownDifferences;
  const acceptedTokenDifferences = new Map<string, AcceptedTokenDifference[]>();
  for (const acceptance of config.tokens?.acceptedDifferences ?? []) {
    const key = specTokenKey(acceptance.component, acceptance.source);
    const existing = acceptedTokenDifferences.get(key) ?? [];
    existing.push(acceptance);
    acceptedTokenDifferences.set(key, existing);
  }
  if (acceptedTokenDifferences.size > 0)
    runConfig.acceptedTokenDifferences = acceptedTokenDifferences;
  return runConfig;
}
