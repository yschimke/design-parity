/**
 * Maturity detection — classify a repo into one of three rungs (Principle 3).
 *
 *   `machine-link`: design system + machine link (Figma Code Connect),
 *   `manifest`:     design system, no machine link (`design-map.json` / tokens),
 *   `bootstrap`:    no design system.
 *
 * Detection is a bounded, deterministic scan of committed files — no model
 * calls, no network. It reports the evidence that drove the classification so
 * the bootstrap CLI can explain itself and a human can audit the verdict.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import type { MaturityRung } from "@design-parity/core";

import { TOKENS_FILE } from "./artifacts.js";
import {
  classifyBuildFile,
  isCmpBuildFile,
  summarizeCmp,
} from "./cmp.js";
import type { CmpCapability, CmpSignal } from "./cmp.js";

/** One piece of evidence found during the scan. */
export interface MaturitySignal {
  /** What kind of evidence, e.g. `"code-connect"`, `"design-map"`, `"tokens"`. */
  kind: "code-connect" | "design-map" | "tokens";
  /** Repo-relative path to the file that matched. */
  path: string;
}

export interface MaturityResult {
  rung: MaturityRung;
  /** Short human label for the rung. */
  label: string;
  /** A Figma Code Connect machine link was found (drives `machine-link`). */
  hasCodeConnect: boolean;
  /** A `design-map.json` manifest was found. */
  hasDesignMap: boolean;
  /** Design-token / design-system files were found (no machine link). */
  hasTokens: boolean;
  /** Every signal found, in scan order. */
  signals: MaturitySignal[];
  /**
   * Whether the repo is Compose Multiplatform capable (Principle 6). Convenience
   * mirror of {@link MaturityResult.cmp}.cmpCapable, hoisted onto the result for
   * the common `if (result.cmpCapable)` check. Orthogonal to the maturity rung:
   * a repo at any rung may or may not be CMP-capable.
   */
  cmpCapable: boolean;
  /** The full CMP capability verdict + its evidence (drives prefer/promote). */
  cmp: CmpCapability;
}

const RUNG_LABELS: Record<MaturityRung, string> = {
  "machine-link": "design system + machine link (Figma Code Connect)",
  manifest: "design system, no machine link (manifest / tokens)",
  bootstrap: "no design system",
};

/** Directories never worth descending into. */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".gradle",
  ".idea",
  "vendor",
  "coverage",
]);

/** Bound the walk so detection stays fast on large repos. */
const MAX_DEPTH = 6;

/** Figma Code Connect config files (presence ⇒ a machine link is wired). */
const CODE_CONNECT_CONFIGS = new Set(["figma.config.json"]);

/** Code Connect component definitions, e.g. `Button.figma.tsx`. */
const CODE_CONNECT_RE = /\.figma\.(tsx?|jsx?|kt|swift)$/;

/** A manifest correspondence file. */
const DESIGN_MAP_RE = /(^|[./])design-map\.json$/;

/**
 * Design-token / design-system files that indicate a design system *without* a
 * machine link. Style Dictionary, Tokens Studio, and DTCG `.tokens.json` all
 * land here, as does a conventional `tokens/` tree.
 */
const TOKEN_FILE_RE =
  /(^|[./])(design-)?tokens\.json$|\.tokens\.json$|(^|[./])(sd|style-dictionary)\.config\.(json|js|cjs|mjs)$/;
const TOKEN_DIRS = new Set(["tokens", "design-tokens"]);

/**
 * Classify `repoRoot` into a maturity rung.
 *
 * Rung 1 wins on any Code Connect signal; rung 2 on a `design-map.json` or a
 * design-token source; rung 3 is the floor. The token baseline this package
 * generates is deliberately *not* treated as a rung-2 signal — that is what a
 * bootstrapped rung-3 repo produces, so detection ignores files it would write
 * (see {@link BASELINE_ARTIFACTS}).
 */
export async function detectMaturity(
  repoRoot: string,
): Promise<MaturityResult> {
  const signals: MaturitySignal[] = [];
  const buildFiles: string[] = [];
  await walk(repoRoot, repoRoot, 0, signals, buildFiles);

  const hasCodeConnect = signals.some((s) => s.kind === "code-connect");
  const hasDesignMap = signals.some((s) => s.kind === "design-map");
  const hasTokens = signals.some((s) => s.kind === "tokens");

  const rung: MaturityRung = hasCodeConnect
    ? "machine-link"
    : hasDesignMap || hasTokens
      ? "manifest"
      : "bootstrap";

  const cmp = await detectCmp(repoRoot, buildFiles);

  return {
    rung,
    label: RUNG_LABELS[rung],
    hasCodeConnect,
    hasDesignMap,
    hasTokens,
    signals,
    cmpCapable: cmp.cmpCapable,
    cmp,
  };
}

/**
 * Read each discovered build file and fold its CMP signals into a verdict. The
 * directory walk only records build-file *paths* (cheap); content reads happen
 * here, bounded to that small set. Unreadable files are skipped, never fatal —
 * detection degrades to "no signal", matching the walk's tolerance.
 */
async function detectCmp(
  repoRoot: string,
  buildFiles: string[],
): Promise<CmpCapability> {
  const signals: CmpSignal[] = [];
  for (const rel of buildFiles) {
    let contents: string;
    try {
      contents = await readFile(join(repoRoot, rel), "utf8");
    } catch {
      continue; // unreadable build file: skip, don't fail the scan
    }
    signals.push(...classifyBuildFile(rel, contents));
  }
  return summarizeCmp(signals);
}

/**
 * The token baseline this package writes is the only artifact that looks like a
 * design-system signal, so exclude it — a bootstrapped repo must not detect its
 * own output as a pre-existing design system on a re-run.
 */
const BASELINE_ARTIFACTS = new Set([TOKENS_FILE]);

async function walk(
  repoRoot: string,
  dir: string,
  depth: number,
  out: MaturitySignal[],
  buildFiles: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir: skip, don't fail the whole scan
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(repoRoot, full);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      if (TOKEN_DIRS.has(entry.name)) {
        out.push({ kind: "tokens", path: rel });
      }
      await walk(repoRoot, full, depth + 1, out, buildFiles);
      continue;
    }

    if (!entry.isFile()) continue;

    const name = entry.name;
    if (CODE_CONNECT_CONFIGS.has(name) || CODE_CONNECT_RE.test(name)) {
      out.push({ kind: "code-connect", path: rel });
    } else if (DESIGN_MAP_RE.test(name)) {
      out.push({ kind: "design-map", path: rel });
    } else if (TOKEN_FILE_RE.test(name) && !BASELINE_ARTIFACTS.has(name)) {
      out.push({ kind: "tokens", path: rel });
    }

    // CMP detection is orthogonal to the rung: record build files for a
    // content scan (see {@link detectCmp}). A file can be both a token source
    // and a build file, so this is not part of the rung if/else chain.
    if (isCmpBuildFile(name)) {
      buildFiles.push(rel);
    }
  }
}
