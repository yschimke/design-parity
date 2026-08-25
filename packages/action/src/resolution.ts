import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import type { AcceptanceStatus } from "@design-parity/diff";

import type { ParityReport } from "./orchestrate.js";

export const ACCEPTANCE_EVIDENCE_SCHEMA = "design-parity-acceptance-evidence/v1";

export interface AcceptanceEvidenceEntry extends AcceptanceStatus {
  /** Comparison keys that produced this non-out-of-scope observation. */
  comparisons: string[];
  /** Conflicting observations are never actionable. */
  conflict?: boolean;
  /** Issue-index axis, deliberately separate from the comparison status. */
  lifecycle?: "open" | "closed" | "unknown";
  /** True only for closed + non-resolved. */
  stale?: boolean;
}

export interface AcceptanceEvidence {
  schema: typeof ACCEPTANCE_EVIDENCE_SCHEMA;
  generatedAt: string;
  verificationUrl?: string;
  statuses: Record<string, AcceptanceEvidenceEntry>;
}

interface AcceptanceRecord {
  id: string;
  issue: string;
  [key: string]: unknown;
}

interface KnownDifferencesDocument {
  schema: string;
  acceptances: AcceptanceRecord[];
}

export interface ResolutionResult {
  removed: string[];
  closingIssues: string[];
  locallyResolvedIssues: string[];
  ownershipUnknownIssues: string[];
  body: string;
}

/**
 * Collapse per-comparison reports into one conservative observation per acceptance.
 *
 * `out-of-scope` is absence of evidence for that comparison. A status is actionable only when at
 * least one in-scope comparison observed it and every such observation agrees. This prevents a
 * partial/sharded run or duplicated scope from deleting a record on ambiguous evidence.
 */
export function acceptanceEvidence(
  report: Pick<ParityReport, "results">,
  options: { now?: Date; verificationUrl?: string } = {},
): AcceptanceEvidence {
  const observations = new Map<string, Array<{ comparison: string; value: AcceptanceStatus }>>();
  for (const result of report.results) {
    for (const [comparison, acceptance] of Object.entries(result.acceptances ?? {})) {
      for (const [id, status] of Object.entries(acceptance.statuses)) {
        if (status.status === "out-of-scope") continue;
        const values = observations.get(id) ?? [];
        values.push({ comparison: `${result.code}:${comparison}`, value: status });
        observations.set(id, values);
      }
    }
  }

  const statuses: Record<string, AcceptanceEvidenceEntry> = {};
  for (const [id, values] of [...observations].sort(([a], [b]) => a.localeCompare(b))) {
    const signatures = new Set(values.map(({ value }) => JSON.stringify(value)));
    const firstObservation = values[0];
    if (!firstObservation) continue;
    const first = firstObservation.value;
    statuses[id] = {
      ...first,
      comparisons: values.map(({ comparison }) => comparison).sort(),
      ...(signatures.size > 1 ? { conflict: true } : {}),
    };
  }
  return {
    schema: ACCEPTANCE_EVIDENCE_SCHEMA,
    generatedAt: (options.now ?? new Date()).toISOString(),
    ...(options.verificationUrl ? { verificationUrl: options.verificationUrl } : {}),
    statuses,
  };
}

