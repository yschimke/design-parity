/**
 * The conformance runner for the separated-plane score — batch 05's half of
 * `compose-preview-known-differences/v1`.
 *
 * Split from `known-differences.test.mjs` for the same reason the fixtures are: the gate cases are
 * handed canonical planes and no source rasters, so they have nothing to score, and the scoring
 * cases start from a *given* surviving union rather than re-deriving it. A divergence then fails at
 * the stage that caused it, which is the whole point of paying for intermediate pins at all.
 *
 * As in the gate suite, the fixture tree is read the way any runtime would read it — `case.json` for
 * the geometry and the masks, `expected.json` for the verdict and which of its keys are normative —
 * so `design-parity`'s suite and the server's Kotlin tests can be written against it unchanged.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng } from "../../dist/png-lite.js";
import { SCORE_TUNING } from "../../dist/known-difference-tuning.js";
import {
  contentBox,
  projectTagIndex,
  resolvePlane,
} from "../../dist/known-difference-plane.js";
import { REGIONS, scoreComparison } from "../../dist/known-difference-score.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCORING = join(HERE, "fixtures", "known-differences", "scoring");
const PLANE = join(HERE, "fixtures", "known-differences", "plane");
const TAG_PROJECTION = join(HERE, "fixtures", "known-differences", "tag-projection");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPng(path) {
  return decodePng(new Uint8Array(readFileSync(path)));
}

for (const id of readdirSync(SCORING).sort()) {
  const dir = join(SCORING, id);
  const meta = readJson(join(dir, "case.json"));
  const expected = readJson(join(dir, "expected.json"));

  test(`scoring: ${id} — ${meta.title}`, () => {
    const result = scoreComparison({
      reference: readPng(join(dir, meta.reference)),
      candidate: readPng(join(dir, meta.candidate)),
      referenceBox: meta.referenceBox,
      candidateBox: meta.candidateBox,
      plane: meta.plane,
      masks: meta.masks.map((path) => readPng(join(dir, path))),
    });

    for (const pin of expected.pins) {
      switch (pin) {
        case "scorePlane":
          assert.deepEqual(result.stages.plane, expected.scorePlane);
          break;
        case "presence": {
          // The **scored** set: present on both sides. A coordinate one side did not draw into has
          // nothing to compare against, and the two disagree only where a footprint straddles the
          // region boundary on one side alone.
          const counts = {};
          for (const region of REGIONS) counts[region] = scoredCount(result, region);
          assert.deepEqual(counts, expected.presence);
          break;
        }
        case "samples":
          for (const sample of expected.samples) {
            const plane = result.stages.regions[sample.region][sample.side];
            const index = sample.y * plane.width + sample.x;
            assert.equal(
              Boolean(plane.present[index]),
              sample.present,
              `${sample.region}/${sample.side} (${sample.x},${sample.y}) presence`,
            );
            if (!sample.present) continue;
            assert.deepEqual(
              [...plane.pixels.subarray(index * 4, index * 4 + 4)],
              sample.rgba,
              `${sample.region}/${sample.side} (${sample.x},${sample.y}) pixels`,
            );
          }
          break;
        case "scores":
          for (const [key, value] of Object.entries(expected.scores)) {
            // `epsilon` rather than an exact compare: a luminance is a float dot product, so an
            // engine agreeing on the algorithm lands within a double's rounding of the declared
            // decimal. An engine *disagreeing* about the algorithm misses by orders of magnitude
            // more than this, which is what keeps the tolerance from hiding anything.
            assert.ok(
              Math.abs(result[key] - value) <= expected.epsilon,
              `${key}: expected ${value}, got ${result[key]}`,
            );
          }
          break;
        case "rawEqualsUnaccepted":
          // Bit for bit, not within epsilon. I6 is an identity of stages, and "close enough" is
          // exactly the reading that lets a shortcut path for `raw` survive.
          assert.equal(result.raw === result.unaccepted, expected.rawEqualsUnaccepted);
          break;
        default:
          assert.fail(`unknown pin \`${pin}\` in scoring/${id}/expected.json`);
      }
    }
  });
}

for (const id of readdirSync(PLANE).sort()) {
  const dir = join(PLANE, id);
  const meta = readJson(join(dir, "case.json"));
  const expected = readJson(join(dir, "expected.json"));

  test(`plane: ${id} — ${meta.title}`, () => {
    const reference = readPng(join(dir, meta.reference));
    const candidate = readPng(join(dir, meta.candidate));
    const resolved = resolvePlane(reference, candidate);

    for (const pin of expected.pins) {
      switch (pin) {
        case "referenceContentBox":
          assert.deepEqual(contentBox(reference), expected.referenceContentBox);
          break;
        case "candidateContentBox":
          assert.deepEqual(contentBox(candidate), expected.candidateContentBox);
          break;
        case "plane":
          assert.deepEqual(resolved.plane, expected.plane);
          break;
        case "boxes":
          assert.deepEqual(resolved.boxes, expected.boxes);
          break;
        default:
          assert.fail(`unknown pin \`${pin}\` in plane/${id}/expected.json`);
      }
    }
  });
}

for (const id of readdirSync(TAG_PROJECTION).sort()) {
  const dir = join(TAG_PROJECTION, id);
  const meta = readJson(join(dir, "case.json"));
  const expected = readJson(join(dir, "expected.json"));

  test(`tag projection: ${id} — ${meta.title}`, () => {
    // **Own enumerable entries, not object identity.** `projectTagIndex` returns a null-prototype
    // map so a tag named `__proto__` or `constructor` is an ordinary key rather than the prototype
    // or an inherited false positive; `expected` comes back from `JSON.parse` with the ordinary one.
    // A strict `deepEqual` between the two compares *that* difference, which is an artifact of how
    // this runner happens to read the fixture rather than anything the contract pins — a runtime
    // without JavaScript prototypes has no such distinction to make. Spreading normalises both
    // sides to the thing the tree actually specifies: which keys are present, and their values.
    // Spread defines own properties rather than assigning, so `__proto__` survives the copy.
    const projected = projectTagIndex(meta.tagIndex, meta.candidateBox, meta.plane);
    assert.deepEqual({ ...projected }, { ...expected });
  });
}

function scoredCount(result, region) {
  const planes = result.stages.regions[region];
  let count = 0;
  for (let i = 0; i < planes.reference.present.length; i++) {
    if (planes.reference.present[i] && planes.candidate.present[i]) count++;
  }
  return count;
}

// -----------------------------------------------------------------------------------------------
// The mirror. Not expressible as a fixture, because it is about two files agreeing rather than about
// any comparison.
// -----------------------------------------------------------------------------------------------

// The browser half of the mirror, `serve-web/src/scorer/tuning.ts`, lives in
// yschimke/compose-preview-server. Its `test/scorerTuningMirror.test.ts` compares those constants
// with this package's `SCORE_TUNING` and `PLANE_TUNING` directly, since serve-web depends on the
// published engine; a cross-repository checkout here would only ever skip.

test("the engine imports nothing a browser lacks", () => {
  // The property `format-compare.js` depends on, and one that regresses in a single line. The
  // browser engine and the offline engine are the *same* module — that is how "two engines, one
  // semantics" is enforced here rather than merely fixtured — so a `node:` import anywhere in this
  // graph breaks the bundle rather than degrading it, and it would do so in a build nobody runs on
  // the way to a fixture pass.
  const graph = [
    "known-differences.ts",
    "known-difference-score.ts",
    "known-difference-tuning.ts",
    "known-difference-plane.ts",
    "known-difference-resample.ts",
    "png-lite.ts",
    "inflate-lite.ts",
    "sha256-lite.ts",
  ];
  for (const name of graph) {
    const source = readFileSync(join(HERE, "..", "..", "src", name), "utf8");
    const nodeImports = [...source.matchAll(/^import[^;]*from\s+"(node:[^"]+)"/gm)].map(([, id]) => id);
    assert.deepEqual(nodeImports, [], `${name} imports ${nodeImports.join(", ")}`);
    // Comments stripped first: these files explain *why* they avoid `Buffer`, and a check that
    // cannot tell an explanation from a use would push the explanation out of the file.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bBuffer\b/.test(code), `${name} uses Buffer, which a browser does not have`);
  }
});
