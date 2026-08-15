/**
 * Proposing a design reference per code component, by name.
 *
 * Node ids are not discoverable without API access — a design tool's MCP server
 * exposes only the page a user is looking at, and Code Connect (which would
 * hand the mapping back directly) is gated behind a paid seat. So the ids come
 * from the REST API, and something has to guess which one goes with which
 * component.
 *
 * This is that guess, and it is **only** a guess. It writes no mapping file: it
 * ranks candidates and prints the `reference = "…"` line to paste onto an
 * annotation. A kit names components by its own taxonomy — `Button - tonal`,
 * `Connected button group` — which does not always agree with the documented
 * component names, so a high score is a proposal and not a fact. Keeping the
 * human in the loop is the point, which is why this lives in `baseline`
 * (interactive, never on the Action path) rather than in the resolver.
 *
 * Pure: the caller does the fetching.
 */

/** One component the design file publishes, as a candidate. */
export interface KitCandidate {
  name: string;
  nodeId: string;
  /** The frame or page trail it sits under; often carries the word the name drops. */
  containing: string;
}

/** A candidate with its score, after weighting. */
export interface RankedCandidate extends KitCandidate {
  score: number;
  /** How many of the subject's words this candidate's name actually accounts for. */
  shared: number;
}

/** How much to trust the top proposal. */
export type Confidence = "GOOD" | "MAYBE" | "LOW";

// --- Candidate filtering -----------------------------------------------------
//
// A kit's several hundred components are not several hundred candidates. Most
// are noise here, and leaving them in does not merely add clutter — it WINS
// matches it should not, because an icon named `radio_button_checked` shares
// more tokens with "Checkbox Checked" than the real `Checkbox` component set
// does. A first run proposed exactly that, plus `format_color_fill` for a
// colour role sheet and `text_fields` for a text field.

/** True for a Material Symbols glyph: snake_case with no spaces. */
export const isIcon = (name: string): boolean =>
  /^[a-z0-9]+(_[a-z0-9]+)+$/.test(name.trim());

/** The internal parts a component set is assembled from — real nodes, wrong altitude. */
export const isBuildingBlock = (name: string, containing: string): boolean =>
  /(^|\/)\.?Building [Bb]locks\//.test(name) || /Building [Bb]locks/.test(containing);

/** Another platform's component: a phone/desktop catalog should not resolve to one. */
export const isXr = (name: string, containing: string): boolean =>
  /(^|\/)XR(\/|$)/.test(name) || /\bXR\b/.test(containing);

/** Leading-dot names are a kit's own private components (`.Tonal palettes`). */
export const isPrivate = (name: string): boolean => name.trim().startsWith(".");

/**
 * Multiplier applied to a candidate's raw name score. `0` drops it entirely.
 *
 * Icons are dropped rather than demoted because nothing here should EVER
 * resolve to a glyph — a design catalog compares components. The rest are
 * demoted, so they can still win when genuinely nothing else fits.
 */
export function candidateWeight(name: string, containing: string): number {
  if (isIcon(name)) return 0;
  let weight = 1;
  if (isBuildingBlock(name, containing)) weight *= 0.35;
  if (isXr(name, containing)) weight *= 0.4;
  if (isPrivate(name)) weight *= 0.5;
  return weight;
}

// --- Matching ----------------------------------------------------------------

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Just enough stemming to survive the two ways the same word is spelled either
 * side of the boundary: a kit pluralises the family (`Checkboxes`, `Radio
 * buttons`) where code names one component, and a kit says `Button - outline`
 * where code says `Outlined`. Both are exact-token misses otherwise.
 *
 * Deliberately crude and deliberately short. Anything cleverer starts merging
 * words that only look alike, and a wrong merge here is worse than a miss —
 * it produces a confident proposal for the wrong node.
 */