export async function writeAcceptanceEvidence(
  path: string,
  report: Pick<ParityReport, "results">,
  options: {
    now?: Date;
    verificationUrl?: string;
    documentPath?: string;
    issueIndexPath?: string;
  } = {},
): Promise<AcceptanceEvidence> {
  const evidence = acceptanceEvidence(report, options);
  if (options.documentPath) {
    let document: KnownDifferencesDocument | null = null;
    try {
      document = parseDocument(await readFile(options.documentPath, "utf8"));
    } catch {
      // A broken document already surfaces as a contract refusal. Lifecycle remains unknown.
    }
    const states = options.issueIndexPath
      ? await readIssueStates(options.issueIndexPath)
      : new Map<string, "open" | "closed">();
    const issueById = new Map(
      (document?.acceptances ?? []).map((record) => [record.id, canonicalIssue(record.issue)]),
    );
    for (const [id, status] of Object.entries(evidence.statuses)) {
      const issue = issueById.get(id);
      const lifecycle = issue ? (states.get(issue) ?? "unknown") : "unknown";
      status.lifecycle = lifecycle;
      if (lifecycle === "closed" && status.status !== "resolved") status.stale = true;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}

/** Parse GitHub issue spellings to one case-insensitive owner/repo/number identity. */
export function canonicalIssue(value: string): string | null {
  const input = value.trim();
  const shorthand = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9][0-9]*)$/);
  if (shorthand) {
    const owner = shorthand[1];
    const repo = shorthand[2];
    const number = shorthand[3];
    if (owner && repo && number) return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
  }
  try {
    const url = new URL(input);
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const [owner, repo, kind, number] = segments;
    if (!owner || !repo || kind?.toLowerCase() !== "issues" || !number) return null;
    if (!/^[1-9][0-9]*$/.test(number)) return null;
    return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
  } catch {
    return null;
  }
}

function parseDocument(text: string): KnownDifferencesDocument {
  const value = JSON.parse(text) as Partial<KnownDifferencesDocument>;
  if (value.schema !== "compose-preview-known-differences/v1" || !Array.isArray(value.acceptances)) {
    throw new Error("known-differences.json is not compose-preview-known-differences/v1");
  }
  for (const record of value.acceptances) {
    if (!record || typeof record.id !== "string" || typeof record.issue !== "string") {
      throw new Error("known-differences.json contains a record without string id/issue");
    }
  }
  return value as KnownDifferencesDocument;
}

function parseEvidence(text: string): AcceptanceEvidence {
  const value = JSON.parse(text) as Partial<AcceptanceEvidence>;
  if (value.schema !== ACCEPTANCE_EVIDENCE_SCHEMA || !value.statuses || typeof value.statuses !== "object") {
    throw new Error(`acceptance evidence must use ${ACCEPTANCE_EVIDENCE_SCHEMA}`);
  }
  return value as AcceptanceEvidence;
}

async function readIssueStates(path: string): Promise<Map<string, "open" | "closed">> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      schema?: unknown;
      issues?: unknown;
    };
    if (value.schema !== "compose-preview-issues/v1" || !Array.isArray(value.issues)) return new Map();
    const observations = new Map<string, Set<"open" | "closed">>();
    for (const raw of value.issues) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { repository?: unknown; number?: unknown; state?: unknown };
      if (typeof row.repository !== "string" || !Number.isSafeInteger(row.number)) continue;
      if (row.state !== "open" && row.state !== "closed") continue;
      const issue = canonicalIssue(`${row.repository}#${row.number}`);
      if (!issue) continue;
      const states = observations.get(issue) ?? new Set<"open" | "closed">();
      states.add(row.state);
      observations.set(issue, states);
    }
    return new Map(
      [...observations]
        .filter(([, states]) => states.size === 1)
        .map(([issue, states]) => [issue, [...states][0]!] as const),
    );
  } catch {
    // Fail soft: unreadable, malformed, or absent index means unknown everywhere, never closed.
    return new Map();
  }
}

function safeAcceptanceDir(root: string, id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === ".." || ["__proto__", "constructor", "prototype"].includes(id)) {
    throw new Error(`unsafe acceptance id '${id}'`);
  }
  const target = resolve(root, id);
  const resolvedRoot = resolve(root);
  if (target === resolvedRoot || !target.startsWith(resolvedRoot + sep)) {
    throw new Error(`acceptance id '${id}' escapes the artifact root`);
  }
  return target;
}

