/**
 * How well the ranking agrees with a human, on a real kit.
 *
 * The unit tests pin individual rules; this pins the thing the rules exist for.
 * The fixture is the Material 3 Design Kit's 98 component sets, the 116
 * components of [m3-catalog](https://github.com/yschimke/m3-catalog), and the
 * reference a human actually accepted for each — so "did this change help?" has
 * an answer that is not an opinion.
 *
 * The thresholds are floors, not targets. They are deliberately a little below
 * where the ranking currently sits, so an unrelated change that costs one
 * component doesn't fail the build, while a change that quietly costs ten does.
 * Raise them when a change earns it; never lower them to make a change pass.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { rankCandidates, type KitCandidate } from "../src/ref-proposals.js";

interface Fixture {
  fileKey: string;
  candidates: KitCandidate[];
  components: { label: string; subject: string; accepted: string | null }[];
}

const fixture: Fixture = JSON.parse(
  await readFile(fileURLToPath(new URL("./fixtures/m3-ref-proposals.json", import.meta.url)), "utf8"),
);

/** Where the accepted node landed for each component: 0 = top, -1 = not proposed. */
function ranks(): number[] {
  return fixture.components
    .filter((c) => c.accepted !== null)
    .map((c) => rankCandidates(c.subject, fixture.candidates).findIndex((r) => r.nodeId === c.accepted));
}

describe("rankCandidates against the Material 3 kit", () => {
  it("proposes the accepted node first for most components", () => {
    const top1 = ranks().filter((r) => r === 0).length;
    expect(top1).toBeGreaterThanOrEqual(75); // 79 at the time of writing, of 116
  });

  it("puts the accepted node somewhere in the three proposals for nearly all of them", () => {
    const found = ranks().filter((r) => r >= 0).length;
    expect(found).toBeGreaterThanOrEqual(105); // 110 at the time of writing
  });

  it("never proposes an icon glyph", () => {
    // The failure the weighting exists for. A glyph winning here would be a
    // confident proposal for a node that cannot be compared against a render.
    const proposed = fixture.components.flatMap((c) =>
      rankCandidates(c.subject, fixture.candidates).map((r) => r.name),
    );
    expect(proposed.filter((name) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(name))).toEqual([]);
  });
});
