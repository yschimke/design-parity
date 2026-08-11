import type { Bounds, SemanticNode, SemanticTree, TypographyToken } from "@design-parity/core";

export interface PlacedTypography {
  token?: string;
  label?: string;
  role?: string;
  bounds: Bounds;
  typography: TypographyToken;
  color?: string;
}

export interface TypographyGroup {
  key: string;
  token?: string;
  family?: string;
  familyKey?: string;
  typography: TypographyToken;
  nodes: PlacedTypography[];
  roles: Set<string>;
  marker?: string;
}

export interface TypographyPair {
  marker: string;
  reference?: TypographyGroup;
  candidate?: TypographyGroup;
}

export interface TypographyComparison {
  pairs: TypographyPair[];
  referenceMarkers: ReadonlyMap<string, string>;
  candidateMarkers: ReadonlyMap<string, string>;
  referenceDefaults: ReadonlyMap<string, TypographyGroup>;
  candidateDefaults: ReadonlyMap<string, TypographyGroup>;
}

function finite(value: number | string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Material role spelling used by both the Figma adapter and Compose semantics. */
export function normalizeTypographyToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token || token.toLowerCase() === "text") return undefined;
  const m3 = token.match(/^m3[\/-](display|headline|title|body|label)[\/-](large|medium|small)$/i);
  if (!m3) return token;
  return `${m3[1]!.toLowerCase()}${m3[2]!.charAt(0).toUpperCase()}${m3[2]!.slice(1).toLowerCase()}`;
}

/** Treat a weight suffix as metadata, not a different family. */
export function normalizeFontFamily(value: string | undefined): string | undefined {
  const family = value?.trim();
  if (!family) return undefined;
  return family.replace(/[-_](regular|medium|semibold|bold)$/i, "").trim();
}

function groupKey(token: string | undefined, typography: TypographyToken): string {
  return [
    token ?? "",
    normalizeFontFamily(typography.fontFamily)?.toLowerCase() ?? "",
    finite(typography.fontSize) ?? "",
    finite(typography.lineHeight) ?? "",
    finite(typography.fontWeight) ?? typography.fontWeight ?? "",
    typography.letterSpacing ?? "",
    typography.fontStyle ?? "",
    typography.fontVariationSettings ?? "",
  ].join("|");
}

