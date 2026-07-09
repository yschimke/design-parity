/**
 * The **propose-a-spec** core — the design→code *start* of the round-trip.
 *
 * design-parity is code→design biased: catalogs render code and the plugin
 * imports them. This module adds the missing initiation leg — turn a designer's
 * selected Figma frame into a structured **spec** and a ready-to-file GitHub
 * **issue body** an agent (or human) can implement. Consistent with
 * "verify, don't generate" (`PRINCIPLES.md` §1): the plugin does **not** generate
 * code — it emits a committed, reviewable artifact + a tracking issue, exactly
 * the way the `design-map.json` panel hands its scaffold off today.
 *
 * A proposal isn't always "edit one component". It's one of three **kinds** —
 * a **new** component, an **edit** to an existing one, or a **screen** composed
 * of several — and a frame is often built *from* existing components, which ride
 * along as reference **context** (`uses`) rather than collapsing into the target.
 *
 * Pure: no `figma`, no `fetch`. The main thread reads the selected frame into a
 * {@link FrameRead} (structural plain data, incl. the component instances it
 * uses) and posts it; the UI builds the {@link FrameSpec} and renders
 * {@link specToIssueBody} / {@link specToJson} for the designer to copy. The a11y
 * + i18n **contract** the implementation must meet is baked in as acceptance
 * criteria — leading with a11y/i18n, per `PRINCIPLES.md` §2.
 */

/** What a proposal is: a brand-new component, an edit to an existing one, or a screen. */
export type SpecKind = "new" | "edit" | "screen";

/** Auto-layout spacing read off a frame (dp). Fields present only when known. */
export interface FrameLayout {
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Inter-child spacing (`itemSpacing`) on an auto-layout frame. */
  gap?: number;
  cornerRadius?: number;
}

/** The structural read of the selected frame, posted by the main thread. */
export interface FrameRead {
  name: string;
  width: number;
  height: number;
  /** Auto-layout spacing, when the frame carries it. */
  layout?: FrameLayout;
  /** Text content found in the frame (descendant text nodes), for the spec. */
  texts: string[];
  /** Names of bound Figma variables/tokens, best-effort (may be empty). */
  variables: string[];
  /** Component instances used within the frame — the building blocks, as context. */
  components: string[];
}

/** The a11y + i18n contract every proposed implementation must meet. */
export interface A11yContract {
  minContrastNormalAA: number;
  minContrastLargeAA: number;
  minTouchTargetDp: number;
  /** The i18n acceptance items (text expansion, RTL, hardcoded strings, dynamic type). */
  i18n: string[];
}

/**
 * design-parity's standing a11y + i18n contract (WCAG AA + Compose i18n
 * essentials). Emitted as acceptance criteria so a proposed component is held to
 * the same bar the parity Action enforces — the product leads with these.
 */
export const A11Y_CONTRACT: A11yContract = {
  minContrastNormalAA: 4.5,
  minContrastLargeAA: 3,
  minTouchTargetDp: 48,
  i18n: [
    "Text expansion & truncation (localized strings run longer)",
    "RTL mirroring",
    "No hardcoded user-facing strings (all via resources)",
    "Dynamic type / font-scale resilience",
  ],
};

/** The resolved spec: the frame's shape plus the kind, target id, uses, and contract. */
export interface FrameSpec {
  /** Whether this proposes a new component, an edit, or a screen. */
  kind: SpecKind;
  /** Suggested GitHub issue title. */
  title: string;
  /** The target this binds to: a component id (new/edit) or a screen id (screen). */
  targetId: string;
  name: string;
  width: number;
  height: number;
  layout?: FrameLayout;
  texts: string[];
  variables: string[];
  /** Existing components this frame uses / references, as context for the implementer. */
  uses: string[];
  a11y: A11yContract;
  notes?: string;
}

