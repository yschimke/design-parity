/**
 * The candidate side as a **pluggable strategy**.
 *
 * design-parity can obtain a {@link CandidateRender} for a component in more
 * than one way — read it out of a pre-rendered compose-ai-tools preview bundle,
 * shell out to the `compose-preview` CLI, render it in-process via Compose for
 * Web, or talk to a long-lived compose-preview daemon. Each is a
 * {@link CandidateSource}: one method, one contract, swappable and composable.
 *
 * Phase 1 of issue #38 ships the static {@link CandidateSource} for preview
 * bundles fully; the CLI source wraps the existing renderer; the local-CMP and
 * daemon sources are defined but stubbed (see `docs/candidate-sources.md`).
 */
import type { AdapterContext, CandidateRender } from "@design-parity/core";

/**
 * A strategy for producing a {@link CandidateRender} for one component.
 *
 * Implementations resolve a single component on demand. Returning `undefined`
 * (rather than throwing) means *this source has no candidate for that id* — a
 * normal, expected outcome that lets {@link firstAvailable} fall through to the
 * next source. Throw only on a genuine failure (corrupt input, unreachable
 * backend, not-implemented).
 */
export interface CandidateSource {
  /** Stable discriminator for logging/diagnostics, e.g. `"bundle"`. */
  readonly kind: string;
  /**
   * Resolve the candidate render for `componentId`, or `undefined` if this
   * source does not have one.
   */
  getCandidate(
    componentId: string,
    ctx: AdapterContext,
  ): Promise<CandidateRender | undefined>;
}

/**
 * Combine sources into one that tries each in order and returns the first
 * non-`undefined` candidate. A source that *throws* is not caught here — a hard
 * failure is surfaced, only a clean `undefined` falls through. Order encodes
 * preference (e.g. a cheap static bundle before an expensive live render).
 */
export function firstAvailable(sources: CandidateSource[]): CandidateSource {
  return {
    kind: `firstAvailable(${sources.map((s) => s.kind).join(",")})`,
    async getCandidate(componentId, ctx) {
      for (const source of sources) {
        const candidate = await source.getCandidate(componentId, ctx);
        if (candidate !== undefined) return candidate;
      }
      return undefined;
    },
  };
}
