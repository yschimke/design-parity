/**
 * Compose Multiplatform (CMP) capability detection (Principle 6).
 *
 * The candidate side is cheapest to render when the UI is Compose
 * Multiplatform: a CMP component renders on the JVM/desktop — and, increasingly,
 * a headless browser via Compose for Web / wasm — with no Android emulator. So
 * the bot *prefers* the CMP render path when a project supports it, and
 * *promotes* CMP to projects that don't. This module supplies the deterministic
 * half of that: scan committed Gradle build files for CMP signals and report a
 * `cmpCapable` verdict plus the evidence behind it.
 *
 * This is detection + advisory only. It NEVER gates: plain Jetpack Compose stays
 * fully supported, and a non-CMP repo gets a suggestion, not a failure
 * (Principle 6). Detection is a bounded, deterministic, offline file scan — no
 * model calls, no network, no toolchain — matching {@link detectMaturity}.
 */

/** What kind of CMP evidence a build file yielded. */
export type CmpSignalKind =
  /** The `org.jetbrains.compose` Gradle plugin (the CMP plugin). */
  | "compose-plugin"
  /** The Kotlin Multiplatform plugin (`kotlin("multiplatform")` / KMP id). */
  | "kotlin-multiplatform"
  /** A non-Android KMP target that can host a headless render (jvm/desktop/wasmJs/js). */
  | "jvm-target"
  /** A `compose-multiplatform` dependency or version-catalog coordinate. */
  | "compose-dependency";

/** One piece of CMP evidence found in a build file. */
export interface CmpSignal {
  kind: CmpSignalKind;
  /** Repo-relative path to the build file that matched. */
  path: string;
  /** The literal text fragment that matched, for an auditable verdict. */
  match: string;
}

/** The CMP capability verdict, surfaced on the maturity result. */
export interface CmpCapability {
  /** True when any CMP signal was found (drives the prefer/promote choice). */
  cmpCapable: boolean;
  /** Every CMP signal found, in scan order — the audit trail. */
  signals: CmpSignal[];
}

/**
 * Build files worth scanning for CMP signals. Kept narrow and deterministic:
 * Gradle build scripts (Groovy + Kotlin DSL), settings scripts, and the Gradle
 * version catalog where plugins/deps are commonly declared.
 */
const BUILD_FILE_RE =
  /^(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|libs\.versions\.toml)$/;

/** True if `name` is a build file this module scans. */
export function isCmpBuildFile(name: string): boolean {
  return BUILD_FILE_RE.test(name);
}

/**
 * Signal patterns. Each entry maps a regex to the {@link CmpSignalKind} it
 * proves. Order is the scan order, so a file's signals come out
 * plugin-before-target-before-dependency for a stable, readable audit trail.
 *
 * The patterns are intentionally tolerant of Groovy and Kotlin DSL syntax:
 *   - plugin alias `id "org.jetbrains.compose"`, `id("org.jetbrains.compose")`,
 *     `alias(libs.plugins.compose...)`, or a `[plugins]` catalog entry;
 *   - `kotlin("multiplatform")` and the bare `org.jetbrains.kotlin.multiplatform`
 *     plugin id;
 *   - a non-Android KMP target block: `jvm()`, `js(...)`, `wasmJs(...)`, or a
 *     `desktop`/`jvm` source-set / target reference;
 *   - a `compose-multiplatform` / `org.jetbrains.compose` dependency coordinate.
 */
const PATTERNS: ReadonlyArray<{ kind: CmpSignalKind; re: RegExp }> = [
  {
    kind: "compose-plugin",
    // org.jetbrains.compose plugin via id(...)/id "..." or a libs.plugins.compose alias.
    re: /org\.jetbrains\.compose|(?:alias\([^)]*|libs\.plugins\.)compose(?:[-_.]multiplatform)?\b/,
  },
  {
    kind: "kotlin-multiplatform",
    // kotlin("multiplatform"), the bare plugin id, or a kotlin-multiplatform catalog coordinate.
    re: /kotlin\(\s*["']multiplatform["']\s*\)|org\.jetbrains\.kotlin\.multiplatform|kotlin[-.]multiplatform/,
  },
  {
    kind: "jvm-target",
    // A non-Android KMP target/source-set that can host a headless render:
    // jvm()/desktop, or a wasmJs/js target in call or trailing-lambda form.
    re: /\bjvm\s*\(\s*\)|\bdesktop\b|\bwasmJs\s*[({]|\bjs\s*[({]/,
  },
  {
    kind: "compose-dependency",
    // A compose-multiplatform dependency coordinate / version-catalog key.
    re: /compose[-.]multiplatform|org\.jetbrains\.compose:/,
  },
];

/**
 * Classify the contents of a single build file into CMP signals (pure).
 *
 * Comment lines (`//`, `#`) are skipped so a commented-out plugin block never
 * trips a false positive. At most one signal per kind per file is reported, so
 * the evidence stays compact.
 *
 * @param path repo-relative path, echoed back on each signal for the audit trail
 * @param contents the file's text
 */
export function classifyBuildFile(path: string, contents: string): CmpSignal[] {
  const out: CmpSignal[] = [];
  const seen = new Set<CmpSignalKind>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("#")) continue;

    for (const { kind, re } of PATTERNS) {
      if (seen.has(kind)) continue;
      const m = re.exec(line);
      if (m) {
        seen.add(kind);
        out.push({ kind, path, match: m[0] });
      }
    }
  }

  // Emit in PATTERNS order for a stable, readable audit trail.
  return out.sort(
    (a, b) =>
      PATTERNS.findIndex((p) => p.kind === a.kind) -
      PATTERNS.findIndex((p) => p.kind === b.kind),
  );
}

/**
 * Fold a set of per-file signals into a {@link CmpCapability} verdict.
 *
 * A repo is CMP-capable on *any* signal — the CMP plugin, the KMP plugin, a
 * JVM/desktop/wasm/js target, or a compose-multiplatform dependency. The
 * threshold is deliberately permissive: this is an advisory promote/prefer hint,
 * never a gate, so a false positive merely skips a suggestion and a false
 * negative merely shows one (Principle 6).
 */
export function summarizeCmp(signals: CmpSignal[]): CmpCapability {
  return { cmpCapable: signals.length > 0, signals };
}

/**
 * The promotion suggestion shown to Android-only (non-CMP) projects. Returns a
 * non-blocking advisory string when `capability.cmpCapable` is false, and
 * `undefined` when the repo is already CMP-capable (nothing to promote).
 *
 * This is the "promote CMP, never require it" half of Principle 6: advisory
 * only, surfaced in the bootstrap output and (where relevant) the PR comment —
 * never a gate.
 */
export function cmpSuggestion(capability: CmpCapability): string | undefined {
  if (capability.cmpCapable) return undefined;
  return (
    "This project looks Android-only (Jetpack Compose); no Compose Multiplatform " +
    "signal was found. Compose Multiplatform would let design-parity render " +
    "candidates on the JVM/desktop — and potentially a headless browser via " +
    "Compose for Web / wasm — with no Android emulator, making parity faster, " +
    "more portable, and easier to run unattended. Consider adopting it. " +
    "(Advisory only — plain Jetpack Compose stays fully supported.)"
  );
}
