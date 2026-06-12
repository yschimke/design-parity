import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  detectMaturity,
  planBootstrap,
  classifyBuildFile,
  isCmpBuildFile,
  summarizeCmp,
  cmpSuggestion,
} from "../src/index.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name: string) => resolve(fixtures, name);

describe("isCmpBuildFile", () => {
  it("recognizes Gradle build, settings, and version-catalog files", () => {
    for (const name of [
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts",
      "libs.versions.toml",
    ]) {
      expect(isCmpBuildFile(name)).toBe(true);
    }
  });

  it("ignores unrelated files", () => {
    for (const name of ["package.json", "Button.kt", "build.gradle.bak", "versions.toml"]) {
      expect(isCmpBuildFile(name)).toBe(false);
    }
  });
});

describe("classifyBuildFile", () => {
  it("detects the compose plugin and a jvm target in Kotlin DSL", () => {
    const signals = classifyBuildFile(
      "build.gradle.kts",
      `plugins {\n  kotlin("multiplatform")\n  id("org.jetbrains.compose")\n}\nkotlin {\n  jvm()\n}\n`,
    );
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("compose-plugin");
    expect(kinds).toContain("kotlin-multiplatform");
    expect(kinds).toContain("jvm-target");
  });

  it("detects compose + KMP via version-catalog aliases", () => {
    const signals = classifyBuildFile(
      "libs.versions.toml",
      `[plugins]\ncompose-multiplatform = { id = "org.jetbrains.compose" }\nkotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform" }\n`,
    );
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("compose-plugin");
    expect(kinds).toContain("kotlin-multiplatform");
  });

  it("detects a wasmJs / js headless-render target", () => {
    const signals = classifyBuildFile(
      "build.gradle.kts",
      `kotlin {\n  wasmJs { browser() }\n}\n`,
    );
    expect(signals.map((s) => s.kind)).toContain("jvm-target");
  });

  it("ignores commented-out signals", () => {
    const signals = classifyBuildFile(
      "build.gradle.kts",
      `// id("org.jetbrains.compose")\n# compose-multiplatform\nplugins {}\n`,
    );
    expect(signals).toEqual([]);
  });

  it("finds no CMP signal in an Android-only build script", () => {
    const signals = classifyBuildFile(
      "build.gradle.kts",
      `plugins {\n  id("com.android.application")\n  id("org.jetbrains.kotlin.android")\n}\ndependencies {\n  implementation("androidx.compose.ui:ui:1.7.0")\n}\n`,
    );
    expect(signals).toEqual([]);
  });

  it("reports at most one signal per kind, with an auditable match string", () => {
    const signals = classifyBuildFile(
      "build.gradle.kts",
      `jvm()\njvm()\n`,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.kind).toBe("jvm-target");
    expect(signals[0]?.match).toBeTruthy();
    expect(signals[0]?.path).toBe("build.gradle.kts");
  });
});

describe("summarizeCmp", () => {
  it("is capable on any signal, incapable on none", () => {
    expect(summarizeCmp([]).cmpCapable).toBe(false);
    expect(
      summarizeCmp([{ kind: "jvm-target", path: "build.gradle.kts", match: "jvm()" }])
        .cmpCapable,
    ).toBe(true);
  });
});

describe("cmpSuggestion", () => {
  it("promotes CMP only when the repo is not capable", () => {
    expect(cmpSuggestion({ cmpCapable: true, signals: [] })).toBeUndefined();
    const text = cmpSuggestion({ cmpCapable: false, signals: [] });
    expect(text).toBeDefined();
    expect(text).toMatch(/Compose Multiplatform/);
    expect(text).toMatch(/Advisory only/);
    expect(text).toMatch(/Jetpack Compose stays fully supported/);
  });
});

describe("detectMaturity + CMP", () => {
  it("detects a CMP-capable repo with no suggestion", async () => {
    const r = await detectMaturity(fixture("cmp-capable"));
    expect(r.cmpCapable).toBe(true);
    expect(r.cmp.cmpCapable).toBe(true);
    expect(r.cmp.signals.length).toBeGreaterThan(0);
    expect(cmpSuggestion(r.cmp)).toBeUndefined();
  });

  it("detects a version-catalog CMP repo", async () => {
    const r = await detectMaturity(fixture("cmp-catalog"));
    expect(r.cmpCapable).toBe(true);
    const kinds = r.cmp.signals.map((s) => s.kind);
    expect(kinds).toContain("compose-plugin");
    expect(kinds).toContain("kotlin-multiplatform");
  });

  it("detects an Android-only repo as not capable, with a suggestion", async () => {
    const r = await detectMaturity(fixture("android-only"));
    expect(r.cmpCapable).toBe(false);
    expect(r.cmp.signals).toEqual([]);
    expect(cmpSuggestion(r.cmp)).toBeDefined();
  });

  it("does not break the existing 3-rung result shape", async () => {
    const r = await detectMaturity(fixture("cmp-capable"));
    // CMP is orthogonal to the rung; a plain CMP module has no design-system signal.
    expect(r.rung).toBe("bootstrap");
    expect(r.hasCodeConnect).toBe(false);
    expect(r.hasDesignMap).toBe(false);
    expect(r.hasTokens).toBe(false);
    expect(r.signals).toEqual([]);
  });
});

describe("planBootstrap + CMP", () => {
  it("attaches a CMP suggestion for an Android-only repo", async () => {
    const plan = await planBootstrap(fixture("android-only"));
    expect(plan.maturity.cmpCapable).toBe(false);
    expect(plan.cmpSuggestion).toBeDefined();
  });

  it("omits the suggestion for a CMP-capable repo", async () => {
    const plan = await planBootstrap(fixture("cmp-capable"));
    expect(plan.maturity.cmpCapable).toBe(true);
    expect(plan.cmpSuggestion).toBeUndefined();
  });

  it("never gates: CMP capability does not change planned artifacts", async () => {
    const cmp = await planBootstrap(fixture("cmp-capable"));
    const android = await planBootstrap(fixture("android-only"));
    // Both are rung-3 greenfield modules: same artifact set, suggestion aside.
    expect(cmp.artifacts.map((a) => a.path).sort()).toEqual(
      android.artifacts.map((a) => a.path).sort(),
    );
  });
});
