#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const sourceRepo = process.argv[2];
if (!sourceRepo) {
  throw new Error(
    "usage: node packages/diff/test/sync-known-differences-fixtures.mjs <compose-ai-tools-checkout>",
  );
}

const source = resolve(
  sourceRepo,
  "scripts/design-artifacts/fixtures/known-differences",
);
const output = fileURLToPath(
  new URL("fixtures/known-differences.zip", import.meta.url),
);
const files = [];
const visit = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) visit(path);
    else if (info.isFile()) files.push(path);
    else throw new Error(`unsupported fixture entry: ${path}`);
  }
};
visit(source);

const entries = Object.create(null);
const epoch = new Date("1980-01-01T00:00:00Z");
for (const path of files) {
  const name = relative(source, path).split(sep).join("/");
  entries[name] = [new Uint8Array(readFileSync(path)), { mtime: epoch }];
}
writeFileSync(output, zipSync(entries, { level: 9, mtime: epoch }));
console.log(`wrote ${output} (${files.length} canonical files)`);
