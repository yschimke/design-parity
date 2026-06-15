#!/usr/bin/env node
/**
 * `design-parity reverse` — the design→code lookup entry (issue #78 Phase 4).
 *
 *   design-parity reverse figma:AbCdEf/1:42        # what implements this node?
 *   design-parity reverse --repo .                 # dump the whole ref → code map
 *
 * A thin wrapper over {@link runReverse}: it owns `process` (argv, cwd, the
 * output streams, and the exit code) so the lookup logic stays unit-testable.
 */
import { argv, cwd, exit, stderr, stdout } from "node:process";

import { runReverse } from "../reverse.js";

exit(
  await runReverse(argv.slice(2), {
    out: (line) => stdout.write(line + "\n"),
    err: (line) => stderr.write(line + "\n"),
  }, cwd()),
);
