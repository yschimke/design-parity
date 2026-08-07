import { describe, it, expect } from "vitest";

import type { PageDocument, PageNode } from "../src/fetcher.js";
import { collectInstances, frameSize } from "../src/instances.js";

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

/** A page frame whose origin is deliberately non-zero, so frame-local maths is exercised. */
function page(children: PageNode[], components?: PageDocument["components"]): PageDocument {
  const doc: PageDocument = {
    document: {
      id: "1:1",
      name: "Settings",
      type: "FRAME",
      absoluteBoundingBox: box(100, 200, 400, 800),
      children,
    },
  };
  if (components) doc.components = components;
  return doc;
}

const instance = (over: Partial<PageNode> & { id: string }): PageNode => ({
  name: "Button",
  type: "INSTANCE",
  ...over,
});

describe("collectInstances", () => {
  it("reports instance bounds relative to the frame, not the canvas", () => {
    const hits = collectInstances(
      page([instance({ id: "2:1", absoluteBoundingBox: box(120, 260, 200, 48) })]),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.bounds).toEqual({ x: 20, y: 60, width: 200, height: 48 });
  });

  it("finds instances nested inside plain layout frames", () => {
    const hits = collectInstances(
      page([
        {
          id: "2:0",
          name: "Column",
          type: "FRAME",
          absoluteBoundingBox: box(100, 200, 400, 400),
          children: [instance({ id: "2:1", absoluteBoundingBox: box(100, 200, 100, 20) })],
        },
      ]),
    );
    expect(hits.map((h) => h.nodeId)).toEqual(["2:1"]);
    expect(hits[0]?.depth).toBe(0);
  });

  it("does not descend into an instance by default", () => {
    // The outermost instance is the placement that means something; the button
    // inside a card is noise on a page view.
    const hits = collectInstances(
      page([
        instance({
          id: "2:1",
          name: "OfferCard",
          absoluteBoundingBox: box(100, 200, 300, 120),
          children: [instance({ id: "2:2", absoluteBoundingBox: box(110, 260, 80, 32) })],
        }),
      ]),
    );
    expect(hits.map((h) => h.nodeId)).toEqual(["2:1"]);
  });

  it("records nested instances with their depth when asked", () => {
    const hits = collectInstances(
      page([
        instance({
          id: "2:1",
          name: "OfferCard",
          absoluteBoundingBox: box(100, 200, 300, 120),
          children: [instance({ id: "2:2", absoluteBoundingBox: box(110, 260, 80, 32) })],
        }),
      ]),
      { nested: true },
    );
    expect(hits.map((h) => [h.nodeId, h.depth])).toEqual([
      ["2:1", 0],
      ["2:2", 1],
    ]);
  });

  it("skips hidden layers and everything under them", () => {
    const hits = collectInstances(
      page([
        instance({ id: "2:1", absoluteBoundingBox: box(100, 200, 10, 10), visible: false }),
        {
          id: "2:2",
          name: "Hidden group",
          type: "FRAME",
          visible: false,
          absoluteBoundingBox: box(100, 200, 400, 400),
          children: [instance({ id: "2:3", absoluteBoundingBox: box(100, 200, 10, 10) })],
        },
      ]),
    );
    expect(hits).toEqual([]);
  });

  it("skips instances with no geometry, zero area, or a box off the frame", () => {
    const hits = collectInstances(
      page([
        instance({ id: "2:1" }),
        instance({ id: "2:2", absoluteBoundingBox: box(100, 200, 0, 40) }),
        instance({ id: "2:3", absoluteBoundingBox: box(9000, 9000, 40, 40) }),
      ]),
    );
    expect(hits).toEqual([]);
  });

  it("carries the component set id, which is what Code Connect usually links", () => {
    const hits = collectInstances(
      page(
        [
          instance({
            id: "2:1",
            name: "Button/Primary",
            componentId: "10:5",
            absoluteBoundingBox: box(100, 200, 100, 40),
          }),
        ],
        { "10:5": { name: "Primary", componentSetId: "10:1" } },
      ),
    );
    expect(hits[0]?.componentId).toBe("10:5");
    expect(hits[0]?.componentSetId).toBe("10:1");
  });

  it("omits an empty component set id rather than emitting a blank one", () => {
    const hits = collectInstances(
      page(
        [instance({ id: "2:1", componentId: "10:5", absoluteBoundingBox: box(100, 200, 10, 10) })],
        { "10:5": { name: "Button", componentSetId: "" } },
      ),
    );
    expect(hits[0]).not.toHaveProperty("componentSetId");
  });

  it("orders results top-left first so a re-import diffs cleanly", () => {
    const hits = collectInstances(
      page([
        instance({ id: "2:3", absoluteBoundingBox: box(300, 600, 40, 40) }),
        instance({ id: "2:1", absoluteBoundingBox: box(300, 300, 40, 40) }),
        instance({ id: "2:2", absoluteBoundingBox: box(100, 300, 40, 40) }),
      ]),
    );
    expect(hits.map((h) => h.nodeId)).toEqual(["2:2", "2:1", "2:3"]);
  });

  it("rejects a page node with no bounding box", () => {
    expect(() =>
      collectInstances({ document: { id: "1:1", name: "Page", type: "CANVAS" } }),
    ).toThrow(/no bounding box/);
  });
});

describe("frameSize", () => {
  it("returns the frame's own size", () => {
    expect(frameSize(page([]))).toEqual({ width: 400, height: 800 });
  });
});
