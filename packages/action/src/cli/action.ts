#!/usr/bin/env node
/**
 * GitHub Action entrypoint. Auto-selects its mode from the triggering event
 * (issue #56), staying unattended throughout: zero human input, only committed
 * deterministic artifacts, no model call (docs/PRINCIPLES.md).
 *
 * - **comment** (a `pull_request`): keep the changed-component components, run
 *   the pipeline, and post/update the single verdict comment. Exits non-zero
 *   only when the parity direction blocks (`design-led` + a failure).
 * - **baseline** (a `push` to the `development-branch`): render the full mapped
 *   surface and publish the browsable artifacts (`index.html` + per-component
 *   `report.html` triptychs + `verdict.json`) to a permanent artifact branch,
 *   force-updated each run. Requires a token with `contents: write`.
 * - **skip**: nothing applies (e.g. a push to a non-dev branch).
 *
 * Reads the standard Action environment (`GITHUB_TOKEN`, `GITHUB_REPOSITORY`,
 * `GITHUB_EVENT_PATH`, `GITHUB_WORKSPACE`, `GITHUB_EVENT_NAME`, `GITHUB_REF_NAME`,
 * `GITHUB_SHA`). Candidate renders come from a committed/produced
 * `CandidateRender[]` JSON (`INPUT_CANDIDATES`) and/or compose-preview bundles
 * (`INPUT_CANDIDATE_BUNDLES`) — live rendering is the consumer's prior step.
 */
import { env, cwd, exit, stdout, stderr } from "node:process";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolve as resolveCorrespondences } from "@design-parity/resolver";

import { buildCandidateProvider } from "../candidate.js";
import { resolveRunConfig } from "../config.js";
import { createAdapterRegistry } from "../registry.js";
import { orchestrate } from "../orchestrate.js";
import { renderReport } from "../report.js";
import { GitHubRest } from "../github/rest.js";
import { postReport } from "../github/surface.js";
import { componentsForChangedFiles } from "../github/changed-components.js";
import { exitCode } from "../github/conclusion.js";
import { publishBaseline } from "../github/publish.js";
import { writeBaselineArtifacts } from "../baseline.js";
import { selectMode } from "../mode.js";

interface RepoRef {
  owner: string;
  repo: string;
}

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

