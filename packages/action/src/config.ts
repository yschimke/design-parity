/**
 * Resolve the committed configuration a parity run reads from a repo: the
 * `design-map.json` correspondence manifest and the `.design-parity.json` parity
 * direction. Everything here is committed and read deterministically — no model,
 * no network (Principle 1).
 */
import { join } from "node:path";

import {
  loadDesignMap,
  type DesignMap,
  type ResolvedDirection,
} from "@design-parity/core";
import {
  loadParityConfigOrDefault,
  PARITY_CONFIG_FILENAME,
} from "@design-parity/policy";

export interface RunConfig {
  designMap?: DesignMap;
  direction: ResolvedDirection;
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

  return { designMap, direction, warnings };
}
