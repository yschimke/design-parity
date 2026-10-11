/**
 * The emitter's command line, where it can be checked without a bundle, a browser or Figma.
 *
 * The concurrency knob is the one input whose wrong value would otherwise be silent: `0` or a typo
 * read as "one" or as "unbounded" would change how long a publish takes and nothing else, so it is
 * refused at the door instead. That the OUTPUT does not depend on it is the emitter's contract —
 * placement runs in record order and every score lands on its own record.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const EMITTER = path.join(path.dirname(fileURLToPath(import.meta.url)), "emit-design-references.mjs");

for (const value of ["0", "-2", "1.5", "lots"]) {
  test(`--concurrency ${value} is refused rather than guessed at`, () => {
    const run = spawnSync(process.execPath, [EMITTER, "--out", "/nonexistent", "--concurrency", value], {
      encoding: "utf8",
      env: { ...process.env, DESIGN_REFERENCES_CONCURRENCY: "" },
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--concurrency must be a positive integer/);
  });
}

test("the environment carries the same knob, checked the same way", () => {
  const run = spawnSync(process.execPath, [EMITTER, "--out", "/nonexistent"], {
    encoding: "utf8",
    env: { ...process.env, DESIGN_REFERENCES_CONCURRENCY: "0" },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--concurrency must be a positive integer/);
});
