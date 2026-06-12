/**
 * Pair reference and candidate images into per-variant rows, tolerant of a side
 * that omits or labels `size` differently (same rule the diff engine uses:
 * canonicalize via `normalizeSize`, and let an unknown/missing size pair with
 * anything).
 */
import { normalizeSize, type Image } from "@design-parity/core";

/** One reference | candidate | diff row. Any side may be missing. */
export interface Variant {
  /** `state/theme/size` key (raw size), stable for the DOM + diff lookup. */
  key: string;
  state: string;
  theme?: string;
  size?: string;
  reference?: Image;
  candidate?: Image;
}

/** Human/diff key — raw size, matches `@design-parity/diff`'s `imageKey`. */
function imageKey(img: Image): string {
  return [img.state, img.theme, img.size].filter(Boolean).join("/");
}

/** Canonical size token for pairing (falls back to the lowercased label). */
function sizeToken(img: Image): string | undefined {
  return normalizeSize(img.size) ?? img.size?.toLowerCase();
}

/** Pairing key with the size normalized. */
function pairKey(img: Image): string {
  return [img.state, img.theme, sizeToken(img)].filter(Boolean).join("/");
}

/** Looser key ignoring size — used when a side omits/uses an unknown size. */
function looseKey(img: Image): string {
  return [img.state, img.theme].filter(Boolean).join("/");
}

function sizeCompatible(a: Image, b: Image): boolean {
  const ca = normalizeSize(a.size);
  const cb = normalizeSize(b.size);
  return ca === undefined || cb === undefined || ca === cb;
}

/**
 * Pair references with candidates. Output order is stable: references in their
 * declared order first (each with its best candidate match), then any
 * candidate-only variants in their declared order.
 */
export function pairVariants(
  references: readonly Image[],
  candidates: readonly Image[],
): Variant[] {
  const used = new Set<number>();

  const findCandidate = (ref: Image): number => {
    // Prefer an exact normalized-key match, then a size-tolerant loose match.
    const exact = candidates.findIndex(
      (c, i) => !used.has(i) && pairKey(c) === pairKey(ref),
    );
    if (exact !== -1) return exact;
    return candidates.findIndex(
      (c, i) =>
        !used.has(i) && looseKey(c) === looseKey(ref) && sizeCompatible(c, ref),
    );
  };

  const variants: Variant[] = [];

  for (const ref of references) {
    const ci = findCandidate(ref);
    const candidate = ci === -1 ? undefined : candidates[ci];
    if (ci !== -1) used.add(ci);
    variants.push({
      key: imageKey(ref),
      state: ref.state,
      theme: ref.theme,
      size: ref.size,
      reference: ref,
      candidate,
    });
  }

  candidates.forEach((c, i) => {
    if (used.has(i)) return;
    variants.push({
      key: imageKey(c),
      state: c.state,
      theme: c.theme,
      size: c.size,
      candidate: c,
    });
  });

  return variants;
}
