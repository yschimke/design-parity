import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { afterAll } from "vitest";
import { unzipSync } from "fflate";

import { diff } from "../src/diff.js";
import { tagIndexFromSemantics } from "../src/acceptance/evaluate.js";
import { scoreComparison } from "../src/acceptance/vendor/known-difference-score.js";
import {
  enclosingBox,
  evaluateKnownDifferences,
  locallyResolvedIssues,
  resampleArea,
} from "../src/acceptance/vendor/known-differences.js";
import {
  contentBox,
  projectTagIndex,
  resolvePlane,
} from "../src/acceptance/vendor/known-difference-plane.js";
import {
  decodePng,
  padPngTo,
} from "../src/acceptance/vendor/png-lite.js";

const FIXTURE_ARCHIVE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "known-differences.zip",
);
const EXTRACTED = mkdtempSync(join(tmpdir(), "design-parity-conformance-"));
for (const [relative, bytes] of Object.entries(
  unzipSync(new Uint8Array(readFileSync(FIXTURE_ARCHIVE))),
)) {
  if (relative.endsWith("/")) continue;
  const target = join(EXTRACTED, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}
const ROOT = EXTRACTED;
afterAll(() => rmSync(EXTRACTED, { recursive: true, force: true }));

const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const raster = (path: string): any => decodePng(new Uint8Array(readFileSync(path)));

function fixtureReader(dir: string, synthesize: any[] = []) {
  const synthesized = new Map<string, Uint8Array>();
  for (const recipe of synthesize) {
    synthesized.set(
      recipe.path,
      padPngTo(new Uint8Array(readFileSync(join(dir, recipe.from))), recipe.padTo),
    );
  }
  return (path: string, options?: { prefix?: number }): any => {
    const relative = `artifacts/${path}`;
    const full = join(dir, relative);
    let bytes = synthesized.get(relative) ?? null;
    if (!bytes && existsSync(full)) {
      let parent = dir;
      for (const segment of relative.split("/")) {
        if (!readdirSync(parent).includes(segment)) return null;
        parent = join(parent, segment);
      }
      const resolved = realpathSync(full);
      if (!resolved.endsWith(sep + relative.split("/").join(sep))) return null;
      if (!statSync(resolved).isFile()) return null;
      bytes = new Uint8Array(readFileSync(resolved));
    }
    if (!bytes) return null;
    if (bytes.length > 8 * 1024 * 1024) return { error: "artifact-too-large" };
    if (options?.prefix === undefined) return bytes;
    return { bytes: bytes.subarray(0, options.prefix), byteLength: bytes.length };
  };
}

function comparison(dir: string, value: any): any {
  if (!value) return null;
  return {
    ...value,
    canonicalReference: value.canonicalReference
      ? raster(join(dir, value.canonicalReference))
      : null,
    canonicalCandidate: value.canonicalCandidate
      ? raster(join(dir, value.canonicalCandidate))
      : null,
  };
}

describe("compose-preview-known-differences/v1 conformance", () => {
  const cases = join(ROOT, "cases");
  for (const id of readdirSync(cases).sort()) {
    it(id, () => {
      const dir = join(cases, id);
      const meta = readJson(join(dir, "case.json"));
      const expected = readJson(join(dir, "expected.json"));
      const result = evaluateKnownDifferences({
        documentText: readFileSync(join(dir, "known-differences.json"), "utf8"),
        readArtifact: fixtureReader(dir, meta.synthesize),
        comparison: comparison(dir, meta.comparison),
        catalog: meta.catalog,
      });
      for (const pin of expected.pins) {
        if (pin === "statuses") expect(result.statuses).toEqual(expected.statuses);
        else if (pin === "statusesAbsent") {
          expect(result.statuses === undefined).toBe(expected.statusesAbsent);
        } else if (pin === "validationFailures") {
          expect(result.validationFailures).toEqual(expected.validationFailures);
        } else if (pin === "survivingMaskIds") {
          expect((result.survivingMasks ?? []).map((entry: any) => entry.id)).toEqual(
            expected.survivingMaskIds,
          );
        } else if (pin === "validationFailureCount") {
          expect(result.validationFailures).toHaveLength(expected.validationFailureCount);
        } else if (pin === "statusCounts") {
          const counts: Record<string, number> = {};
          for (const entry of Object.values(result.statuses ?? {}) as any[]) {
            counts[entry.status] = (counts[entry.status] ?? 0) + 1;
          }
          expect(counts).toEqual(expected.statusCounts);
        } else if (pin === "locallyResolvedIssues") {
          const document = readJson(join(dir, "known-differences.json"));
          expect(locallyResolvedIssues(document.acceptances, result.statuses)).toEqual(
            expected.locallyResolvedIssues,
          );
        } else {
          throw new Error(`unsupported case conformance pin: ${pin}`);
        }
      }
    });
  }

  const scoring = join(ROOT, "scoring");
  for (const id of readdirSync(scoring).sort()) {
    it(`scoring/${id}`, () => {
      const dir = join(scoring, id);
      const meta = readJson(join(dir, "case.json"));
      const expected = readJson(join(dir, "expected.json"));
      const result = scoreComparison({
        reference: raster(join(dir, "reference.png")),
        candidate: raster(join(dir, "candidate.png")),
        referenceBox: meta.referenceBox,
        candidateBox: meta.candidateBox,
        plane: meta.plane,
        masks: (meta.masks ?? []).map((name: string) => raster(join(dir, name))),
      });
      for (const pin of expected.pins) {
        if (pin === "scores") {
          for (const name of ["raw", "accepted", "unaccepted"] as const) {
            if (expected.scores[name] !== undefined) {
              expect(result[name]).toBeCloseTo(expected.scores[name], 10);
            }
          }
        } else if (pin === "scorePlane") {
          expect(result.stages.plane).toEqual(expected.scorePlane);
        } else if (pin === "presence") {
          for (const region of ["whole", "accepted", "unaccepted"]) {
            const present = result.stages.regions[region].reference.present.reduce(
              (sum: number, value: number) => sum + value,
              0,
            );
            expect(present).toBe(expected.presence[region]);
          }
        } else if (pin === "samples") {
          for (const sample of expected.samples) {
            const plane = result.stages.regions[sample.region][sample.side];
            const index = sample.y * result.stages.plane.width + sample.x;
            expect(Boolean(plane.present[index])).toBe(sample.present);
            expect([...plane.pixels.subarray(index * 4, index * 4 + 4)]).toEqual(
              sample.rgba,
            );
          }
        } else if (pin === "rawEqualsUnaccepted") {
          expect(Object.is(result.raw, result.unaccepted)).toBe(
            expected.rawEqualsUnaccepted,
          );
        } else {
          throw new Error(`unsupported scoring conformance pin: ${pin}`);
        }
      }
    });
  }

  const resample = join(ROOT, "resample");
  for (const id of readdirSync(resample).sort()) {
    it(`resample/${id}`, () => {
      const dir = join(resample, id);
      const meta = readJson(join(dir, "case.json"));
      const expected = readJson(join(dir, "expected.json"));
      const result = resampleArea(raster(join(dir, "source.png")), meta.target.width, meta.target.height);
      const pixels = expected.pixels.map((_: unknown, index: number) =>
        [...result.pixels.subarray(index * 4, index * 4 + 4)],
      );
      expect({ width: result.width, height: result.height, pixels }).toEqual(expected);
    });
  }

  const rounding = join(ROOT, "rounding");
  for (const id of readdirSync(rounding).sort()) {
    it(`rounding/${id}`, () => {
      const dir = join(rounding, id);
      expect(enclosingBox(readJson(join(dir, "case.json")).box)).toEqual(
        readJson(join(dir, "expected.json")),
      );
    });
  }

  const tagProjection = join(ROOT, "tag-projection");
  for (const id of readdirSync(tagProjection).sort()) {
    it(`tag-projection/${id}`, () => {
      const dir = join(tagProjection, id);
      const meta = readJson(join(dir, "case.json"));
      expect(projectTagIndex(meta.tagIndex, meta.candidateBox, meta.plane)).toEqual(
        readJson(join(dir, "expected.json")),
      );
    });
  }

  const planes = join(ROOT, "plane");
  for (const id of readdirSync(planes).sort()) {
    it(`plane/${id}`, () => {
      const dir = join(planes, id);
      const expected = readJson(join(dir, "expected.json"));
      const result = resolvePlane(
        raster(join(dir, "reference.png")),
        raster(join(dir, "candidate.png")),
      );
      const referenceContentBox = contentBox(raster(join(dir, "reference.png")));
      const candidateContentBox = contentBox(raster(join(dir, "candidate.png")));
      if (expected.pins.includes("referenceContentBox")) {
        expect(referenceContentBox).toEqual(expected.referenceContentBox);
      }
      if (expected.pins.includes("candidateContentBox")) {
        expect(candidateContentBox).toEqual(expected.candidateContentBox);
      }
      if (expected.pins.includes("plane")) expect(result.plane).toEqual(expected.plane);
      if (expected.pins.includes("boxes")) expect(result.boxes).toEqual(expected.boxes);
    });
  }

  it("builds the offline tag index without collapsing duplicate tags", () => {
    expect(tagIndexFromSemantics({
      children: [
        { testTag: "glyph", bounds: { x: 1, y: 2, width: 3, height: 4 } },
        { testTag: "glyph", bounds: { x: 8, y: 9, width: 3, height: 4 } },
      ],
    })).toEqual({ glyph: { count: 2 } });
  });

  it("indexes JavaScript prototype names as ordinary tags", () => {
    const index = tagIndexFromSemantics({
      children: [
        { testTag: "__proto__", bounds: { x: 1, y: 2, width: 3, height: 4 } },
        { testTag: "constructor", bounds: { x: 5, y: 6, width: 7, height: 8 } },
      ],
    });
    expect(Object.getPrototypeOf(index)).toBeNull();
    expect(index["__proto__"]?.count).toBe(1);
    expect(index["constructor"]?.count).toBe(1);
    const projected = projectTagIndex(index, { x: 0, y: 0, width: 20, height: 20 }, {
      plane: "full-canvas",
      box: { x: 0, y: 0, width: 20, height: 20 },
    });
    expect(Object.getPrototypeOf(projected)).toBeNull();
    expect(projected["__proto__"].count).toBe(1);
    expect(projected["constructor"].count).toBe(1);
  });

  it("keeps the raw visual finding while reporting scoped scores and statuses", async () => {
    const fixture = join(ROOT, "cases", "pilot-40-iconbutton-tonal-glyph");
    const repo = mkdtempSync(join(tmpdir(), "design-parity-acceptance-"));
    try {
      const committed = join(repo, ".design-parity");
      cpSync(join(fixture, "artifacts"), join(committed, "known-differences"), {
        recursive: true,
      });
      const document = readJson(join(fixture, "known-differences.json"));
      document.acceptances[0].referenceSha256 = createHash("sha256")
        .update(readFileSync(join(fixture, "canonical-reference.png")))
        .digest("hex");
      document.acceptances[0].plane.box.x = 0;
      document.acceptances[0].plane.box.y = 0;
      writeFileSync(join(committed, "known-differences.json"), JSON.stringify(document));

      const ref = raster(join(fixture, "canonical-reference.png"));
      const cand = raster(join(fixture, "canonical-candidate.png"));
      const referencePath = join(fixture, "canonical-reference.png");
      const candidatePath = join(fixture, "canonical-candidate.png");
      const result = await diff(
        {
          componentId: "IconButton/Tonal",
          source: "bundle",
          linkMethod: "manifest",
          referenceImages: [{ state: "default", uri: referencePath, width: ref.width, height: ref.height }],
        },
        {
          componentId: "IconButton/Tonal",
          images: [{ state: "default", uri: candidatePath, width: cand.width, height: cand.height }],
          semantics: {
            root: {
              children: [{ testTag: "iconbutton-tonal-glyph", bounds: { x: 8, y: 8, width: 8, height: 8 } }],
            },
          },
        },
        {
          repoRoot: repo,
          checks: { run: async () => [] },
          knownDifferences: {
            scopes: {
              default: {
                system: "m3",
                component: "IconButton/Tonal",
                previewId: "iconbutton-tonal__ideal__default__light",
                referenceId: "iconbutton-tonal-ideal-light",
                variant: "ideal/default/light",
                overrides: {},
                referenceSha256: document.acceptances[0].referenceSha256,
              },
            },
          },
        },
      );

      expect(result.verdict.visualScores.default).toBeGreaterThan(0);
      expect(result.acceptances?.default.statuses["m3-iconbutton-tonal-glyph"]).toEqual({
        status: "valid",
      });
      expect(result.acceptances?.default.suppressing).toEqual(["m3-iconbutton-tonal-glyph"]);
      expect(result.summary).toContain("raw ");
      expect(result.summary).toContain("accepted ");
      expect(result.summary).toContain("unaccepted ");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
