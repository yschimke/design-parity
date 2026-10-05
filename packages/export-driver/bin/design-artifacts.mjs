#!/usr/bin/env node
/**
 * `design-artifacts <script> [args…]` — run one of the export driver's scripts from the installed
 * package, with the arguments passed through and its exit status returned.
 *
 *   npx -p @design-parity/export-driver@<version> design-artifacts generate-design-catalog --spec …
 *
 * `<script>` is a file name in this package, with or without its `.mjs` or `.sh` extension. Only a
 * bare name is accepted, so a caller cannot reach a file outside the package.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [name, ...args] = process.argv.slice(2);

if (!name || name === "--help" || name === "-h") {
  process.stderr.write("usage: design-artifacts <script> [args…]\n");
  process.exit(name ? 0 : 2);
}
if (!/^[a-z0-9][a-z0-9-]*(\.mjs|\.sh)?$/.test(name) || name.endsWith(".test.mjs")) {
  process.stderr.write(`design-artifacts: not a driver script name: ${name}\n`);
  process.exit(2);
}

const candidates = /\.(mjs|sh)$/.test(name) ? [name] : [`${name}.mjs`, `${name}.sh`];
const file = candidates.map((candidate) => join(ROOT, candidate)).find((path) => existsSync(path));
if (!file) {
  process.stderr.write(`design-artifacts: no script named ${name}\n`);
  process.exit(2);
}

const command = file.endsWith(".sh") ? ["bash", [file, ...args]] : [process.execPath, [file, ...args]];
const result = spawnSync(command[0], command[1], { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`design-artifacts: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
