#!/usr/bin/env node
/**
 * Regenerate `src/acceptance/vendor/*.ts` from a `compose-ai-tools` checkout, and record what they
 * were generated from.
 *
 * Companion to `sync-known-differences-fixtures.mjs`: that one snapshots the conformance corpus,
 * this one snapshots the engine the corpus tests. Both were manual and neither left a trace, so a
 * vendored file edited in place looked exactly like a vendored file copied faithfully. That is not
 * hypothetical — this tree has carried a locally-hardened `projectTagIndex` that a later re-vendor
 * silently reverted, and two files that drifted by a stray trailing newline.
 *
 *   node packages/diff/test/sync-known-differences-vendor.mjs <compose-ai-tools-checkout> [ref]
 *
 * `ref` defaults to `origin/main`. Sources are read with `git show <ref>:<path>` rather than off the
 * working tree, so a dirty or stale checkout cannot be mistaken for a released upstream state — the
 * recorded commit always names bytes that exist in upstream history.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { toVendored } from "./vendor-transform.mjs";

const checkout = process.argv[2];
const ref = process.argv[3] ?? "origin/main";
if (!checkout) {
  process.stderr.write(
    "usage: node packages/diff/test/sync-known-differences-vendor.mjs <compose-ai-tools-checkout> [ref]\n",
  );
  process.exit(2);
}

const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "acceptance", "vendor");
const UPSTREAM_DIR = "scripts/design-artifacts";
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const git = (...args) =>
  execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Capture git's stderr rather than letting it through. Every git failure here is one this
    // script turns into its own sentence, and git's message printed alongside it is noise in the
    // drift issue — the caller sees two explanations of one problem, in the wrong order.
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * Refuse, with the reason and nothing else.
 *
 * These are *expected* outcomes — a checkout that is not upstream, a commit not pushed, a module
 * gone from the ref — and the scheduled drift workflow forwards this output verbatim into an issue.
 * A `throw` would bury the one sentence that matters under twenty lines of Node stack and the
 * `execFileSync` error dump, which is exactly what the reader does not need. Unexpected failures
 * keep their stack, because for those the trace *is* the information.
 */
const refuse = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// **Verify the checkout is the repository this provenance is about to name.** Every `git` call
// below succeeds against any repo that merely happens to contain `scripts/design-artifacts/`, and
// the recorded `repository` would be a hardcoded claim about a checkout nobody checked. That is
// precisely the "land it upstream first" rule, defeated: a fork, or a local branch never pushed,
// would produce a provenance record naming a commit that does not exist upstream — and the offline
// test cannot tell, because by construction it only re-checks the digests recorded here.
const UPSTREAM_SLUG = "yschimke/compose-ai-tools";
const remotes = git("config", "--get-regexp", String.raw`^remote\..*\.url$`)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const at = line.indexOf(" ");
    return { name: line.slice(7, at - 4), url: line.slice(at + 1) };
  });
const upstreamRemote = remotes.find(({ url }) =>
  new RegExp(String.raw`[:/]${UPSTREAM_SLUG}(\.git)?/?$`).test(url.trim()),
);
if (!upstreamRemote) {
  refuse(
    `nothing written: ${checkout} has no remote pointing at ${UPSTREAM_SLUG} ` +
      `(found: ${remotes.map((r) => r.url).join(", ") || "none"}). ` +
      "The provenance would name a repository this checkout is not.",
  );
}

let commit;
try {
  commit = git("rev-parse", ref).trim();
} catch {
  refuse(`nothing written: ${checkout} cannot resolve the ref \`${ref}\`. Fetch it first.`);
}

// And that the commit is actually *on* that remote. A ref resolving locally proves only that the
// bytes exist on this machine; reachability from the remote is what makes "land upstream first"
// mean something. A commit on an unpushed branch fails here, which is the intended answer.
const reachable = git(
  "branch", "--remotes", "--contains", commit, "--list", `${upstreamRemote.name}/*`,
).trim();
if (!reachable) {
  refuse(
    `nothing written: ${commit} is not reachable from any ${upstreamRemote.name}/* branch. ` +
      "Push the change upstream and fetch before vendoring it — otherwise the recorded commit " +
      "names bytes no one else can resolve.",
  );
}
const modules = readdirSync(VENDOR_DIR).filter((name) => name.endsWith(".ts")).sort();

// Resolve every module before writing any of them. A ref where one module has been renamed or
// removed upstream is exactly when a half-rewritten vendor directory would do the most damage:
// the tree still compiles, the tests still mostly pass, and the copies are now pinned to two
// different commits with nothing saying so.
const files = {};
const writes = [];
const missing = [];
for (const name of modules) {
  const upstreamName = `${name.slice(0, -3)}.mjs`;
  let source;
  try {
    source = git("show", `${commit}:${UPSTREAM_DIR}/${upstreamName}`);
  } catch {
    missing.push(`${UPSTREAM_DIR}/${upstreamName}`);
    continue;
  }
  const vendored = toVendored(source);
  writes.push([join(VENDOR_DIR, name), vendored]);
  files[name] = {
    upstream: `${UPSTREAM_DIR}/${upstreamName}`,
    upstreamSha256: sha256(source),
    vendoredSha256: sha256(vendored),
  };
}
if (missing.length > 0) {
  refuse(
    `nothing written: ${commit} has no ${missing.join(", ")}. ` +
      "If a module was renamed or dropped upstream, decide what this package should vendor and " +
      "rename or delete its copy first — the sync mirrors, it does not choose.",
  );
}
for (const [path, text] of writes) writeFileSync(path, text);

writeFileSync(
  join(VENDOR_DIR, "PROVENANCE.json"),
  `${JSON.stringify(
    {
      $comment:
        "Generated by packages/diff/test/sync-known-differences-vendor.mjs — do not hand-edit. " +
        "Porting a fix into a vendored file means landing it upstream first, then re-running the sync.",
      // The URL of the remote actually verified above, not a constant — the record states what was
      // checked, so it cannot quietly describe a different repository than the one vendored from.
      repository: upstreamRemote.url.trim(),
      commit,
      files,
    },
    null,
    2,
  )}\n`,
);

console.log(`vendored ${modules.length} module(s) from ${commit}`);
