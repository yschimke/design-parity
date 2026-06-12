/**
 * Bootstrap orchestration — the one place AI generates committed artifacts
 * (Principles 1, 3). `planBootstrap` is pure: it decides *what* to write from
 * the detected maturity rung. `applyBootstrap` writes the plan to disk. Keeping
 * the two apart makes the plan reviewable, testable, and re-runnable, and keeps
 * generation off the unattended Action path entirely.
 */
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateDesignMap } from "@design-parity/core";
import type { ResolvedDirection } from "@design-parity/core";

import {
  CHECKS_FILE,
  CONFIG_FILE,
  DESIGN_MAP_FILE,
  TOKENS_FILE,
} from "./artifacts.js";
import { defaultCheckConfig } from "./checks.js";
import { cmpSuggestion } from "./cmp.js";
import { detectMaturity } from "./detect.js";
import type { MaturityResult } from "./detect.js";
import { directionForRung } from "./direction.js";
import { discoverCodeComponents, seedDesignMap } from "./seed.js";
import type { DiscoveredComponent } from "./seed.js";
import { materialBaselineTokens } from "./tokens.js";

/** One file the plan would write. */
export interface PlannedArtifact {
  /** Repo-relative path. */
  path: string;
  /** One-line human description for the CLI summary. */
  description: string;
  /** Serialized contents (pretty JSON, trailing newline). */
  contents: string;
  /** True if a file already exists at `path` (apply skips it unless forced). */
  exists: boolean;
}

export interface BootstrapPlan {
  repoRoot: string;
  maturity: MaturityResult;
  /** Concrete direction materialized into the config — never `auto`. */
  direction: ResolvedDirection;
  /** Convention-discovered components to wire to a design source (rung 3). */
  review: DiscoveredComponent[];
  artifacts: PlannedArtifact[];
  /**
   * Non-blocking Compose Multiplatform promotion (Principle 6). Present only
   * when the repo is *not* CMP-capable; `undefined` when it already is. Advisory
   * surface text — never a gate, never an artifact.
   */
  cmpSuggestion?: string;
}

export interface PlanOptions {
  /** Override the materialized direction (e.g. the user picked design-led). */
  direction?: ResolvedDirection;
  /** Inject a maturity result instead of scanning (testing / re-runs). */
  maturity?: MaturityResult;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide which committed artifacts a repo needs. Every rung gets a concrete
 * parity direction; only rung 3 (no design system) is bootstrapped with a token
 * baseline, a starter design-map, and a check config.
 *
 * @throws if the seeded design-map fails its own schema (a build-time bug).
 */
export async function planBootstrap(
  repoRoot: string,
  opts: PlanOptions = {},
): Promise<BootstrapPlan> {
  const maturity = opts.maturity ?? (await detectMaturity(repoRoot));
  const direction = opts.direction ?? directionForRung(maturity.rung);

  const artifacts: PlannedArtifact[] = [];
  const add = async (path: string, description: string, value: unknown) => {
    artifacts.push({
      path,
      description,
      contents: json(value),
      exists: await fileExists(join(repoRoot, path)),
    });
  };

  // Every rung: materialize a concrete direction (Principle 5).
  await add(CONFIG_FILE, `parity direction (${direction})`, { direction });

  let review: DiscoveredComponent[] = [];
  if (maturity.rung === "bootstrap") {
    review = await discoverCodeComponents(repoRoot);

    const designMap = seedDesignMap();
    const check = validateDesignMap(designMap);
    if (!check.valid) {
      // The seeded map is hand-built; an invalid one is a bug in this package.
      throw new Error(
        `seeded design-map failed schema validation: ${check.errors.join("; ")}`,
      );
    }

    await add(TOKENS_FILE, "Material 3 + WCAG AA token baseline", materialBaselineTokens());
    await add(CHECKS_FILE, "a11y + i18n checks config", defaultCheckConfig());
    await add(DESIGN_MAP_FILE, "starter design-map (empty scaffold)", designMap);
  }

  return {
    repoRoot,
    maturity,
    direction,
    review,
    artifacts,
    cmpSuggestion: cmpSuggestion(maturity.cmp),
  };
}

export interface ApplyOptions {
  /** Overwrite artifacts that already exist. Default: skip them. */
  force?: boolean;
}

export interface ApplyResult {
  /** Repo-relative paths written. */
  written: string[];
  /** Repo-relative paths skipped because they already existed. */
  skipped: string[];
}

/**
 * Write a plan's artifacts to disk. Existing files are left untouched unless
 * `force` is set, so a re-run never clobbers a human's edits by surprise.
 */
export async function applyBootstrap(
  plan: BootstrapPlan,
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const artifact of plan.artifacts) {
    if (artifact.exists && !opts.force) {
      skipped.push(artifact.path);
      continue;
    }
    await writeFile(join(plan.repoRoot, artifact.path), artifact.contents, "utf8");
    written.push(artifact.path);
  }

  return { written, skipped };
}