/** Build the candidate provider from the committed JSON / bundle inputs. */
async function candidateProvider(
  repoRoot: string,
  designMap: Parameters<typeof buildCandidateProvider>[0]["designMap"],
): Promise<{
  provider: Parameters<typeof orchestrate>[0]["candidate"];
  warnings: string[];
}> {
  const candidatesPath = env.INPUT_CANDIDATES ?? env.DESIGN_PARITY_CANDIDATES;
  const bundles = (env.INPUT_CANDIDATE_BUNDLES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const opts: Parameters<typeof buildCandidateProvider>[0] = {
    repoRoot,
    bundlePaths: bundles,
  };
  if (designMap) opts.designMap = designMap;
  if (candidatesPath) opts.candidatesPath = candidatesPath;
  const { provider, warnings } = await buildCandidateProvider(opts);
  return { provider: provider ?? (() => undefined), warnings };
}

/** comment mode: changed-component parity run + the single verdict comment. */
async function runComment(
  ref: RepoRef,
  repoRoot: string,
  rest: GitHubRest,
  prNumber: number,
): Promise<number> {
  const { designMap, direction, warnings } = await resolveRunConfig(repoRoot);

  const changedFiles = await rest.listPullRequestFiles(ref, prNumber);
  const components = componentsForChangedFiles(designMap, changedFiles);
  if (components.length === 0) {
    stdout.write("design-parity: no design-mapped components changed — skipping (non-UI PR)\n");
    return 0;
  }

  const resolved = resolveCorrespondences(components, designMap ? { designMap } : {});
  const { provider, warnings: candidateWarnings } = await candidateProvider(
    repoRoot,
    designMap,
  );

  const report = await orchestrate({
    repoRoot,
    env,
    registry: createAdapterRegistry(),
    correspondences: resolved.correspondences,
    candidate: provider,
    direction,
    ...(env.DESIGN_PARITY_OUT ? { outDir: env.DESIGN_PARITY_OUT } : {}),
  });
  report.warnings.unshift(
    ...warnings,
    ...resolved.warnings,
    ...candidateWarnings,
    ...resolved.unresolved.map((u) => `unresolved (no source matched): ${u}`),
  );

  const outcome = await postReport(
    rest.commentClient(ref, prNumber),
    renderReport(report),
  );
  stdout.write(
    `design-parity: ${outcome} report — status=${report.status} blocked=${report.blocked}\n`,
  );
  return exitCode(report);
}

/** baseline mode: full-surface parity run published to the artifact branch. */
async function runBaseline(
  ref: RepoRef,
  repoRoot: string,
  token: string,
  artifactBranch: string,
): Promise<number> {
  const { designMap, direction, warnings } = await resolveRunConfig(repoRoot);
  const components = designMap?.components.map((c) => c.code) ?? [];
  if (components.length === 0) {
    stdout.write("design-parity: no components in design-map.json — nothing to baseline\n");
    return 0;
  }

  const resolved = resolveCorrespondences(components, designMap ? { designMap } : {});
  const { provider, warnings: candidateWarnings } = await candidateProvider(
    repoRoot,
    designMap,
  );

  const outDir = await mkdtemp(join(tmpdir(), "design-parity-baseline-"));
  const report = await orchestrate({
    repoRoot,
    env,
    registry: createAdapterRegistry(),
    correspondences: resolved.correspondences,
    candidate: provider,
    direction,
    outDir,
  });
  report.warnings.unshift(
    ...warnings,
    ...resolved.warnings,
    ...candidateWarnings,
    ...resolved.unresolved.map((u) => `unresolved (no source matched): ${u}`),
  );

  const commit = env.GITHUB_SHA;
  const { summary } = await writeBaselineArtifacts(outDir, report, {
    ...(commit ? { commit } : {}),
  });

  const result = await publishBaseline({
    sourceDir: outDir,
    branch: artifactBranch,
    repo: `${ref.owner}/${ref.repo}`,
    token,
    message: `design-parity: baseline ${summary.status}${commit ? ` @ ${commit.slice(0, 12)}` : ""}`,
    skipIfUnchanged: true,
    ...(env.GITHUB_SERVER_URL ? { serverUrl: env.GITHUB_SERVER_URL } : {}),
  });
  stdout.write(
    result.pushed
      ? `design-parity: published baseline to ${result.branch} (${result.sha?.slice(0, 12)}) — status=${summary.status}\n`
      : `design-parity: baseline unchanged vs ${result.branch} — nothing to publish\n`,
  );
  // Baseline mode never blocks the dev-branch push; it only publishes.
  return 0;
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
  const ref: RepoRef = { owner, repo };
  const repoRoot = env.GITHUB_WORKSPACE ?? cwd();

  const developmentBranch = env.INPUT_DEVELOPMENT_BRANCH?.trim() || "main";
  const artifactBranch =
    env.INPUT_ARTIFACT_BRANCH?.trim() || `design-parity/${developmentBranch}`;

  const prNumber = await readPrNumber();
  const mode = selectMode({
    eventName: env.GITHUB_EVENT_NAME,
    refName: env.GITHUB_REF_NAME,
    developmentBranch,
    ...(env.INPUT_MODE ? { override: env.INPUT_MODE } : {}),
    ...(prNumber ? { prNumber } : {}),
  });

  switch (mode) {
    case "baseline":
      stdout.write(`design-parity: baseline mode → ${artifactBranch}\n`);
      return runBaseline(ref, repoRoot, token, artifactBranch);
    case "comment": {
      if (!prNumber) {
        stdout.write(
          "design-parity: comment mode but no pull_request in context — nothing to do\n",
        );
        return 0;
      }
      const rest = new GitHubRest({
        token,
        ...(env.GITHUB_API_URL ? { baseUrl: env.GITHUB_API_URL } : {}),
      });
      return runComment(ref, repoRoot, rest, prNumber);
    }
    default:
      stdout.write(
        `design-parity: nothing to do for event='${env.GITHUB_EVENT_NAME}' ref='${env.GITHUB_REF_NAME}' (not the development branch '${developmentBranch}')\n`,
      );
      return 0;
  }
}

exit(await main());
