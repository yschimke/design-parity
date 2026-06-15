#!/usr/bin/env node
/**
 * CLI: validate one or more DTCG token files against the schema.
 *
 *   design-parity-validate-tokens [path ...]
 *
 * Defaults to `tokens.tokens.json` in the cwd when no paths are given. Exits
 * non-zero on the first invalid file so it can gate CI. Per-token read warnings
 * (unknown `$type`, unresolved alias) are printed but do not fail the file.
 */
import { argv, exit } from "node:process";
import { loadDtcgTokens } from "../dtcg.js";

function count(tokens: {
  spacing?: object;
  radius?: object;
  colors?: object;
  typography?: object;
}): number {
  return (
    Object.keys(tokens.spacing ?? {}).length +
    Object.keys(tokens.radius ?? {}).length +
    Object.keys(tokens.colors ?? {}).length +
    Object.keys(tokens.typography ?? {}).length
  );
}

async function main(): Promise<number> {
  const paths = argv.slice(2);
  const targets = paths.length > 0 ? paths : ["tokens.tokens.json"];

  let failures = 0;
  for (const path of targets) {
    try {
      const { tokens, warnings } = await loadDtcgTokens(path);
      console.log(`ok   ${path} (${count(tokens)} tokens)`);
      for (const w of warnings) console.warn(`warn ${path}: ${w}`);
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${path}`);
      console.error(`     ${(err as Error).message.replace(/\n/g, "\n     ")}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

exit(await main());
