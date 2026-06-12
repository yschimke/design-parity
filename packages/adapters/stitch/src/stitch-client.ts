/**
 * The seam over Google Stitch. Stitch ships `@google/stitch-sdk` + an MCP
 * server but has **no Code Connect equivalent**, so the design is fetched by a
 * `design-map`-resolved handle. Unit tests inject a fake {@link StitchClient};
 * the default client lazily drives the SDK so the package keeps zero hard
 * third-party deps (mirrors the figma adapter's injectable `fetch`).
 */
import type { Theme } from "@design-parity/core";

import { StitchAuthError, StitchSdkError } from "./errors.js";
import type { StitchRef } from "./stitch-ref.js";

/** One screen variant the Stitch SDK exposes for a design. */
export interface StitchScreen {
  /** Variant state, e.g. `"default"`, `"pressed"`. Defaults to `"default"`. */
  state?: string;
  theme?: Theme;
  /** Window-size label, e.g. `"compact"`, `"medium"`, `"expanded"`. */
  size?: string;
  /** Stitch's generated markup, classed with Tailwind utilities. */
  html: string;
  /** Optional stylesheet the rasterizer should inline alongside the HTML. */
  css?: string;
}

/** A Stitch design as returned by the SDK: one or more screen variants. */
export interface StitchDesign {
  /** Echoes the requested component handle when the SDK supplies it. */
  componentId?: string;
  screens: StitchScreen[];
}

/** Driver over `@google/stitch-sdk`. Inject a fake in tests. */
export interface StitchClient {
  fetchDesign(ref: StitchRef): Promise<StitchDesign>;
}

/** Env keys the default SDK client reads a credential from, in order. */
const TOKEN_ENV = [
  "STITCH_API_KEY",
  "STITCH_TOKEN",
  "STITCH_ACCESS_TOKEN",
  "GOOGLE_STITCH_TOKEN",
] as const;

/**
 * The shape this adapter consumes from `@google/stitch-sdk`. The SDK's exact
 * surface is upstream-owned, so it's treated as a documented consumption
 * contract and read defensively; live wiring confirms the field names.
 */
interface SdkModule {
  StitchClient: new (opts: { apiKey: string }) => {
    getScreen(args: {
      projectId: string;
      screenId: string;
    }): Promise<{
      html?: string;
      css?: string;
      variants?: Array<{
        state?: string;
        theme?: string;
        size?: string;
        html?: string;
        css?: string;
      }>;
      componentId?: string;
    }>;
  };
}

function asTheme(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/**
 * Build the default SDK-backed client from `AdapterContext.env`.
 *
 * @throws {StitchAuthError} when no credential is configured.
 * @throws {StitchSdkError} when the SDK isn't installed or returns no markup.
 */
export function createSdkStitchClient(
  env: Record<string, string | undefined>,
): StitchClient {
  const apiKey = TOKEN_ENV.map((k) => env[k]).find(Boolean);
  if (!apiKey) {
    throw new StitchAuthError(
      `stitch: no credential found — set one of ${TOKEN_ENV.join(", ")}, or inject a StitchClient`,
    );
  }

  return {
    async fetchDesign(ref: StitchRef): Promise<StitchDesign> {
      // Non-literal specifier so the optional SDK isn't a compile-time
      // resolution target; absence surfaces as a clear, actionable error.
      const specifier = "@google/stitch-sdk";
      let sdk: SdkModule;
      try {
        sdk = (await import(specifier)) as unknown as SdkModule;
      } catch (cause) {
        throw new StitchSdkError(
          "stitch: '@google/stitch-sdk' is not installed — `npm i @google/stitch-sdk` to use the default client, or inject a StitchClient",
          { cause },
        );
      }

      let raw: Awaited<
        ReturnType<InstanceType<SdkModule["StitchClient"]>["getScreen"]>
      >;
      try {
        const client = new sdk.StitchClient({ apiKey });
        raw = await client.getScreen({
          projectId: ref.projectId,
          screenId: ref.screenId,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (/401|403|unauthor|forbidden|api key|credential/i.test(message)) {
          throw new StitchAuthError(`stitch: SDK rejected the credential — ${message}`, {
            cause,
          });
        }
        throw new StitchSdkError(`stitch: SDK request failed — ${message}`, { cause });
      }

      const screens: StitchScreen[] =
        raw.variants && raw.variants.length > 0
          ? raw.variants.map((v) => {
              const html = v.html ?? raw.html;
              if (html === undefined) {
                throw new StitchSdkError("stitch: SDK variant returned no HTML");
              }
              const screen: StitchScreen = { html };
              if (v.state !== undefined) screen.state = v.state;
              const theme = asTheme(v.theme);
              if (theme) screen.theme = theme;
              if (v.size !== undefined) screen.size = v.size;
              if (v.css ?? raw.css) screen.css = v.css ?? raw.css;
              return screen;
            })
          : (() => {
              if (raw.html === undefined) {
                throw new StitchSdkError("stitch: SDK returned no HTML for the screen");
              }
              const screen: StitchScreen = { html: raw.html };
              if (raw.css !== undefined) screen.css = raw.css;
              return [screen];
            })();

      const design: StitchDesign = { screens };
      if (raw.componentId !== undefined) design.componentId = raw.componentId;
      return design;
    },
  };
}
