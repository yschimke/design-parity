import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

/**
 * A public signature must not name a type consumers cannot import.
 *
 * `renderAcceptanceSummary` is exported, so its parameter type is part of the contract — but the
 * package ships a single entry point, and a type re-exported from `acceptance/index.ts` and missed
 * in `src/index.ts` is invisible to every consumer. Nothing catches that: the build is happy, the
 * tests are happy, and the only person who finds out is someone downstream, who then duplicates
 * the declaration or derives it indirectly, which is a second copy of a contract — the failure
 * this package spends so much effort avoiding elsewhere.
 *
 * That is exactly what happened when `PersistedAcceptanceReport` was introduced for callers holding
 * a report serialized before `scores.version` existed: the alias existed to be imported, and could
 * not be.
 *
 * So this checks the rule rather than that one name: every type declared in `acceptance/types.ts`
 * that appears in an exported signature in `diff.ts` must reach the package root.
 */
describe("the public entry point", () => {
  const declared = [...read("acceptance", "types.ts").matchAll(/^export (?:interface|type) (\w+)/gm)]
    .map((match) => match[1]);
  const diffSource = read("diff.ts");
  const rootSource = read("index.ts");

  // The parameter list of each exported function — where a consumer has to be able to name the type.
  const signatures = [...diffSource.matchAll(/^export (?:async )?function \w+\(([\s\S]*?)\n\): /gm)]
    .map((match) => match[1])
    .join("\n");

  const named = declared.filter((name) => new RegExp(`\\b${name}\\b`).test(signatures));

  it("names types in its signatures that it also exports", () => {
    // Guard the guard: if the regexes above stop matching anything, the assertion below passes
    // vacuously and this file becomes decoration.
    expect(declared.length).toBeGreaterThan(0);
    expect(named.length).toBeGreaterThan(0);

    const unreachable = named.filter(
      (name) => !new RegExp(`^\\s*${name},\\s*$`, "m").test(rootSource),
    );
    expect(unreachable, `not re-exported from src/index.ts: ${unreachable.join(", ")}`).toEqual([]);
  });
});
