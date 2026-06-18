import { describe, it, expect } from "vitest";

import type { AdapterContext, CandidateRender } from "@design-parity/core";

import {
  applyRenderPath,
  chooseRenderPath,
  cliRenderSource,
  type CliRenderOptions,
  type RenderRequest,
} from "../src/index.js";

const ctx: AdapterContext = { repoRoot: "/repo", env: {} };

describe("chooseRenderPath (Principle 6)", () => {
  it("prefers the emulator-free Desktop/JVM path when CMP-capable", () => {
    const choice = chooseRenderPath({ cmpCapable: true });
    expect(choice.path).toBe("desktop");
    expect(choice.reason).toMatch(/Desktop\/JVM/);
  });

  it("falls back to the Android path when not CMP-capable (never gates)", () => {
    const choice = chooseRenderPath({ cmpCapable: false });
    expect(choice.path).toBe("android");
    expect(choice.reason).toMatch(/Android/);
  });
});

describe("applyRenderPath", () => {
  it("drops the Android-only variant on the desktop path", () => {
    const req: RenderRequest = { module: ":ui", variant: "demoDebug", filter: "Button" };
    const shaped = applyRenderPath("desktop", req);
    expect(shaped).toEqual({ module: ":ui", filter: "Button" });
    expect("variant" in shaped).toBe(false);
  });

  it("leaves the request untouched on the android path", () => {
    const req: RenderRequest = { module: ":app", variant: "demoDebug" };
    expect(applyRenderPath("android", req)).toBe(req);
  });

  it("never mutates its input", () => {
    const req: RenderRequest = { module: ":ui", variant: "demoDebug" };
    applyRenderPath("desktop", req);
    expect(req.variant).toBe("demoDebug");
  });

  it("is a no-op on desktop when there is no variant to drop", () => {
    const req: RenderRequest = { module: ":ui" };
    expect(applyRenderPath("desktop", req)).toBe(req);
  });
});

describe("cliRenderSource render-path preference", () => {
  // A fake driver records the RenderRequest it was handed, so we can assert which
  // path was driven without a real `compose-preview` CLI.
  const fakeCli = (seen: RenderRequest[]) => ({
    ensureInstalled: async () => {},
    render: async (req: RenderRequest) => {
      seen.push(req);
      return [
        {
          entry: { id: "P", pngPath: "/repo/p.png", params: {} },
          pngWidth: 10,
          pngHeight: 10,
        },
      ];
    },
  });

  const optionsFor =
    (cli: ReturnType<typeof fakeCli>): ((id: string) => CliRenderOptions) =>
    () => ({ projectDir: "/repo", variant: "demoDebug", cli });

  it("prefers the desktop path (drops variant) and tags kind cli-desktop when CMP-capable", async () => {
    const seen: RenderRequest[] = [];
    const source = cliRenderSource(optionsFor(fakeCli(seen)), {
      capability: { cmpCapable: true },
    });
    expect(source.kind).toBe("cli-desktop");
    const render = (await source.getCandidate("ui/Button.kt#B", ctx)) as CandidateRender;
    expect(render.componentId).toBe("ui/Button.kt#B");
    expect(seen[0]!.variant).toBeUndefined();
  });

  it("keeps the Android path unchanged (variant retained) when not CMP-capable", async () => {
    const seen: RenderRequest[] = [];
    const source = cliRenderSource(optionsFor(fakeCli(seen)), {
      capability: { cmpCapable: false },
    });
    expect(source.kind).toBe("cli-android");
    await source.getCandidate("ui/Button.kt#B", ctx);
    expect(seen[0]!.variant).toBe("demoDebug");
  });

  it("behaves exactly as before with no capability (kind cli, request untouched)", async () => {
    const seen: RenderRequest[] = [];
    const source = cliRenderSource(optionsFor(fakeCli(seen)));
    expect(source.kind).toBe("cli");
    await source.getCandidate("ui/Button.kt#B", ctx);
    expect(seen[0]!.variant).toBe("demoDebug");
  });

  it("still declines a component when optionsFor returns undefined", async () => {
    const source = cliRenderSource(() => undefined, {
      capability: { cmpCapable: true },
    });
    expect(await source.getCandidate("x", ctx)).toBeUndefined();
  });
});
