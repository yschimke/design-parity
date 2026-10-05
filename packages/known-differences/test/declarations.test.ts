import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The published declarations, as `npm run build` leaves them. CI builds before it tests.
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("published declarations", () => {
  const modules = readdirSync(SRC)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -".ts".length));

  it("emit one declaration file per module", () => {
    for (const module of modules) {
      expect(() => readFileSync(join(DIST, `${module}.d.ts`), "utf8"), module).not.toThrow();
    }
  });

  // A parameter that defaults to `[]` or `null` is otherwise declared as exactly that literal's
  // type, so a TypeScript caller cannot pass a real value. scripts/widen-declarations.mjs widens
  // them; this fails if one is published again.
  it.each([
    ["an empty-array literal", /\?: never\[\]/],
    ["a null literal", /\?: null(?: \| undefined)?[;,)]/],
  ])("type no optional parameter as %s", (_, pattern) => {
    const offenders = modules.flatMap((module) =>
      readFileSync(join(DIST, `${module}.d.ts`), "utf8")
        .split("\n")
        .filter((line) => pattern.test(line))
        .map((line) => `${module}.d.ts: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
