import { describe, it, expect } from "vitest";
import type { MaturityRung, ParityConfig } from "@design-parity/core";

import {
  resolveAuto,
  resolveDirection,
  materializeDirection,
  directionPolicy,
} from "../src/index.js";

const rungs: MaturityRung[] = ["machine-link", "manifest", "bootstrap"];

describe("resolveAuto", () => {
  it("is design-led only on the machine-link rung", () => {
    expect(resolveAuto("machine-link")).toBe("design-led");
    expect(resolveAuto("manifest")).toBe("code-led");
    expect(resolveAuto("bootstrap")).toBe("code-led");
  });
});

describe("resolveDirection", () => {
  it("resolves auto from the rung", () => {
    expect(resolveDirection({ direction: "auto" }, "machine-link")).toBe(
      "design-led",
    );
    expect(resolveDirection({ direction: "auto" }, "manifest")).toBe("code-led");
    expect(resolveDirection({ direction: "auto" }, "bootstrap")).toBe(
      "code-led",
    );
  });

  it("uses an explicit direction verbatim, ignoring the rung", () => {
    for (const rung of rungs) {
      expect(resolveDirection({ direction: "design-led" }, rung)).toBe(
        "design-led",
      );
      expect(resolveDirection({ direction: "code-led" }, rung)).toBe("code-led");
    }
  });

  it("matches resolveAuto for every rung when direction is auto", () => {
    for (const rung of rungs) {
      expect(resolveDirection({ direction: "auto" }, rung)).toBe(
        resolveAuto(rung),
      );
    }
  });
});

describe("materializeDirection", () => {
  it("writes the resolved value back into the config", () => {
    expect(materializeDirection({ direction: "auto" }, "machine-link")).toEqual({
      direction: "design-led",
    });
    expect(materializeDirection({ direction: "auto" }, "bootstrap")).toEqual({
      direction: "code-led",
    });
  });

  it("leaves an explicit config's direction unchanged", () => {
    const config: ParityConfig = { direction: "design-led" };
    expect(materializeDirection(config, "bootstrap")).toEqual(config);
  });

  it("does not mutate the input", () => {
    const config: ParityConfig = { direction: "auto" };
    materializeDirection(config, "machine-link");
    expect(config.direction).toBe("auto");
  });
});

describe("directionPolicy", () => {
  it("design-led blocks the PR and forbids write-back", () => {
    expect(directionPolicy("design-led")).toEqual({
      direction: "design-led",
      blocksPr: true,
      allowsWriteBack: false,
    });
  });

  it("code-led is advisory and allows write-back", () => {
    expect(directionPolicy("code-led")).toEqual({
      direction: "code-led",
      blocksPr: false,
      allowsWriteBack: true,
    });
  });
});
