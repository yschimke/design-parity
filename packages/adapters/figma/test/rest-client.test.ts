import { describe, it, expect } from "vitest";

import { FigmaApiError, FigmaAuthError, FigmaRateLimitError } from "../src/errors.js";
import { FigmaRestClient, type FetchLike } from "../src/rest-client.js";

/** A fetch that replays `responses` in order and records the urls it saw. */
function scriptedFetch(responses: Response[]): {
  fetch: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  let i = 0;
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return res;
  };
  return { fetch, calls };
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response("nope", { status: code, headers });

function clientFor(responses: Response[], attempts?: number) {
  const waits: number[] = [];
  const { fetch, calls } = scriptedFetch(responses);
  const client = new FigmaRestClient({
    token: "t",
    fetch,
    attempts,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { client, waits, calls };
}

describe("FigmaRestClient retrying", () => {
  it("retries a 429 and returns the eventual success", async () => {
    const { client, waits, calls } = clientFor([
      status(429),
      json({ nodes: {} }),
    ]);

    await expect(client.getFileNodes("KEY", ["1:2"])).resolves.toEqual({
      nodes: {},
    });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1_000]); // 2**1 * 500
  });

  it("honours Retry-After over the backoff schedule", async () => {
    const { client, waits } = clientFor([
      status(429, { "retry-after": "7" }),
      json({ nodes: {} }),
    ]);

    await client.getFileNodes("KEY", ["1:2"]);
    expect(waits).toEqual([7_000]);
  });

  it("gives up after `attempts` and raises the rate-limit error", async () => {
    const { client, waits, calls } = clientFor([status(429)], 3);

    await expect(client.getFileNodes("KEY", ["1:2"])).rejects.toBeInstanceOf(
      FigmaRateLimitError,
    );
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1_000, 2_000]);
  });

  it("retries 5xx too", async () => {
    const { client, calls } = clientFor([status(503), json({ nodes: {} })]);

    await client.getFileNodes("KEY", ["1:2"]);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a terminal failure", async () => {
    const { client, calls } = clientFor([status(403)]);

    await expect(client.getFileNodes("KEY", ["1:2"])).rejects.toBeInstanceOf(
      FigmaAuthError,
    );
    expect(calls).toHaveLength(1);
  });

  it("does not retry a 404", async () => {
    const { client, calls } = clientFor([status(404)]);

    await expect(client.getFileNodes("KEY", ["1:2"])).rejects.toBeInstanceOf(
      FigmaApiError,
    );
    expect(calls).toHaveLength(1);
  });

  it("attempts: 1 disables retrying", async () => {
    const { client, calls, waits } = clientFor([status(429)], 1);

    await expect(client.getFileNodes("KEY", ["1:2"])).rejects.toBeInstanceOf(
      FigmaRateLimitError,
    );
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });
});

describe("getFileMeta", () => {
  it("reads the file's version without pulling the document", async () => {
    const { client, calls } = clientFor([
      json({
        name: "Material 3 Design Kit",
        lastModified: "2026-08-07T10:00:00Z",
        version: "123456789",
      }),
    ]);

    const meta = await client.getFileMeta("KEY");
    expect(meta.version).toBe("123456789");
    expect(meta.lastModified).toBe("2026-08-07T10:00:00Z");
    expect(calls[0]).toContain("/v1/files/KEY?depth=1");
  });
});
