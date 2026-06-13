import { describe, it, expect } from "vitest";

import type {
  AdapterContext,
  CandidateRender,
  CanvasTarget,
  CanvasWriteResult,
  CanvasWriter,
  DesignReference,
  ResolvedDirection,
} from "@design-parity/core";

import { decidePushBack, pushBack } from "../src/index.js";
import type { ComponentResult, ParityReport } from "../src/index.js";

const ctx: AdapterContext = { repoRoot: "/repo", env: {} };

/** A recording writer so tests can assert exactly what got pushed. */
class RecordingWriter implements CanvasWriter {
  readonly source = "figma" as const;
  readonly calls: CanvasTarget[] = [];
  constructor(private readonly behavior: "ok" | "throw" = "ok") {}
  async write(target: CanvasTarget): Promise<CanvasWriteResult> {
    this.calls.push(target);
    if (this.behavior === "throw") throw new Error("bridge unreachable");
    return { url: `https://figma.com/${target.ref}`, detail: "updated" };
  }
}

const candidate = (id: string): CandidateRender => ({
  componentId: id,
  images: [
    { state: "default", theme: "light", uri: "out/a.png", width: 10, height: 10 },
  ],
  semantics: { root: { role: "button" } },
});

const reference = (id: string): DesignReference => ({
  componentId: id,
  source: "figma",
  referenceImages: [],
  linkMethod: "code-connect",
  ref: "figma:AbC123/1:42",
});

function figmaResult(code: string): ComponentResult {
  return {
    code,
    source: "figma",
    status: "ok",
    reference: reference(code),
    candidate: candidate(code),
  };
}

function report(
  direction: ResolvedDirection,
  results: ComponentResult[],
): ParityReport {
  return { status: "warn", blocked: false, direction, results, warnings: [] };
}

describe("decidePushBack (the gate)", () => {
  it("is ineligible when the opt-in flag is off", () => {
    const gate = decidePushBack({ enabled: false, direction: "code-led" });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/opt-in/i);
  });

  it("is ineligible under design-led even when opted in", () => {
    const gate = decidePushBack({ enabled: true, direction: "design-led" });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/design-led|not 'code-led'/i);
  });

  it("is eligible only when opted in AND code-led", () => {
    expect(decidePushBack({ enabled: true, direction: "code-led" }).eligible).toBe(true);
  });
});

describe("pushBack", () => {
  it("no-ops (no writer calls) when the flag is off", async () => {
    const writer = new RecordingWriter();
    const out = await pushBack({
      report: report("code-led", [figmaResult("ui/A.kt#A")]),
      enabled: false,
      writer,
      ctx,
    });
    expect(out.attempted).toBe(false);
    expect(out.reason).toMatch(/opt-in/i);
    expect(writer.calls).toHaveLength(0);
  });

  it("no-ops under design-led, even opted in with a writer", async () => {
    const writer = new RecordingWriter();
    const out = await pushBack({
      report: report("design-led", [figmaResult("ui/A.kt#A")]),
      enabled: true,
      writer,
      ctx,
    });
    expect(out.attempted).toBe(false);
    expect(out.reason).toMatch(/design-led|not 'code-led'/i);
    expect(writer.calls).toHaveLength(0);
  });

  it("no-ops with a clear reason when enabled+code-led but no writer is configured", async () => {
    const out = await pushBack({
      report: report("code-led", [figmaResult("ui/A.kt#A")]),
      enabled: true,
      ctx,
    });
    expect(out.attempted).toBe(false);
    expect(out.reason).toMatch(/no canvas writer/i);
  });

  it("pushes the candidate render to the writer when enabled+code-led+figma", async () => {
    const writer = new RecordingWriter();
    const out = await pushBack({
      report: report("code-led", [figmaResult("ui/A.kt#A")]),
      enabled: true,
      writer,
      ctx,
    });
    expect(out.attempted).toBe(true);
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]!.componentId).toBe("ui/A.kt#A");
    expect(writer.calls[0]!.ref).toBe("figma:AbC123/1:42");
    expect(out.pushed).toHaveLength(1);
    expect(out.pushed[0]!.pushed[0]!.key).toBe("default/light/-");
    expect(out.pushed[0]!.pushed[0]!.result.url).toContain("figma.com");
  });

  it("skips non-figma sources with a clear reason", async () => {
    const writer = new RecordingWriter();
    const stitch: ComponentResult = {
      code: "ui/B.kt#B",
      source: "stitch",
      status: "ok",
      reference: { ...reference("ui/B.kt#B"), source: "stitch" },
      candidate: candidate("ui/B.kt#B"),
    };
    const out = await pushBack({
      report: report("code-led", [stitch]),
      enabled: true,
      writer,
      ctx,
    });
    expect(out.attempted).toBe(true);
    expect(writer.calls).toHaveLength(0);
    expect(out.pushed).toHaveLength(0);
    expect(out.skipped[0]!.reason).toMatch(/not 'figma'/);
  });

  it("skips components with no candidate render", async () => {
    const writer = new RecordingWriter();
    const skipped: ComponentResult = {
      code: "ui/C.kt#C",
      source: "figma",
      status: "skipped",
      note: "no candidate render available",
    };
    const out = await pushBack({
      report: report("code-led", [skipped]),
      enabled: true,
      writer,
      ctx,
    });
    expect(writer.calls).toHaveLength(0);
    expect(out.skipped[0]!.reason).toMatch(/no candidate|skipped/i);
  });

  it("fails soft: a writer throw is captured, not thrown, and others still push", async () => {
    const writer = new RecordingWriter("throw");
    const out = await pushBack({
      report: report("code-led", [figmaResult("ui/A.kt#A")]),
      enabled: true,
      writer,
      ctx,
    });
    expect(out.attempted).toBe(true);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]!.message).toMatch(/unreachable/);
    expect(out.pushed).toHaveLength(0);
  });

  it("emits a log line in the no-op branch", async () => {
    const logs: string[] = [];
    await pushBack({
      report: report("design-led", [figmaResult("ui/A.kt#A")]),
      enabled: true,
      ctx,
      log: (m) => logs.push(m),
    });
    expect(logs.some((l) => /design-led|not 'code-led'/i.test(l))).toBe(true);
  });
});
