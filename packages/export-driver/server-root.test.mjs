import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const scorerUrl = new URL("./design-reference-score.mjs", import.meta.url).href;

test("the scorer accepts the documented direct format-compare.js path", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "scorer root "));
  try {
    const asset = path.join(fixture, "format-compare.js");
    fs.writeFileSync(asset, "// test scorer");
    // Import a fresh module so the configured root is read as it is in a real invocation.
    const prior = process.env.COMPOSE_PREVIEW_SERVER_ROOT;
    process.env.COMPOSE_PREVIEW_SERVER_ROOT = asset;
    try {
      const module = await import(`${scorerUrl}?fixture=${encodeURIComponent(fixture)}`);
      const messages = [];
      await module.openScorer({ executablePath: path.join(fixture, "no-browser"), log: (line) => messages.push(line) });
      assert.equal(messages.some((line) => line.includes("is not at")), false, messages.join("\n"));
    } finally {
      if (prior === undefined) delete process.env.COMPOSE_PREVIEW_SERVER_ROOT;
      else process.env.COMPOSE_PREVIEW_SERVER_ROOT = prior;
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("spec-preflight reports usage when installed at a path containing a space", () => {
  const fixture = fs.mkdtempSync(path.join(root, "entry path "));
  try {
    // Imported siblings resolve to the real package; only the main entry retains its spaced URL.
    for (const name of fs.readdirSync(root)) {
      if (name.endsWith(".mjs")) fs.symlinkSync(path.join(root, name), path.join(fixture, name));
    }
    const entry = path.join(fixture, "spec-preflight.mjs");
    const result = spawnSync(process.execPath, ["--preserve-symlinks-main", entry], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /--spec/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