/** One style group per distinct resolved type setting, preserving tree order. */
export function typographyGroups(tree: SemanticTree | undefined): TypographyGroup[] {
  if (!tree) return [];
  const groups = new Map<string, TypographyGroup>();
  const visit = (node: SemanticNode): void => {
    if (node.bounds && node.tokens?.typography) {
      const colors = node.tokens.colors ? Object.values(node.tokens.colors) : [];
      for (const [rawToken, typography] of Object.entries(node.tokens.typography)) {
        const token = normalizeTypographyToken(rawToken);
        const key = groupKey(token, typography);
        let group = groups.get(key);
        if (!group) {
          group = {
            key,
            ...(token ? { token } : {}),
            ...(typography.fontFamily ? { family: typography.fontFamily } : {}),
            ...(normalizeFontFamily(typography.fontFamily)
              ? { familyKey: normalizeFontFamily(typography.fontFamily) }
              : {}),
            typography,
            nodes: [],
            roles: new Set<string>(),
          };
          groups.set(key, group);
        }
        group.nodes.push({
          ...(token ? { token } : {}),
          ...(node.label !== undefined ? { label: node.label } : {}),
          ...(node.role ? { role: node.role } : {}),
          bounds: node.bounds,
          typography,
          ...(colors[0] ? { color: colors[0] } : {}),
        });
        const role = node.label ?? node.role;
        if (role) group.roles.add(role.trim().toLowerCase());
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree.root);
  return [...groups.values()];
}

/** The most-used resolved form of a token is its local default; ties preserve tree order. */
export function typographyDefaults(groups: readonly TypographyGroup[]): ReadonlyMap<string, TypographyGroup> {
  const defaults = new Map<string, TypographyGroup>();
  for (const group of groups) {
    if (!group.token) continue;
    const current = defaults.get(group.token);
    if (!current || group.nodes.length > current.nodes.length) defaults.set(group.token, group);
  }
  return defaults;
}

function distance(left: TypographyGroup, right: TypographyGroup): number {
  if (left.key === right.key) return -200;
  if (left.token && right.token && left.token === right.token) return -100;
  let commonRoles = 0;
  for (const role of left.roles) if (right.roles.has(role)) commonRoles += 1;
  if (commonRoles) return -50 - commonRoles;

  const a = left.typography;
  const b = right.typography;
  let result = 0;
  const aSize = finite(a.fontSize);
  const bSize = finite(b.fontSize);
  result += aSize !== undefined && bSize !== undefined ? Math.abs(aSize - bSize) * 3 : aSize === bSize ? 0 : 8;
  const aLine = finite(a.lineHeight);
  const bLine = finite(b.lineHeight);
  result += aLine !== undefined && bLine !== undefined ? Math.abs(aLine - bLine) * 2 : aLine === bLine ? 0 : 5;
  const aWeight = finite(a.fontWeight);
  const bWeight = finite(b.fontWeight);
  result += aWeight !== undefined && bWeight !== undefined ? Math.abs(aWeight - bWeight) / 100 : aWeight === bWeight ? 0 : 2;
  if ((left.familyKey ?? "").toLowerCase() !== (right.familyKey ?? "").toLowerCase()) result += 2;
  if ((a.fontStyle ?? "normal") !== (b.fontStyle ?? "normal")) result += 1;
  if (a.letterSpacing !== b.letterSpacing) result += 1;
  return result;
}

/** Pair reference and candidate styles deterministically, then assign stable A/B/C markers. */
export function compareTypography(
  referenceTree: SemanticTree | undefined,
  candidateTree: SemanticTree | undefined,
): TypographyComparison {
  const reference = typographyGroups(referenceTree);
  const candidateGroups = typographyGroups(candidateTree);
  const remaining = [...candidateGroups];
  const pairs: Omit<TypographyPair, "marker">[] = reference.map((ref) => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    remaining.forEach((candidate, index) => {
      const candidateDistance = distance(ref, candidate);
      if (candidateDistance < bestDistance) {
        bestIndex = index;
        bestDistance = candidateDistance;
      }
    });
    const candidate = bestIndex >= 0 && bestDistance <= 15 ? remaining.splice(bestIndex, 1)[0] : undefined;
    return { reference: ref, ...(candidate ? { candidate } : {}) };
  });
  remaining.forEach((candidate) => pairs.push({ candidate }));

  const referenceMarkers = new Map<string, string>();
  const candidateMarkers = new Map<string, string>();
  const marked = pairs.map((pair, index): TypographyPair => {
    const marker = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    if (pair.reference) {
      pair.reference.marker = marker;
      referenceMarkers.set(pair.reference.key, marker);
    }
    if (pair.candidate) {
      pair.candidate.marker = marker;
      candidateMarkers.set(pair.candidate.key, marker);
    }
    return { marker, ...pair };
  });
  return {
    pairs: marked,
    referenceMarkers,
    candidateMarkers,
    referenceDefaults: typographyDefaults(reference),
    candidateDefaults: typographyDefaults(candidateGroups),
  };
}

function touches(left: Bounds, right: Bounds, xGap: number, yGap: number): boolean {
  return (
    left.x <= right.x + right.width + xGap &&
    right.x <= left.x + left.width + xGap &&
    left.y <= right.y + right.height + yGap &&
    right.y <= left.y + left.height + yGap
  );
}

function union(nodes: readonly PlacedTypography[]): Bounds {
  const left = Math.min(...nodes.map((node) => node.bounds.x));
  const top = Math.min(...nodes.map((node) => node.bounds.y));
  const right = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.width));
  const bottom = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Surround nearby uses of one style with a single rectangular cluster. */
export function clusterTypography(group: TypographyGroup): Bounds[] {
  const lineHeight = finite(group.typography.lineHeight) ?? 16;
  const xGap = Math.max(12, lineHeight * 4);
  const yGap = Math.max(8, lineHeight * 1.25);
  const clusters: PlacedTypography[][] = [];
  for (const node of group.nodes) {
    const matches = clusters
      .map((cluster, index) => (cluster.some((other) => touches(node.bounds, other.bounds, xGap, yGap)) ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length === 0) {
      clusters.push([node]);
      continue;
    }
    const target = clusters[matches[0]!]!;
    target.push(node);
    for (let i = matches.length - 1; i > 0; i -= 1) target.push(...clusters.splice(matches[i]!, 1)[0]!);
  }
  return clusters.map(union);
}