function stem(token: string): string {
  let t = token;
  // Plurals. `-es` only after a sibilant, or `badges` would stem to `badg`
  // while `badge` stayed put — the very collapse this is meant to produce.
  if (t.length > 4 && /[sxzh]es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s")) t = t.slice(0, -1);
  // Past participles used as adjectives: `outlined`/`outline`, `elevated`.
  if (t.length > 4 && t.endsWith("d")) t = t.slice(0, -1);
  return t;
}

const tokenise = (s: string): Set<string> =>
  new Set(normalise(s).split(" ").filter(Boolean).map(stem));

/** How many tokens two names share, and that as a fraction of the shorter one. */
function overlap(a: string, b: string): { shared: number; ratio: number } {
  const at = tokenise(a);
  const bt = tokenise(b);
  if (!at.size || !bt.size) return { shared: 0, ratio: 0 };
  let shared = 0;
  for (const token of at) if (bt.has(token)) shared += 1;
  return { shared, ratio: shared / Math.min(at.size, bt.size) };
}

/**
 * Token-overlap score in [0, 1]: how much of the SHORTER name the two share.
 *
 * Shorter rather than longer, so a candidate whose name is a superset —
 * `Button segment` against `Button` — is not punished for its extra words.
 */
export function score(a: string, b: string): number {
  return overlap(a, b).ratio;
}

/** Thresholds the confidence label reads. Tuned on the Material 3 kit. */
const GOOD = 0.67;
const MAYBE = 0.34;

export function confidenceOf(best: RankedCandidate | undefined): Confidence {
  if (!best || best.score < MAYBE) return "LOW";
  return best.score < GOOD ? "MAYBE" : "GOOD";
}

export interface RankOptions {
  /** How many proposals to keep. */
  limit?: number;
}

/**
 * The best candidates for one code component, best first.
 *
 * `subject` should carry the component's group as well as its id — a kit names
 * by its own taxonomy, and the group often carries the word the leaf drops
 * (`Button/Tonal` is `Button - tonal` there).
 *
 * Each candidate is scored against its bare name AND against name-plus-trail,
 * taking the better: the trail rescues a component whose own name is generic
 * (`Button segment`) and would hurt one whose name is already exact, since
 * every extra token dilutes the overlap.
 */
export function rankCandidates(
  subject: string,
  candidates: readonly KitCandidate[],
  opts: RankOptions = {},
): RankedCandidate[] {
  const limit = opts.limit ?? 3;
  return candidates
    .map((candidate) => {
      const bare = overlap(subject, candidate.name);
      const trailed = overlap(subject, `${candidate.name} ${candidate.containing}`);
      // Strictly better only. Counting the trail's extra shared words on a tie
      // is tempting and wrong: a bare `Icon` sitting under an `Icon button`
      // frame would then tie `Icon button` on words shared and win on being
      // shorter, which is the part beating the component.
      const best = trailed.ratio > bare.ratio ? trailed : bare;
      return {
        ...candidate,
        score: best.ratio * candidateWeight(candidate.name, candidate.containing),
        shared: best.shared,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // A tie on the RATIO means both names are fully accounted for; the one
        // accounting for MORE of the subject is the more specific component.
        // `Button/Elevated` against a kit holding both `Button` and `Button -
        // elevated` scores 1.0 either way — one shares a word, the other shares
        // two, and the two-word match is the one a human picks. Measured
        // against the 116 references a human accepted by hand for the Material
        // 3 kit, this alone moved the top proposal onto the accepted node for
        // 8 more of them (63 → 71).
        b.shared - a.shared ||
        // Still tied, so the extra words are noise: between `Button` and
        // `Button segment` for a subject of just "Button", the plainer name is
        // the component and the other is a part of one.
        a.name.length - b.name.length,
    )
    .slice(0, limit);
}

/** The subject string to rank against: the group plus the id, de-slashed. */
export function subjectFor(componentId: string, group?: string): string {
  return `${group ?? ""} ${componentId.replace(/\//g, " ")}`.trim();
}

// --- Subjects ----------------------------------------------------------------

/** One thing to propose a reference for. */
export interface ProposalSubject {
  /** How the repo names it — what a human will paste the reference next to. */
  label: string;
  /** The words to match on, which may carry a group the label doesn't. */
  text: string;
}

/**
 * The subset of a compose-preview manifest this reads. Structural on purpose:
 * the manifest is compose-ai-tools' artifact, and pinning its whole shape here
 * would make an unrelated field of theirs a breaking change here.
 */
export interface PreviewManifestLike {
  previews?: {
    catalog?: { role?: string; componentId?: string; group?: string };
  }[];
}

/**
 * Subjects from a compose-preview manifest, sorted by component id.
 *
 * `COMPONENT`-role previews only — a manifest also carries screens and gallery
 * entries, and neither has a component-level reference to propose. First
 * preview per component id wins: several previews picturing one component are
 * variants of a single reference, not several references.
 */
export function subjectsFromPreviewManifest(
  manifest: PreviewManifestLike,
): ProposalSubject[] {
  const seen = new Map<string, ProposalSubject>();
  for (const preview of manifest.previews ?? []) {
    const entry = preview.catalog;
    if (entry?.role !== "COMPONENT" || !entry.componentId) continue;
    if (seen.has(entry.componentId)) continue;
    seen.set(entry.componentId, {
      label: entry.componentId,
      text: subjectFor(entry.componentId, entry.group),
    });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// --- Collecting candidates from a file tree ----------------------------------

/**
 * The structural shape a tree walk needs, so this module stays independent of
 * any one adapter's node type. A Figma `FigmaNodeDoc` satisfies it.
 */
export interface CandidateNode {
  id: string;
  name: string;
  type: string;
  children?: CandidateNode[];
}

/** Node types that ARE a candidate, rather than something containing one. */
const COMPONENT_TYPES = new Set(["COMPONENT_SET", "COMPONENT"]);

/**
 * Every component reachable from `root`, with the trail of frames it sits under.
 *
 * Stops at the first component-ish node on each branch: descending into a
 * component set would yield its variants (`Button/Size=Small`), which are not
 * candidates for a component-level reference and would each outscore the set
 * they belong to on any name that happens to mention a size.
 *
 * `root` is normally a page, and its name heads every trail: a kit that names a
 * page `Navigation` is the only thing telling you that the `Rail` on it is a
 * navigation rail.
 */
export function candidatesFromTree(root: CandidateNode): KitCandidate[] {
  const found: KitCandidate[] = [];
  const walk = (node: CandidateNode, trail: string[]): void => {
    if (COMPONENT_TYPES.has(node.type)) {
      found.push({ name: node.name, nodeId: node.id, containing: trail.join(" / ") });
      return;
    }
    for (const child of node.children ?? []) walk(child, [...trail, node.name]);
  };
  walk(root, []);
  return found;
}
