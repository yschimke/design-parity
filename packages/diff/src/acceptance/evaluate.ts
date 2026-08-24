import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { artifactReader } from "./reader.js";
import type {
  AcceptanceReport,
  KnownDifferencesComparison,
  Raster,
  TagIndex,
} from "./types.js";
import {
  BUDGET,
  evaluateKnownDifferences as evaluateJs,
} from "./vendor/known-differences.js";
import {
  canonicalRaster,
  projectTagIndex,
  resolvePlane,
} from "./vendor/known-difference-plane.js";
import { scoreComparison as scoreJs } from "./vendor/known-difference-score.js";

const evaluateKnownDifferences = evaluateJs as unknown as (input: {
  documentText: string;
  readArtifact: ReturnType<typeof artifactReader>;
  comparison: Record<string, unknown>;
}) => {
  statuses?: AcceptanceReport["statuses"];
  survivingMasks?: Array<{ id: string; mask: Raster }>;
  validationFailures: AcceptanceReport["validationFailures"];
};

const scoreComparison = scoreJs as unknown as (input: {
  reference: Raster;
  candidate: Raster;
  referenceBox: { x: number; y: number; width: number; height: number };
  candidateBox: { x: number; y: number; width: number; height: number };
  plane: { plane: string; box: { x: number; y: number; width: number; height: number } };
  masks: Raster[];
}) => { raw: number; accepted: number; unaccepted: number };

/**
 * Apply `compose-preview-known-differences/v1` to one offline comparison.
 *
 * Gate evaluation finishes before the scoring union is built. The union comes only from `valid`
 * records; resolved, invalidated, refused, and out-of-scope records therefore remove no pixels or
 * neighbourhood candidates. The scorer splits both source rasters before its one resample, while
 * raw traverses the same stages with an empty split and remains independently reported.
 */
export function evaluateKnownDifferenceComparison(
  input: KnownDifferencesComparison,
): AcceptanceReport | null {
  const documentPath = input.documentPath ??
    join(input.repoRoot, ".design-parity", "known-differences.json");
  const artifactRoot = input.artifactRoot ??
    join(input.repoRoot, ".design-parity", "known-differences");

  if (!existsSync(documentPath)) return null;
  let documentText: string;
  try {
    const committedRoot = join(input.repoRoot, ".design-parity");
    const linkedRoot = existsSync(committedRoot) && lstatSync(committedRoot).isSymbolicLink();
    const linkedDocument = lstatSync(documentPath).isSymbolicLink();
    if (linkedRoot || linkedDocument) {
      documentText = "";
    } else if (statSync(documentPath).size > BUDGET.maxDocumentBytes) {
      // Reach the engine-owned token without allocating a document past its committed ceiling.
      documentText = "x".repeat(BUDGET.maxDocumentBytes + 1);
    } else {
      documentText = readFileSync(documentPath, "utf8");
    }
  } catch {
    // It exists but cannot be read: let the contract report `document-unreadable` instead of
    // turning a broken committed document into the ordinary "nothing has been accepted" case.
    documentText = "";
  }

  const resolved = resolvePlane(input.reference, input.candidate);
  const result = evaluateKnownDifferences({
    documentText,
    readArtifact: artifactReader(artifactRoot),
    comparison: {
      ...input.scope,
      referenceSha256: input.scope.referenceSha256 ?? null,
      plane: resolved.plane,
      canonicalReference: canonicalRaster(
        input.reference,
        resolved.boxes.reference,
        resolved.plane,
      ),
      canonicalCandidate: canonicalRaster(
        input.candidate,
        resolved.boxes.candidate,
        resolved.plane,
      ),
      tagIndex: projectTagIndex(
        input.tagIndex ?? {},
        resolved.boxes.candidate,
        resolved.plane,
      ),
    },
  });

  // Missing per-image semantics is different from a tag genuinely disappearing.
  // The portable contract cannot run an element gate without the authoritative
  // tree, so surface a host-level refusal instead of claiming `element-moved`.
  // Geometric records remain eligible because they do not consume semantics.
  if (input.tagIndex === undefined && result.statuses) {
    refuseElementAcceptancesWithoutSemantics(
      documentText,
      input.scope,
      result.statuses,
      result.validationFailures,
    );
  }

  const survivors = result.survivingMasks ?? [];
  const scores = scoreComparison({
    reference: input.reference,
    candidate: input.candidate,
    referenceBox: resolved.boxes.reference,
    candidateBox: resolved.boxes.candidate,
    plane: resolved.plane,
    masks: survivors.map((entry: { mask: Raster }) => entry.mask),
  });

  return {
    documentRejected: result.statuses === undefined,
    statuses: result.statuses ?? {},
    validationFailures: result.validationFailures,
    scores: {
      raw: scores.raw,
      accepted: scores.accepted,
      unaccepted: scores.unaccepted,
    },
    suppressing: survivors.map((entry: { id: string }) => entry.id),
  };
}

function refuseElementAcceptancesWithoutSemantics(
  documentText: string,
  scope: KnownDifferencesComparison["scope"],
  statuses: AcceptanceReport["statuses"],
  failures: AcceptanceReport["validationFailures"],
): void {
  let records: unknown;
  try {
    records = (JSON.parse(documentText) as { acceptances?: unknown }).acceptances;
  } catch {
    return;
  }
  if (!Array.isArray(records)) return;
  for (const value of records) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !statuses[id] || !record.element) continue;
    if (!sameScope(record, scope)) continue;
    statuses[id] = { status: "refused", reasons: ["semantics-unavailable"] };
    failures.push({ id, reason: "semantics-unavailable" });
  }
}

function sameScope(
  record: Record<string, unknown>,
  scope: KnownDifferencesComparison["scope"],
): boolean {
  for (const key of ["system", "component", "previewId", "referenceId", "variant"] as const) {
    if (record[key] !== scope[key]) return false;
  }
  const actual = record.overrides ?? {};
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const a = Object.entries(actual as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(scope.overrides).sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Build the exact tag/count/bounds index the offline element gate consumes. */
export function tagIndexFromSemantics(
  root: { testTag?: string; bounds?: { x: number; y: number; width: number; height: number }; children?: unknown[] },
): TagIndex {
  const out = Object.create(null) as TagIndex;
  const visit = (node: typeof root): void => {
    if (typeof node.testTag === "string") {
      const current = out[node.testTag] ?? { count: 0 };
      current.count += 1;
      if (current.count === 1 && node.bounds) current.bounds = { ...node.bounds };
      else if (current.count > 1) delete current.bounds;
      out[node.testTag] = current;
    }
    for (const child of node.children ?? []) visit(child as typeof root);
  };
  visit(root);
  return out;
}
