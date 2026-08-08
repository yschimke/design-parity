/**
 * The schema is the contract, so it has to be checked against what the producer
 * actually emits — otherwise the two drift and the first consumer to trust the
 * schema finds out the hard way.
 *
 * Two directions are tested: everything `importPages` produces validates, and
 * the constraints the schema claims to enforce actually reject bad input. A
 * schema that accepts anything would pass the first test alone.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { describe, it, expect } from "vitest";

import type { PageBackdropConfig } from "../src/config.js";
import type { PageDocument, PageNode } from "../src/fetcher.js";
import { importPages } from "../src/import.js";

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL("../schema/page-backdrop.schema.json", import.meta.url)), "utf8"),
);

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function errs(): string {
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
}

const FILE = "AbCdEf123456";

const config: PageBackdropConfig = {
  source: "figma",
  fileKey: FILE,
  pages: [{ nodeId: "1:2", id: "home" }],
  scale: 2,
  nested: false,
  outDir: "/unused",
  overlay: { enabled: false, opacity: 0.5, blend: "normal" },
  configPath: "/repo/design-pages.json",
};

const instance = (over: Partial<PageNode> & { id: string }): PageNode => ({
  name: "Button/Primary",
  type: "INSTANCE",
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
  ...over,
});

const page = (children: PageNode[]): PageDocument => ({
  document: {
    id: "1:1",
    name: "Home",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 720 },
    children,
  },
  components: { "10:5": { name: "Primary", componentSetId: "10:1" } },
});

const fetcher = (doc: PageDocument) => ({
  async fetchPage() {
    return doc;
  },
  async renderPage() {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  },
});

describe("the manifest validates against its own schema", () => {
  it("accepts a manifest covering all four link methods", async () => {
    const doc = page([
      instance({ id: "2:1", componentId: "10:5" }), // → code-connect via the set
      instance({ id: "2:2", name: "Mapped", absoluteBoundingBox: { x: 0, y: 60, width: 50, height: 20 } }),
      instance({ id: "2:3", name: "OfferCard", absoluteBoundingBox: { x: 0, y: 120, width: 50, height: 20 } }),
      instance({ id: "2:4", name: "Mystery", absoluteBoundingBox: { x: 0, y: 180, width: 50, height: 20 } }),
    ]);
    const { manifest } = await importPages({
      config,
      fetcher: fetcher(doc),
      inputs: {
        codeConnect: { "ui/Button.kt#PrimaryButton": `figma:${FILE}/10:1` },
        designMap: {
          components: [
            {
              code: "ui/Button.kt#PrimaryButton",
              source: "figma",
              ref: `figma:${FILE}/10:1`,
              previewId: "app.ButtonsKt.PrimaryButton_Light",
            },
            { code: "ui/Map.kt#Mapped", source: "figma", ref: `figma:${FILE}/2:2` },
            { code: "ui/Card.kt#OfferCard", source: "figma", ref: "figma:Other/9:9" },
          ],
        },
        codeHandles: ["ui/Card.kt#OfferCard"],
      },
    });

    expect(validate(manifest), errs()).toBe(true);

    const links = manifest.pages[0]?.placements.map((p) => p.link);
    expect(new Set(links)).toEqual(
      new Set(["code-connect", "manifest", "convention", "unlinked"]),
    );
  });

  it("gives every placement a ref, and a previewId + confidence when known", async () => {
    const { manifest } = await importPages({
      config,
      fetcher: fetcher(page([instance({ id: "2:1", componentId: "10:5" })])),
      inputs: {
        designMap: {
          components: [
            {
              code: "ui/Button.kt#PrimaryButton",
              source: "figma",
              ref: `figma:${FILE}/10:1`,
              previewId: "app.ButtonsKt.PrimaryButton_Light",
            },
          ],
        },
      },
    });
    const p = manifest.pages[0]?.placements[0];
    expect(p).toMatchObject({
      ref: `figma:${FILE}/2:1`,
      code: "ui/Button.kt#PrimaryButton",
      previewId: "app.ButtonsKt.PrimaryButton_Light",
      link: "manifest",
      confidence: "high",
    });
    expect(validate(manifest), errs()).toBe(true);
  });

  it("marks a name match low-confidence and an unlinked placement as neither", async () => {
    const { manifest } = await importPages({
      config,
      fetcher: fetcher(
        page([
          instance({ id: "2:1", name: "OfferCard" }),
          instance({ id: "2:2", name: "Mystery", absoluteBoundingBox: { x: 0, y: 60, width: 40, height: 20 } }),
        ]),
      ),
      inputs: { codeHandles: ["ui/Card.kt#OfferCard"] },
    });
    const [guess, none] = manifest.pages[0]?.placements ?? [];
    expect(guess).toMatchObject({ link: "convention", confidence: "low" });
    expect(none?.link).toBe("unlinked");
    expect(none).not.toHaveProperty("confidence");
    expect(none).not.toHaveProperty("code");
    // Still addressable in the design tool, which is the point of a bare ref.
    expect(none?.ref).toBe(`figma:${FILE}/2:2`);
    expect(validate(manifest), errs()).toBe(true);
  });

  it("validates the committed fixture", () => {
    const fixture = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../fixtures/page-backdrop/pages.json", import.meta.url)), "utf8"),
    );
    expect(validate(fixture), errs()).toBe(true);
  });
});

describe("the schema actually constrains", () => {
  const base = () =>
    JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../fixtures/page-backdrop/pages.json", import.meta.url)), "utf8"),
    );

  it("rejects a missing ref on a placement", () => {
    const m = base();
    delete m.pages[0].placements[0].ref;
    expect(validate(m)).toBe(false);
  });

  it("rejects a zero-area bounds", () => {
    const m = base();
    m.pages[0].placements[0].bounds.width = 0;
    expect(validate(m)).toBe(false);
  });

  it("rejects an unknown link method and an unknown confidence", () => {
    const bad = base();
    bad.pages[0].placements[0].link = "vibes";
    expect(validate(bad)).toBe(false);

    const worse = base();
    worse.pages[0].placements[0].confidence = "medium";
    expect(validate(worse)).toBe(false);
  });

  it("rejects a non-figma source and a missing fileKey", () => {
    const a = base();
    a.source = "stitch";
    expect(validate(a)).toBe(false);

    const b = base();
    delete b.fileKey;
    expect(validate(b)).toBe(false);
  });

  it("tolerates an unknown additive field, so a newer producer does not break an older consumer", () => {
    const m = base();
    m.pages[0].placements[0].somethingAddedLater = { nested: true };
    m.aBrandNewTopLevelField = 42;
    expect(validate(m), errs()).toBe(true);
  });
});
