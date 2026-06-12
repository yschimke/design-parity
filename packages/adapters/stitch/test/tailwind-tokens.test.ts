import { describe, it, expect } from "vitest";

import { tokensFromHtml } from "../src/tailwind-tokens.js";

describe("tokensFromHtml", () => {
  it("maps the offer-card utilities to spacing/radius/color/typography", () => {
    const html = `
      <div class="flex flex-col gap-2 p-4 rounded-xl bg-[#F5F5F7]">
        <h3 class="font-[Inter] text-base font-semibold leading-6 text-[#1A1A1A]">Summer Sale</h3>
        <p class="font-[Inter] text-[13px] font-normal leading-[18px] text-[#5F6368]">Up to 50% off.</p>
      </div>
    `;
    expect(tokensFromHtml(html)).toEqual({
      spacing: { padding: 16, gap: 8 },
      radius: { corner: 12 },
      colors: { container: "#F5F5F7", title: "#1A1A1A", body: "#5F6368" },
      typography: {
        title: { fontFamily: "Inter", fontSize: 16, fontWeight: 600, lineHeight: 24 },
        body: { fontFamily: "Inter", fontSize: 13, fontWeight: 400, lineHeight: 18 },
      },
    });
  });

  it("resolves named radius and text scales", () => {
    const html = `
      <section class="p-6 rounded-2xl bg-[#FFFFFF]">
        <h1 class="text-2xl font-bold leading-8 text-[#000000]">T</h1>
      </section>
    `;
    const tokens = tokensFromHtml(html);
    expect(tokens?.spacing?.padding).toBe(24);
    expect(tokens?.radius?.corner).toBe(16);
    expect(tokens?.typography?.title).toMatchObject({
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 32,
    });
  });

  it("normalizes hex casing to upper case", () => {
    const html = `<div class="p-2 bg-[#aabbcc]"></div>`;
    expect(tokensFromHtml(html)?.colors?.container).toBe("#AABBCC");
  });

  it("reads arbitrary px radius and a bare rounded", () => {
    expect(tokensFromHtml(`<div class="rounded p-1"></div>`)?.radius?.corner).toBe(4);
    expect(
      tokensFromHtml(`<div class="rounded-[10px] p-1"></div>`)?.radius?.corner,
    ).toBe(10);
  });

  it("returns undefined for markup with no elements", () => {
    expect(tokensFromHtml("just text")).toBeUndefined();
  });
});