function renderBody(input: {
  removed: AcceptanceRecord[];
  closing: string[];
  ownershipUnknown: string[];
  verificationUrl?: string;
}): string {
  const lines = [
    "## Parity verification",
    "",
    ...(input.verificationUrl ? [`Verified by ${input.verificationUrl}.`, ""] : []),
    "Resolved acceptances removed in this PR:",
    "",
    ...input.removed.map((record) => `- \`${record.id}\` — ${canonicalIssue(record.issue) ?? record.issue}`),
  ];
  if (input.ownershipUnknown.length > 0) {
    lines.push(
      "",
      "These locally resolved issues remain open because single-document ownership was not established:",
      "",
      ...input.ownershipUnknown.map((issue) => `- ${issue}`),
    );
  }
  if (input.closing.length > 0) {
    lines.push("", ...input.closing.map((issue) => `Closes ${issue}`));
  }
  return lines.join("\n") + "\n";
}

/**
 * Remove proven-resolved records and artifact directories, then produce the PR body that makes
 * issue closure atomic with that deletion. Ownership is opt-in per canonical issue; local evidence
 * alone can never infer it.
 */
export async function resolveKnownDifferences(options: {
  repoRoot: string;
  evidencePath: string;
  ownedIssues?: string[];
  documentPath?: string;
  artifactRoot?: string;
  bodyPath?: string;
}): Promise<ResolutionResult> {
  const documentPath = options.documentPath ?? join(options.repoRoot, ".design-parity", "known-differences.json");
  const artifactRoot = options.artifactRoot ?? join(options.repoRoot, ".design-parity", "known-differences");
  if (!isAbsolute(documentPath) || !isAbsolute(artifactRoot)) {
    throw new Error("resolved document and artifact paths must be absolute");
  }
  const document = parseDocument(await readFile(documentPath, "utf8"));
  const evidence = parseEvidence(await readFile(options.evidencePath, "utf8"));
  const resolvedIds = new Set(
    Object.entries(evidence.statuses)
      .filter(([, status]) => status.status === "resolved" && status.conflict !== true)
      .map(([id]) => id),
  );
  const removed = document.acceptances.filter((record) => resolvedIds.has(record.id));
  if (removed.length === 0) {
    return { removed: [], closingIssues: [], locallyResolvedIssues: [], ownershipUnknownIssues: [], body: "" };
  }

  const issueGroups = new Map<string, AcceptanceRecord[]>();
  for (const record of document.acceptances) {
    const issue = canonicalIssue(record.issue);
    if (!issue) throw new Error(`acceptance '${record.id}' has an unsupported issue URL`);
    const group = issueGroups.get(issue) ?? [];
    group.push(record);
    issueGroups.set(issue, group);
  }
  const locallyResolvedIssues = [...issueGroups]
    .filter(([, records]) => records.every((record) => resolvedIds.has(record.id)))
    .map(([issue]) => issue)
    .sort();
  const owned = new Set((options.ownedIssues ?? []).map((issue) => {
    const canonical = canonicalIssue(issue);
    if (!canonical) throw new Error(`invalid owned issue '${issue}'`);
    return canonical;
  }));
  const closingIssues = locallyResolvedIssues.filter((issue) => owned.has(issue));
  const ownershipUnknownIssues = locallyResolvedIssues.filter((issue) => !owned.has(issue));
  const body = renderBody({
    removed,
    closing: closingIssues,
    ownershipUnknown: ownershipUnknownIssues,
    verificationUrl: evidence.verificationUrl,
  });
  // Validate every destructive target before changing the document. A malformed id must not leave
  // the JSON edited while its artifact directory survives.
  const artifactDirs = removed.map((record) => safeAcceptanceDir(artifactRoot, record.id));

  document.acceptances = document.acceptances.filter((record) => !resolvedIds.has(record.id));
  await writeFile(documentPath, JSON.stringify(document, null, 2) + "\n");
  for (const directory of artifactDirs) await rm(directory, { recursive: true, force: true });
  if (options.bodyPath) await writeFile(options.bodyPath, body);
  return {
    removed: removed.map((record) => record.id),
    closingIssues,
    locallyResolvedIssues,
    ownershipUnknownIssues,
    body,
  };
}
