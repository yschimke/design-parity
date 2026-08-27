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
import { normaliseAlpha } from "./vendor/png-lite.js";
import { SCORE_TUNING } from "./vendor/known-difference-tuning.js";

/**
 * One incoming raster on the contract's straight-alpha grid, without touching the caller's buffer.
 *
 * `png-lite`'s rule is that the normalisation applies to **every** raster reaching a comparison, not
 * only to PNGs it decoded itself — a raster off a canvas has been through the host's premultiplied
 * round trip and one read from a file has not. Our conformance suite decodes through `decodePng` and
 * so was already on the grid; the production path reads with `pngjs` (`visual.ts`) and was not, so
 * colour 200 at alpha 128 arrived as 200 here and as 199 there. That is `candidate-changed` on a
 * candidate whose bytes never moved, decided by which decoder read the file.
 *
 * Copied rather than normalised in place because `diffImagePair` keeps using the same buffers for
 * `pixelmatch` and the triptych: the acceptance verdict is what this contract governs, and silently
 * moving the pixels the visual score is computed over would be a different change.
 *
 * `normaliseAlpha` is idempotent, so applying it to a raster a caller already normalised is free
 * rather than wrong — which is what lets this sit here without knowing where the raster came from.
 */
function onTheContractGrid(raster: {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}): { width: number; height: number; pixels: Uint8Array } {
  const pixels = Uint8Array.from(raster.pixels);
  normaliseAlpha(pixels);
  return { width: raster.width, height: raster.height, pixels };
}

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

  const reference = onTheContractGrid(input.reference);
  const candidate = onTheContractGrid(input.candidate);
  const resolved = resolvePlane(reference, candidate);
  const result = evaluateKnownDifferences({
    documentText,
    readArtifact: artifactReader(artifactRoot),
    comparison: {
      ...input.scope,
      referenceSha256: input.scope.referenceSha256 ?? null,
      plane: resolved.plane,
      canonicalReference: canonicalRaster(
        reference,
        resolved.boxes.reference,
        resolved.plane,
      ),
      canonicalCandidate: canonicalRaster(
        candidate,
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
    // The same normalised rasters the gates ran on. The score is computed over the same pixels the
    // verdict is, and the conformance suite scores over `decodePng` output — so scoring the raw
    // buffers here would put the published number on a different grid from the one it is pinned on.
    reference,
    candidate,
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
      // Read from the engine's own tuning at the point the numbers are produced. Restating it
      // anywhere downstream would let a caller label a score with a kernel it does not implement.
      version: SCORE_TUNING.SCORE_VERSION,
    },
    suppressing: survivors.map((entry: { id: string }) => entry.id),
  };
}

/** @internal Exported for a focused regression test; not part of the package entry point. */
export function refuseElementAcceptancesWithoutSemantics(
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
    const current = statuses[id];
    const reasons = current.status === "refused" ? current.reasons ?? [] : [];
    statuses[id] = {
      status: "refused",
      reasons: [...new Set([...reasons, "semantics-unavailable"])],
    };
    if (!failures.some((failure) =>
      failure.id === id && failure.reason === "semantics-unavailable"
    )) {
      failures.push({ id, reason: "semantics-unavailable" });
    }
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
