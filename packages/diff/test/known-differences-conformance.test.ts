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
import { PNG } from "pngjs";

import { diff, renderAcceptanceSummary } from "../src/diff.js";
import {
  evaluateKnownDifferenceComparison,
  refuseElementAcceptancesWithoutSemantics,
  tagIndexFromSemantics,
} from "../src/acceptance/evaluate.js";
import { scoreComparison } from "../src/acceptance/vendor/known-difference-score.js";
import { SCORE_TUNING } from "../src/acceptance/vendor/known-difference-tuning.js";
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
// Read from the provenance record rather than restated here. Two copies of a pin is the same
// defect this suite's provenance test exists to catch, one level up: a corpus regenerated at a new
// commit while a hand-written constant still names the old digest looks exactly like a corpus that
// never moved. `PROVENANCE.json` is written by the sync that produced both, so it cannot disagree
// with what it snapshotted — and the assertions below then check the committed archive *is* that.
const FIXTURE_PROVENANCE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "acceptance", "vendor", "PROVENANCE.json"),
    "utf8",
  ),
).fixtures;
const FIXTURE_ARCHIVE_SHA256: string = FIXTURE_PROVENANCE.archiveSha256;
const FIXTURE_FILE_COUNT: number = FIXTURE_PROVENANCE.fileCount;
const FIXTURE_CASE_COUNTS = {
  cases: 190,
  plane: 6,
  resample: 9,
  rounding: 5,
  scoring: 8,
  tagProjection: 7,
};
const fixtureArchiveBytes = new Uint8Array(readFileSync(FIXTURE_ARCHIVE));
const fixtureEntries = unzipSync(fixtureArchiveBytes);
const EXTRACTED = mkdtempSync(join(tmpdir(), "design-parity-conformance-"));
for (const [relative, bytes] of Object.entries(fixtureEntries)) {
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

function comparison(_dir: string, value: any): any {
  if (!value) return null;
  // **Resolved against the fixture ROOT, not the case directory.** `case.json` names the canonical
  // rasters by root-relative path so identical rasters are stored once for the whole tree, and every
  // runtime resolves them the same way. Joining against the case directory looks for
  // `cases/<id>/rasters/<hash>.png`, which does not exist.
  return {
    ...value,
    canonicalReference: value.canonicalReference
      ? raster(join(ROOT, value.canonicalReference))
      : null,
    canonicalCandidate: value.canonicalCandidate
      ? raster(join(ROOT, value.canonicalCandidate))
      : null,
  };
}

describe("compose-preview-known-differences/v1 conformance", () => {
  it("pins the complete canonical fixture corpus", () => {
    expect(createHash("sha256").update(fixtureArchiveBytes).digest("hex")).toBe(
      FIXTURE_ARCHIVE_SHA256,
    );
    expect(Object.keys(fixtureEntries).filter((path) => !path.endsWith("/"))).toHaveLength(
      FIXTURE_FILE_COUNT,
    );

    const index = readJson(join(ROOT, "index.json"));
    expect(index.schema).toBe("compose-preview-known-differences/v1");
    expect(Object.fromEntries(
      Object.keys(FIXTURE_CASE_COUNTS).map((key) => [key, index[key].length]),
    )).toEqual(FIXTURE_CASE_COUNTS);

    const directories: Record<string, string> = {
      cases: "cases",
      plane: "plane",
      resample: "resample",
      rounding: "rounding",
      scoring: "scoring",
      tagProjection: "tag-projection",
    };
    for (const [key, directory] of Object.entries(directories)) {
      const indexed = index[key].map((entry: { id: string }) => entry.id).sort();
      const extracted = readdirSync(join(ROOT, directory), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      expect(extracted).toEqual(indexed);
    }
  });

  it("adds a missing-semantics refusal without erasing an existing reason", () => {
    const fixture = join(ROOT, "cases", "acceptance-is-noop");
    const meta = readJson(join(fixture, "case.json"));
    const comparison = meta.comparison;
    const scope = {
      system: comparison.system,
      component: comparison.component,
      previewId: comparison.previewId,
      referenceId: comparison.referenceId,
      variant: comparison.variant,
      overrides: comparison.overrides,
      referenceSha256: comparison.referenceSha256,
    };
    const statuses: any = {
      "m3-iconbutton-tonal-glyph": {
        status: "refused",
        reasons: ["acceptance-is-noop"],
      },
    };
    const failures = [
      { id: "m3-iconbutton-tonal-glyph", reason: "acceptance-is-noop" },
    ];

    refuseElementAcceptancesWithoutSemantics(
      readFileSync(join(fixture, "known-differences.json"), "utf8"),
      scope,
      statuses,
      failures,
    );

    expect(statuses["m3-iconbutton-tonal-glyph"]).toEqual({
      status: "refused",
      reasons: ["acceptance-is-noop", "semantics-unavailable"],
    });
    expect(failures).toEqual([
      { id: "m3-iconbutton-tonal-glyph", reason: "acceptance-is-noop" },
      { id: "m3-iconbutton-tonal-glyph", reason: "semantics-unavailable" },
    ]);
  });

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
      // The canonical rasters are named by `case.json`, by a path relative to the fixture ROOT —
      // identical rasters are stored once for the whole tree rather than per case. Reading the
      // names from the case rather than assuming `canonical-reference.png` beside it is also what
      // keeps this test from re-encoding a layout the tree is free to change.
      const meta = readJson(join(fixture, "case.json"));
      const referencePath = join(ROOT, meta.comparison.canonicalReference);
      const candidatePath = join(ROOT, meta.comparison.canonicalCandidate);
      const document = readJson(join(fixture, "known-differences.json"));
      document.acceptances[0].referenceSha256 = createHash("sha256")
        .update(readFileSync(referencePath))
        .digest("hex");
      document.acceptances[0].plane.box.x = 0;
      document.acceptances[0].plane.box.y = 0;
      writeFileSync(join(committed, "known-differences.json"), JSON.stringify(document));

      const ref = raster(referencePath);
      const cand = raster(candidatePath);
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
      // The kernel version is stamped by the engine that minted the numbers, and reaches the
      // summary alongside them. A stored report from another release is then self-describing: a
      // reader can tell a real regression from a rebaseline, since a kernel change moves every
      // score and no verdict.
      expect(result.acceptances?.default.scores.version).toBe(SCORE_TUNING.SCORE_VERSION);
      expect(result.summary).toContain(`(score v${SCORE_TUNING.SCORE_VERSION})`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("normalises partial alpha on the production decode path, not only in this suite", () => {
    // **The gap this suite cannot see on its own.** Every case above reaches the engine through
    // `decodePng`, which puts partial-alpha pixels on the contract's straight-alpha grid. The real
    // path does not: `visual.ts` reads with `pngjs` and hands those bytes straight to
    // `evaluateKnownDifferenceComparison`, so the partial-alpha conformance cases passed here while
    // production compared pixels off the grid.
    //
    // Colour 200 at alpha 128 premultiplies to 100 and unpremultiplies to 199, so 200 and 199 are
    // two spellings of one premultiplied bucket. The **score** cannot tell them apart — its kernel
    // premultiplies, and both land on 100 — so the divergence surfaces in the candidate gate, which
    // compares straight channels against the accepted crop. At `candidateTolerance: 0` one spelling
    // is `valid` and the other is `invalidated: candidate-changed`, on a candidate whose bytes never
    // moved. That is why the tolerance is pinned to 0 here rather than inherited from the fixture,
    // whose 2 absorbs the difference and hides the whole thing.
    const repo = mkdtempSync(join(tmpdir(), "design-parity-alpha-"));
    try {
      const committed = join(repo, ".design-parity");
      const artifacts = join(committed, "known-differences", "alpha-spelling");
      mkdirSync(artifacts, { recursive: true });

      const side = 24;
      const rgba = (colour: number, alpha: number) => {
        const png = new PNG({ width: side, height: side });
        for (let i = 0; i < png.data.length; i += 4) {
          png.data[i] = png.data[i + 1] = png.data[i + 2] = colour;
          png.data[i + 3] = alpha;
        }
        return PNG.sync.write(png);
      };
      // 199 at alpha 128 is a fixed point of the normalisation, so the committed crop is on the grid
      // exactly as a real published artifact decoded by `decodePng` would be.
      const accepted = rgba(199, 128);
      // 8-bit greyscale with no alpha, which is what the contract's mask encoding rule requires —
      // an RGBA mask is `mask-encoding-invalid` however white its pixels are.
      const mask = (() => {
        const png = new PNG({ width: side, height: side });
        for (let i = 0; i < png.data.length; i += 4) {
          png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
          png.data[i + 3] = 255;
        }
        return PNG.sync.write(png, { colorType: 0 });
      })();
      writeFileSync(join(artifacts, "accepted-candidate.png"), accepted);
      writeFileSync(join(artifacts, "mask.png"), mask);

      const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      // The record is the pilot case's, with only what this test is about overridden: its own
      // artifacts, a plane the size of the rasters below, and `candidateTolerance: 0`. Hand-rolling
      // one instead produced `schema-invalid` — the shape has required fields this test has no
      // opinion about, and inventing them is how a fixture ends up testing its own typos.
      const spelledRaster = (colour: number) => {
        const pixels = new Uint8Array(side * side * 4);
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = pixels[i + 1] = pixels[i + 2] = colour;
          pixels[i + 3] = 128;
        }
        return { width: side, height: side, pixels };
      };
      // An opaque reference the candidate genuinely differs from. Handing the same pixels to both
      // sides is `acceptance-is-noop` — with nothing to accept, the record is refused before the
      // candidate gate this test exists for ever runs.
      const referenceRaster = {
        width: side,
        height: side,
        pixels: (() => {
          const pixels = new Uint8Array(side * side * 4);
          for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = 255;
          return pixels;
        })(),
      };
      // The plane the evaluation will derive from this pair, not one guessed at: a recorded plane
      // that disagrees is `plane-changed`, refused for the same reason.
      const resolvedPlane = resolvePlane(referenceRaster, spelledRaster(199)).plane;

      const pilot = readJson(
        join(ROOT, "cases", "pilot-40-iconbutton-tonal-glyph", "known-differences.json"),
      );
      const record = {
        ...pilot.acceptances[0],
        id: "alpha-spelling",
        mask: "mask.png",
        acceptedCandidate: "accepted-candidate.png",
        maskSha256: sha(mask),
        acceptedCandidateSha256: sha(accepted),
        plane: resolvedPlane,
        candidateTolerance: 0,
      };
      // The pilot record pins a semantics element, and this test hands the evaluation no tag index —
      // which is `element-moved`, another refusal ahead of the gate under test. The element is
      // optional, and this case is about a candidate's spelling rather than where a node sits.
      delete (record as { element?: unknown }).element;
      writeFileSync(
        join(committed, "known-differences.json"),
        JSON.stringify({ schema: "compose-preview-known-differences/v1", acceptances: [record] }),
      );

      const run = (colour: number) =>
        evaluateKnownDifferenceComparison({
          repoRoot: repo,
          scope: {
            system: record.system,
            component: record.component,
            previewId: record.previewId,
            referenceId: record.referenceId,
            variant: record.variant,
            overrides: {},
            // The pilot record's own hash, so the reference gate compares equal and this test is
            // about the candidate's spelling and nothing else.
            referenceSha256: record.referenceSha256,
          },
          // The reference is the accepted spelling; only the candidate's spelling varies.
          reference: referenceRaster,
          candidate: spelledRaster(colour),
          tagIndex: {},
        });

      const onGrid = run(199);
      const offGrid = run(200);
      expect(onGrid?.statuses["alpha-spelling"]).toEqual({ status: "valid" });
      // The whole report, so a divergence anywhere — a status, a cause, a score — fails this.
      expect(offGrid).toEqual(onGrid);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("says nothing about the kernel when a stored report predates the field", () => {
    // The mirror image of the test above. `version` is required on a freshly produced report, so
    // the engine always stamps it — but reports persisted before the field existed cannot grow one,
    // and a required TypeScript property does not reach an object already written to disk. The
    // renderer has to say "unknown" by omission: `score vundefined` asserts something false about
    // which arithmetic produced the numbers, which is worse than saying nothing.
    const legacy = {
      documentRejected: false,
      statuses: {},
      validationFailures: [],
      scores: { raw: 90, accepted: 100, unaccepted: 90 },
      suppressing: [],
    };
    const summary = renderAcceptanceSummary({ "default/light/compact": legacy });
    expect(summary).toContain("raw 90.00%");
    expect(summary).not.toContain("score v");
    expect(summary).not.toContain("undefined");

    // And a report that does carry one still says so.
    const stamped = { ...legacy, scores: { ...legacy.scores, version: SCORE_TUNING.SCORE_VERSION } };
    expect(renderAcceptanceSummary({ "default/light/compact": stamped })).toContain(
      `(score v${SCORE_TUNING.SCORE_VERSION})`,
    );
  });

  it("keeps the score kernel version in one place — the vendored tuning", () => {
    // `version` on a report is only worth trusting if exactly one file decides it. A second copy of
    // the constant drifts silently the next time the kernel changes upstream, and then a number
    // carries a version it does not implement — worse than no version at all, because a wrong one
    // gets believed. So the value may appear only in the vendored tuning; everywhere else reads it.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const owner = join("acceptance", "vendor", "known-difference-tuning.ts");
    const literal = /SCORE_VERSION\s*[:=]\s*\d/;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
            continue;
          }
          walk(path);
        } else if (/\.(ts|mts|mjs|js)$/.test(entry.name) && !path.endsWith(owner)) {
          if (literal.test(readFileSync(path, "utf8"))) offenders.push(path.slice(repoRoot.length + 1));
        }
      }
    };
    walk(join(repoRoot, "packages"));

    expect(offenders).toEqual([]);
    // And the one place that does define it agrees with what the engine hands out.
    expect(literal.test(readFileSync(join(repoRoot, "packages", "diff", "src", owner), "utf8"))).toBe(true);
    expect(typeof SCORE_TUNING.SCORE_VERSION).toBe("number");
  });
});
