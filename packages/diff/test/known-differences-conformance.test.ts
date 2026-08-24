import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { diff } from "../src/diff.js";
import { tagIndexFromSemantics } from "../src/acceptance/evaluate.js";
import { scoreComparison } from "../src/acceptance/vendor/known-difference-score.js";
import {
  enclosingBox,
  evaluateKnownDifferences,
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

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "known-differences",
);

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
      if (expected.scores.raw !== undefined) {
        expect(result.raw).toBeCloseTo(expected.scores.raw, 10);
      }
      if (expected.scores.accepted !== undefined) {
        expect(result.accepted).toBeCloseTo(expected.scores.accepted, 10);
      }
      if (expected.scores.unaccepted !== undefined) {
        expect(result.unaccepted).toBeCloseTo(expected.scores.unaccepted, 10);
      }
      expect(result.stages.plane).toEqual(expected.scorePlane);
      for (const region of ["whole", "accepted", "unaccepted"]) {
        const present = result.stages.regions[region].reference.present.reduce(
          (sum: number, value: number) => sum + value,
          0,
        );
        expect(present).toBe(expected.presence[region]);
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

  it("keeps the raw visual finding while reporting scoped scores and statuses", async () => {
    const fixture = join(ROOT, "cases", "pilot-40-iconbutton-tonal-glyph");
    const repo = mkdtempSync(join(tmpdir(), "design-parity-acceptance-"));
    try {
      const committed = join(repo, ".design-parity");
      cpSync(join(fixture, "artifacts"), join(committed, "known-differences"), {
        recursive: true,
      });
      const document = readJson(join(fixture, "known-differences.json"));
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
