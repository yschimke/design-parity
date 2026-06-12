#!/usr/bin/env node
/**
 * CLI: validate one or more `design-parity.checks.json` files against the
 * schema.
 *
 *   design-parity-validate-checks [path ...]
 *
 * Defaults to `design-parity.checks.json` in the cwd when no paths are given.
 * Exits non-zero on the first invalid file so it can gate CI. A path that
 * doesn't exist is an error here (validation is explicit); the *runtime*
 * default for a missing config lives in `loadChecksConfigOrDefault`.
 */
import { argv, exit } from "node:process";
import {
  CHECKS_CONFIG_FILENAME,
  loadChecksConfig,
  resolveConfig,
} from "../load-config.js";

async function main(): Promise<number> {
  const paths = argv.slice(2);
  const targets = paths.length > 0 ? paths : [CHECKS_CONFIG_FILENAME];

  let failures = 0;
  for (const path of targets) {
    try {
      const config = await loadChecksConfig(path);
      const resolved = resolveConfig(config);
      console.log(
        `ok   ${path} (contrast: ${resolved.contrastLevel}, minTouchTarget: ${resolved.minTouchTarget})`,
      );
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${path}`);
      console.error(`     ${(err as Error).message.replace(/\n/g, "\n     ")}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

exit(await main());
