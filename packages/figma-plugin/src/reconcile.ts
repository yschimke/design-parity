/**
 * The pure **reconcile planner** — how a re-import maps onto an existing board.
 *
 * v1 imported a catalog by deleting the page and rebuilding it: every re-import
 * regenerated every node id and destroyed anything a designer had added. v2
 * reconciles instead, keyed by **identity, not position**: each card the plugin
 * places is stamped with its catalog `componentId` (see {@link STAMP} in
 * `scene.ts`), and a re-import matches the incoming catalog against those stamps.
 *
 * This module is the *decision* half — pure, no `figma`, no I/O: given the
 * `componentId`s already on the board and the ones in the incoming plan, it says
 * which cards to **update** in place, which to **add**, and which are now
 * **stale** (gone from the catalog). `scene.ts` executes that decision against
 * the scene. Keeping it here makes the reconcile logic unit-testable without a
 * Figma runtime, the same way `plan.ts` keeps the layout logic testable.
 */

/** A card already on the board, located by its identity stamp. */
export interface ExistingCard {
  /** The catalog `componentId` this card was stamped with. */
  componentId: string;
  /** The Figma node id of the card frame, so the executor can act on it. */
  nodeId: string;
}

/** What a re-import should do, bucketed by identity. */
export interface ReconcileActions {
  /** Present in both the board and the incoming plan → update the render in place. */
  update: string[];
  /** In the incoming plan but not yet on the board → add a new card. */
  add: string[];
  /** On the board but gone from the incoming plan → tag stale, never delete. */
  stale: ExistingCard[];
}

/**
 * Diff the board's stamped cards against the incoming plan's components.
 *
 * Matching is purely by `componentId` — a designer can move, rename, or regroup
 * a card and it still reconciles, because the stamp travels with the node.
 * Ordering of each bucket follows the incoming plan (for `update`/`add`) and the
 * existing board (for `stale`), so the executor's work is deterministic.
 *
 * A duplicate `componentId` on the board (two cards stamped the same) keeps the
 * **first** as the update target and treats the rest as stale, so a re-import
 * converges on one card per component instead of updating an arbitrary one.
 */
export function reconcile(
  existing: ExistingCard[],
  plannedComponentIds: string[],
): ReconcileActions {
  const seen = new Set<string>();
  const firstByComponent = new Map<string, ExistingCard>();
  const duplicates: ExistingCard[] = [];
  for (const card of existing) {
    if (firstByComponent.has(card.componentId)) {
      duplicates.push(card);
    } else {
      firstByComponent.set(card.componentId, card);
    }
  }

  const planned = new Set(plannedComponentIds);
  const update: string[] = [];
  const add: string[] = [];
  for (const componentId of plannedComponentIds) {
    if (seen.has(componentId)) continue; // ignore accidental plan dupes
    seen.add(componentId);
    if (firstByComponent.has(componentId)) update.push(componentId);
    else add.push(componentId);
  }

  const stale: ExistingCard[] = [];
  for (const card of firstByComponent.values()) {
    if (!planned.has(card.componentId)) stale.push(card);
  }
  // Duplicates are stale regardless of whether the componentId is still planned:
  // the first match already owns the update, so extra copies converge to stale.
  stale.push(...duplicates);

  return { update, add, stale };
}
