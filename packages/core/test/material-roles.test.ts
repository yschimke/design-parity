import { describe, it, expect } from "vitest";

import {
  MATERIAL_COLOR_ROLES,
  materialColorRole,
  materialTypeRole,
  materialShapeRole,
} from "../src/index.js";

describe("materialColorRole", () => {
  it("recognises a role spelled exactly", () => {
    expect(materialColorRole("onSurfaceVariant")).toBe("onSurfaceVariant");
  });

  it("recognises design vocabulary modulo separators, casing, and group prefix", () => {
    expect(materialColorRole("color/on-surface")).toBe("onSurface");
    expect(materialColorRole("on-surface-variant")).toBe("onSurfaceVariant");
    expect(materialColorRole("md.sys.color/Surface")).toBe("surface");
    expect(materialColorRole("primary_container")).toBe("primaryContainer");
  });

  it("does not confuse adjacent roles", () => {
    expect(materialColorRole("surface-variant")).toBe("surfaceVariant");
    expect(materialColorRole("on-surface-variant")).toBe("onSurfaceVariant");
  });

  it("returns undefined for a name that is not a colour role", () => {
    expect(materialColorRole("label")).toBeUndefined();
    expect(materialColorRole("color/brand-blue-600")).toBeUndefined();
    expect(materialColorRole("gutter")).toBeUndefined();
  });

  it("every canonical role round-trips through the heuristic", () => {
    for (const role of MATERIAL_COLOR_ROLES) {
      expect(materialColorRole(role)).toBe(role);
    }
  });
});

describe("materialTypeRole / materialShapeRole", () => {
  it("maps design vocabulary onto the type scale", () => {
    expect(materialTypeRole("type/body/large")).toBe("bodyLarge");
    expect(materialTypeRole("label-small")).toBe("labelSmall");
    expect(materialTypeRole("onSurface")).toBeUndefined();
  });

  it("maps design vocabulary onto the shape scale", () => {
    expect(materialShapeRole("shape/extra-large")).toBe("extraLarge");
    expect(materialShapeRole("medium")).toBe("medium");
    expect(materialShapeRole("card")).toBeUndefined();
  });
});