/** Overrides a designer supplies on top of the raw frame read. */
export interface SpecOptions {
  /** Proposal kind; defaults to {@link suggestKind}. */
  kind?: SpecKind;
  /** Target component/screen id; defaults to a slug of the frame name. */
  targetId?: string;
  /** Referenced components (context); defaults to the frame's detected instances. */
  uses?: string[];
  /** Free-text notes for the implementer. */
  notes?: string;
}

/** A reasonable default component id from a frame name (`Filled Button` → `FilledButton`). */
export function defaultComponentId(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Component";
  // Keep `/` groupers (catalog convention `Button/Filled`); PascalCase each segment.
  return (
    trimmed
      .split("/")
      .map((segment) =>
        segment
          .split(/[^a-zA-Z0-9]+/)
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(""),
      )
      .filter(Boolean)
      .join("/") || "Component"
  );
}

/**
 * A sensible default {@link SpecKind} for a read: a frame built from two or more
 * distinct components reads as a **screen**; otherwise a **new** component. The
 * designer overrides this (e.g. to `edit`) in the UI.
 */
export function suggestKind(read: FrameRead): SpecKind {
  return dedupe(read.components).length >= 2 ? "screen" : "new";
}

/** Dedupe strings, trimming blanks, preserving first-seen order. */
function dedupe(values: string[]): string[] {
  const seen: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

const KIND_LABEL: Record<SpecKind, string> = {
  new: "New component",
  edit: "Component edit",
  screen: "Screen",
};

/** The suggested issue title for a kind + target. */
function specTitle(kind: SpecKind, targetId: string): string {
  if (kind === "edit") return `Edit ${targetId} to match the Figma spec`;
  if (kind === "screen") return `New screen: ${targetId}`;
  return `New component: ${targetId}`;
}

/** Build the {@link FrameSpec} from a raw read plus optional designer overrides (pure). */
export function buildFrameSpec(read: FrameRead, opts: SpecOptions = {}): FrameSpec {
  const name = read.name.trim() || "Untitled frame";
  const kind = opts.kind ?? suggestKind(read);
  const targetId = opts.targetId?.trim() || defaultComponentId(name);
  const spec: FrameSpec = {
    kind,
    title: specTitle(kind, targetId),
    targetId,
    name,
    width: read.width,
    height: read.height,
    texts: read.texts.map((t) => t.trim()).filter(Boolean),
    variables: dedupe(read.variables),
    uses: dedupe(opts.uses ?? read.components),
    a11y: A11Y_CONTRACT,
  };
  if (read.layout && Object.keys(read.layout).length > 0) spec.layout = read.layout;
  const notes = opts.notes?.trim();
  if (notes) spec.notes = notes;
  return spec;
}

/** The spec as a committed `spec.json` artifact (stable key order). */
export function specToJson(spec: FrameSpec): string {
  return JSON.stringify(spec, null, 2);
}

/** Human padding summary (`top 16 · right 24 · bottom 16 · left 24 dp`), or undefined. */
function paddingLine(layout: FrameLayout): string | undefined {
  const parts: string[] = [];
  if (layout.paddingTop !== undefined) parts.push(`top ${layout.paddingTop}`);
  if (layout.paddingRight !== undefined) parts.push(`right ${layout.paddingRight}`);
  if (layout.paddingBottom !== undefined) parts.push(`bottom ${layout.paddingBottom}`);
  if (layout.paddingLeft !== undefined) parts.push(`left ${layout.paddingLeft}`);
  return parts.length > 0 ? `${parts.join(" · ")} dp` : undefined;
}

/** The kind-specific intro sentence for the issue body. */
function introLine(spec: FrameSpec): string {
  if (spec.kind === "edit") {
    return `Update the **existing** component \`${spec.targetId}\` to match this Figma frame, keeping the design-parity **a11y + i18n contract** below.`;
  }
  if (spec.kind === "screen") {
    return "Implement a **screen** composed of the components below, matching this Figma frame and meeting the design-parity **a11y + i18n contract**.";
  }
  return "Implement a **new** Compose component matching this Figma frame, and meeting the design-parity **a11y + i18n contract** below.";
}

/** The kind-specific correspondence note. */
function correspondenceLine(spec: FrameSpec): string {
  if (spec.kind === "edit") {
    return `Existing component id: \`${spec.targetId}\`. Update it to match; the refreshed render lands beside this frame on the next catalog import — closing the round-trip.`;
  }
  if (spec.kind === "screen") {
    return `Screen id: \`${spec.targetId}\`. Built from the components listed above; the screen render lands beside this frame on the next catalog import — closing the round-trip.`;
  }
  return `Proposed component id: \`${spec.targetId}\`. Once built and the catalog renders it, its render lands beside this frame via the design-parity Figma import — closing the round-trip.`;
}

/**
 * Render the spec as a GitHub **issue body** (Markdown): the frame, its layout
 * redlines, text, and the **components it's built from** (context), then the a11y
 * + i18n contract as an acceptance checklist and a kind-aware correspondence note.
 * Sections with no data are omitted (a screen always shows its uses block). The
 * exported frame PNG is attached separately (the plugin offers it as a download).
 */
export function specToIssueBody(spec: FrameSpec): string {
  const lines: string[] = [];
  lines.push(`## ${KIND_LABEL[spec.kind]} spec: \`${spec.targetId}\``);
  lines.push("");
  lines.push(`A designer authored this frame in Figma. ${introLine(spec)}`);
  lines.push("");
  lines.push("> **Attach the exported frame PNG** (the Propose-spec panel offers it as a download) so the visual target is in this issue.");
  lines.push("");
  lines.push(`**Frame:** \`${spec.name}\` — ${spec.width}×${spec.height} dp`);

  if (spec.layout) {
    lines.push("");
    lines.push("### Layout (redlines)");
    const pad = paddingLine(spec.layout);
    if (pad) lines.push(`- Padding: ${pad}`);
    if (spec.layout.gap !== undefined) lines.push(`- Gap between children: ${spec.layout.gap} dp`);
    if (spec.layout.cornerRadius !== undefined) lines.push(`- Corner radius: ${spec.layout.cornerRadius} dp`);
  }

  if (spec.uses.length > 0 || spec.kind === "screen") {
    lines.push("");
    lines.push(spec.kind === "screen" ? "### Components used" : "### Components referenced (context)");
    if (spec.uses.length > 0) {
      for (const use of spec.uses) lines.push(`- \`${use}\``);
    } else {
      lines.push("_List the existing components this screen composes._");
    }
  }

  if (spec.texts.length > 0) {
    lines.push("");
    lines.push("### Text content");
    for (const text of spec.texts) lines.push(`- ${JSON.stringify(text)}`);
  }

  lines.push("");
  lines.push("### Design tokens / variables");
  if (spec.variables.length > 0) {
    for (const variable of spec.variables) lines.push(`- \`${variable}\``);
  } else {
    lines.push("_None captured — bind Figma variables to the frame to carry tokens, or map to the system's tokens in code._");
  }

  lines.push("");
  lines.push("### Acceptance — a11y & i18n contract");
  lines.push(`- [ ] Contrast ≥ ${spec.a11y.minContrastNormalAA}:1 normal text / ${spec.a11y.minContrastLargeAA}:1 large text (WCAG AA)`);
  lines.push(`- [ ] Touch targets ≥ ${spec.a11y.minTouchTargetDp} dp`);
  lines.push("- [ ] Semantic roles / content descriptions on interactive elements");
  for (const item of spec.a11y.i18n) lines.push(`- [ ] ${item}`);

  lines.push("");
  lines.push("### Correspondence");
  lines.push(correspondenceLine(spec));

  if (spec.notes) {
    lines.push("");
    lines.push("### Notes");
    lines.push(spec.notes);
  }

  lines.push("");
  lines.push("---");
  lines.push("_Generated by the design-parity Figma plugin — Propose spec._");
  return lines.join("\n");
}
