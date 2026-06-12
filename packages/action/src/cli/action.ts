#!/usr/bin/env node
/**
 * GitHub Action entrypoint. Runs the parity pipeline on a pull request and
 * posts/updates a single verdict comment. Unattended: zero human input, only
 * committed deterministic artifacts, no model call (docs/PRINCIPLES.md).
 *
 * Reads the standard Action environment (`GITHUB_TOKEN`, `GITHUB_REPOSITORY`,
 * `GITHUB_EVENT_PATH`, `GITHUB_WORKSPACE`). Candidate renders come from a
 * committed/produced `CandidateRender[]` JSON at `INPUT_CANDIDATES`
 * (live `compose-preview` rendering is the next increment). Exits non-zero only
 * when the parity direction blocks (`design-led` + a failure).
 */
import { env, cwd, exit, stdout, stderr } from "node:process";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import type { CandidateRender } from "@design-parity/core";
import { resolve as resolveCorrespondences } from "@design-parity/resolver";

import { resolveRunConfig } from "../config.js";
import { createAdapterRegistry } from "../registry.js";
import { orchestrate } from "../orchestrate.js";
import { renderReport } from "../report.js";
import { GitHubRest } from "../github/rest.js";
import { postReport } from "../github/surface.js";
import { componentsForChangedFiles } from "../github/changed-components.js";
import { exitCode } from "../github/conclusion.js";

async function readPrNumber(): Promise<number | undefined> {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return undefined;
  try {
    const event = JSON.parse(await readFile(path, "utf8")) as {
      pull_request?: { number?: number };
      number?: number;
    };
    return event.pull_request?.number ?? event.number;
  } catch {
    return undefined;
  }
}

async function loadCandidates(
  repoRoot: string,
): Promise<Map<string, CandidateRender> | undefined> {
  const path = env.INPUT_CANDIDATES ?? env.DESIGN_PARITY_CANDIDATES;
  if (!path) return undefined;
  const raw = JSON.parse(
    await readFile(resolvePath(repoRoot, path), "utf8"),
  ) as CandidateRender[] | { candidates: CandidateRender[] };
  const list = Array.isArray(raw) ? raw : raw.candidates;
  return new Map(list.map((c) => [c.componentId, c]));
}

async function main(): Promise<number> {
  const token = env.GITHUB_TOKEN ?? env.INPUT_GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    stderr.write("design-parity: GITHUB_TOKEN and GITHUB_REPOSITORY are required\n");
    return 2;
  }
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    stderr.write(`design-parity: bad GITHUB_REPOSITORY '${repository}'\n`);
    return 2;
  }
  const repoRoot = env.GITHUB_WORKSPACE ?? cwd();

  const prNumber = await readPrNumber();
  if (!prNumber) {
    stdout.write("design-parity: not a pull_request event — nothing to do\n");
    return 0;
  }

  const { designMap, direction, warnings } = await resolveRunConfig(repoRoot);
  const rest = new GitHubRest({
    token,
    ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}),
  });

  const changedFiles = await rest.listPullRequestFiles({ owner, repo }, prNumber);
  const components = componentsForChangedFiles(designMap, changedFiles);
  if (components.length === 0) {
    stdout.write("design-parity: no design-mapped components changed — skipping (non-UI PR)\n");
    return 0;
  }

  const resolved = resolveCorrespondences(components, designMap ? { designMap } : {});
  const candidates = await loadCandidates(repoRoot);

  const report = await orchestrate({
    repoRoot,
    env,
    registry: createAdapterRegistry(),
    correspondences: resolved.correspondences,
    candidate: (id) => candidates?.get(id),
    direction,
    ...(env.DESIGN_PARITY_OUT ? { outDir: env.DESIGN_PARITY_OUT } : {}),
  });
  report.warnings.unshift(
    ...warnings,
    ...resolved.warnings,
    ...resolved.unresolved.map((u) => `unresolved (no source matched): ${u}`),
  );

  const outcome = await postReport(
    rest.commentClient({ owner, repo }, prNumber),
    renderReport(report),
  );
  stdout.write(
    `design-parity: ${outcome} report — status=${report.status} blocked=${report.blocked}\n`,
  );
  return exitCode(report);
}

exit(await main());
