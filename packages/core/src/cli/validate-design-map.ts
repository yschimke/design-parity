#!/usr/bin/env node
/**
 * CLI: validate one or more `design-map.json` files against the schema.
 *
 *   design-parity-validate-map [path ...]
 *
 * Defaults to `design-map.json` in the cwd when no paths are given. Exits
 * non-zero on the first invalid file so it can gate CI.
 */
import { argv, exit } from "node:process";
import { loadDesignMap } from "../design-map.js";

async function main(): Promise<number> {
  const paths = argv.slice(2);
  const targets = paths.length > 0 ? paths : ["design-map.json"];

  let failures = 0;
  for (const path of targets) {
    try {
      const map = await loadDesignMap(path);
      console.log(`ok   ${path} (${map.components.length} components)`);
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${path}`);
      console.error(`     ${(err as Error).message.replace(/\n/g, "\n     ")}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

exit(await main());
