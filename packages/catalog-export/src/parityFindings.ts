/**
 * Project a run's **verdict** into the manifest a preview server reads
 * (`compose-preview-parity-findings/v1`).
 *
 * The sibling module `annotations.ts` carries what each side *is* — the padding,
 * the type style — anchored to a region. This carries what the run *concluded*
 * about the pair: that a label truncates once localized, that padding is 24
 * where the spec asserts 16, that the two frames were never comparable. Neither
 * is derivable from the other, which is why they are two manifests: an
 * annotation reports both numbers without knowing which one the spec asserts,
 * and a visual score moves identically for a padding change and a colour change.
 *
 * Until this existed those sentences lived only in `@design-parity/report-html`'s
 * self-contained page, published to a reporting branch. That page is the right
 * artifact for a pull request — it inlines its own pixels and outlives the run —
 * and the wrong one for someone browsing the catalog, who is already looking at
 * the comparison and has no reason to know a second branch exists.
 *
 * ## Anchors
 *
 * The server draws a finding's regions over the panels, so a finding has to say
 * *where* it is in the same pixel space the annotation layers use — each panel's
 * own. Findings do not carry geometry, so it is recovered here, from the trees
 * the run already diffed, by the rule that fits each kind:
 *
 * - a `detail.bounds` is used as it stands. `@design-parity/checks`' a11y checks
 *   emit one (a touch target is a measured box), and a box the check measured is
 *   better than a box we re-derive from its label.
 * - a `detail.label` is resolved against each tree by label, the same match
 *   `report-html`'s overlay makes for its layout deltas. Deliberately the same
 *   rule rather than a second one: two matchers would let the report and the
 *   server disagree about which element a finding is about.
 * - a `token` finding anchors to each tree's ROOT frame, because that is the
 *   scope of the claim — `tokens.ts` compares the reference's component-level
 *   token set against the candidate's, so `spacing.padding` is an assertion about
 *   the component's own box and not about any node inside it.
 * - anything else gets none, and reads as prose. A finding with no honest anchor
 *   must not be given a plausible one: a highlight pointing at the wrong element
 *   is worse than no highlight, because the reader has no way to tell.
 *
 * Pure functions over core types — no I/O, trivially testable.
 */
import type {
  Bounds,
  Finding,
  SemanticNode,
  SemanticTree,
  Verdict,
  VerdictStatus,
} from "@design-parity/core";

/** Schema id the preview server validates before reading the manifest. */
export const PARITY_FINDINGS_SCHEMA = "compose-preview-parity-findings/v1";

/** Which panel a region belongs to, in the server's own vocabulary. */
export type ParitySide = "reference" | "actual";

/** A region of one panel, in that panel image's own pixel space. */
export interface ParityAnchor {
  side: ParitySide;
  bounds: Bounds;
  label?: string;
}

/** One finding, as the server transports it. */
export interface ParityFinding {
  kind: string;
  severity: string;
  message: string;
  /** Flattened: the wire type is `Record<string, string>`, not arbitrary JSON. */
  detail?: Record<string, string>;
  anchors?: ParityAnchor[];
}

/** One run's conclusion about one (preview, reference) pair. */
export interface ParityFindingSet {
  referenceId?: string;
  /**
   * Which design source this verdict was measured against (`figma`, `stitch`, …).
   *
   * The joinable identity a producer CAN supply where `referenceId` — minted at publish — is one it
   * cannot. It matters as soon as one code handle is diffed against several sources: those results
   * share a code handle and a candidate preview id, so without this a publisher has no way to tell
   * the Figma verdict from the Stitch one and would show each against both boards. A preview server
   * ignores the field; it exists for the step in between.
   */
  source?: string;
  status?: VerdictStatus;
  reportUrl?: string;
  findings: ParityFinding[];
}

export interface ParityFindingsManifest {
  schema: typeof PARITY_FINDINGS_SCHEMA;
  generatedAt?: string;
  /** Keyed by exact compose-preview / sticker id — the ids the compare page routes on. */
  previews: Record<string, ParityFindingSet[]>;
}

/** The trees the run diffed, used to recover a finding's geometry. */
export interface ParityTrees {
  /** The candidate's render semantics — bounds in the render's own pixels. */
  candidate?: SemanticTree;
  /** The reference's captured layout — bounds in the reference raster's own pixels. */
  reference?: SemanticTree;
}

export interface ParityFindingSetOptions extends ParityTrees {
  /** The serve/catalog reference id this verdict compared against, when known. */
  referenceId?: string;
  /** The design source it was measured against, for a publisher that has to tell two apart. */
  source?: string;
  /** Where the run published its own report, so the panel can link out to it. */
  reportUrl?: string;
}

/** A drawable box: integral, non-negative, and with area. */
function drawable(bounds: Bounds | undefined): Bounds | undefined {
  if (!bounds) return undefined;
  const { x, y, width, height } = bounds;
  if (
    ![x, y, width, height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
  ) {
    return undefined;
  }
  const box = {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.round(width),
    height: Math.round(height),
  };
  return box.width > 0 && box.height > 0 ? box : undefined;
}

/** Whether a value is a `Bounds`-shaped object, as a check's `detail` may carry. */
function asBounds(value: unknown): Bounds | undefined {
  if (!value || typeof value !== "object") return undefined;
  const b = value as Record<string, unknown>;
  const numeric = ["x", "y", "width", "height"].every(
    (k) => typeof b[k] === "number",
  );
  return numeric ? (value as Bounds) : undefined;
}

/** First node in a tree whose label matches, case- and whitespace-insensitively. */
function nodeByLabel(
  tree: SemanticTree | undefined,
  label: string,
): SemanticNode | undefined {
  if (!tree) return undefined;
  const want = label.trim().toLowerCase();
  if (!want) return undefined;
  let found: SemanticNode | undefined;
  const visit = (node: SemanticNode): void => {
    if (found) return;
    if (
      node.bounds &&
      node.label !== undefined &&
      node.label.trim().toLowerCase() === want
    ) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree.root);
  return found;
}

/** Flatten a `detail` to the string map the wire type carries, dropping what cannot flatten. */
function flattenDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!detail) return out;
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean")
      out[key] = String(value);
    // `bounds` and the nested conflict lists are geometry and structure, not a readout: they are
    // consumed as anchors above, and stringifying them would print JSON into a hover card.
    else if (key !== "bounds") out[key] = JSON.stringify(value);
  }
  return out;
}

/**
 * Where a finding is, on whichever panels can place it.
 *
 * Both sides are resolved independently and either may come back empty. That is
 * the honest outcome for a reference whose adapter captured no geometry, and for
 * a candidate node the design file has no counterpart for — a finding anchored on
 * one panel only still answers "where" for the panel that has it.
 */
export function findingAnchors(
  finding: Finding,
  trees: ParityTrees,
): ParityAnchor[] {
  const anchors: ParityAnchor[] = [];
  const detail = finding.detail as Record<string, unknown> | undefined;

  // A box the check itself measured. Checks run over the CANDIDATE, so this is the render's space.
  const measured = drawable(asBounds(detail?.["bounds"]));
  if (measured) {
    anchors.push({ side: "actual", bounds: measured });
    return anchors;
  }

  const label =
    typeof detail?.["label"] === "string"
      ? (detail["label"] as string)
      : undefined;
  if (label) {
    for (const [side, tree] of [
      ["reference", trees.reference],
      ["actual", trees.candidate],
    ] as const) {
      const bounds = drawable(nodeByLabel(tree, label)?.bounds);
      if (bounds) anchors.push({ side, bounds, label: label.trim() });
    }
    if (anchors.length) return anchors;
  }

  if (finding.kind === "token") {
    for (const [side, tree] of [
      ["reference", trees.reference],
      ["actual", trees.candidate],
    ] as const) {
      const bounds = drawable(tree?.root.bounds);
      if (bounds) anchors.push({ side, bounds });
    }
  }
  return anchors;
}

/** One finding, projected onto the wire. */
export function toParityFinding(
  finding: Finding,
  trees: ParityTrees = {},
): ParityFinding {
  const detail = flattenDetail(
    finding.detail as Record<string, unknown> | undefined,
  );
  const anchors = findingAnchors(finding, trees);
  return {
    kind: finding.kind,
    severity: finding.severity,
    message: finding.message,
    ...(Object.keys(detail).length ? { detail } : {}),
    ...(anchors.length ? { anchors } : {}),
  };
}

/**
 * One verdict as a finding set.
 *
 * The status is the run's, carried rather than re-derived: a run that accepted a
 * known difference concluded `pass` over a finding it still reports, and a server
 * re-reading the severities would overrule it.
 */
export function buildParityFindingSet(
  verdict: Verdict,
  options: ParityFindingSetOptions = {},
): ParityFindingSet {
  const { referenceId, source, reportUrl, ...trees } = options;
  return {
    ...(referenceId ? { referenceId } : {}),
    ...(source ? { source } : {}),
    status: verdict.status,
    ...(reportUrl ? { reportUrl } : {}),
    findings: verdict.findings.map((finding) =>
      toParityFinding(finding, trees),
    ),
  };
}

/** One (preview, verdict) pair to publish. */
export interface ParityFindingsEntry extends ParityFindingSetOptions {
  /**
   * Every id the compare page may route on for this verdict — the sticker id and,
   * where a producer holds it, the fully-qualified preview id. Both are keyed, for
   * the same reason `buildAnnotationManifest` keys both: a consumer holding either
   * one resolves.
   */
  previewIds: readonly string[];
  verdict: Verdict;
}

/**
 * Build the manifest for a run's verdicts.
 *
 * A verdict with no findings is omitted rather than published as an empty set: a
 * clean comparison is the common case, and a panel headed "Design parity" with
 * nothing under it on every passing component is noise the reader learns to skip
 * past — taking the failing ones with it.
 */
export function buildParityFindingsManifest(
  entries: readonly ParityFindingsEntry[],
  generatedAt?: string,
): ParityFindingsManifest {
  const previews: Record<string, ParityFindingSet[]> = {};
  for (const entry of entries) {
    const set = buildParityFindingSet(entry.verdict, entry);
    if (set.findings.length === 0) continue;
    for (const previewId of new Set(
      entry.previewIds.filter((id) => id.trim()),
    )) {
      (previews[previewId] ??= []).push(set);
    }
  }
  return {
    schema: PARITY_FINDINGS_SCHEMA,
    ...(generatedAt ? { generatedAt } : {}),
    previews,
  };
}

/** True when a manifest would show nothing — callers skip writing it entirely. */
export function isEmptyParityFindings(
  manifest: ParityFindingsManifest,
): boolean {
  return Object.keys(manifest.previews).length === 0;
}
