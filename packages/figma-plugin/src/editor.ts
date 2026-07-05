/**
 * The override editor's **view model** — the pure bridge between a preview's
 * author-declared knobs (`previews.ts`) and the controls the UI iframe renders.
 *
 * `knobControls` turns each {@link OverrideDeclaration} into a flat control
 * descriptor (edit key, label, widget kind, seed text); {@link EDITOR_AXES} is
 * the curated set of fixed display axes the editor also exposes. The DOM in
 * `figma/ui.ts` is then pure reflection: render a widget per descriptor, read
 * its value back into the `edits` / `axes` maps `renderSourceForPreview` takes.
 *
 * Pure: no DOM, no `fetch` — the widget *choice* per knob kind and the axis set
 * are the testable decisions here.
 */
import { declarationText, seedKey, type Preview } from "./previews.js";
import type { KnobKind, OverrideKey } from "./render.js";

/** A control for one author-declared knob, ready for the UI to render. */
export interface KnobControl {
  /** The key edits are collected under — matches `renderSourceForPreview`'s `knobEdits`. */
  seedKey: string;
  /** Human label for the control. */
  label: string;
  /** The knob kind — picks the widget (bool → checkbox, else text) and wire encoding. */
  kind: KnobKind;
  /** The text the control starts from: the knob's current value, else its default. */
  value: string;
}

/** One control per author-declared knob a preview exposes, in declared order. */
export function knobControls(preview: Preview): KnobControl[] {
  return preview.overrides.map((declaration) => ({
    seedKey: seedKey(declaration),
    label: declaration.label,
    kind: declaration.type,
    value: declarationText(declaration),
  }));
}

/** A fixed display-axis control the editor surfaces alongside the author knobs. */
export interface AxisControl {
  /** The override key the value is sent under (a fixed `ServeOverrides` key). */
  key: OverrideKey;
  /** Human label for the control. */
  label: string;
  /** A hint of accepted values; an empty field means "server default". */
  placeholder: string;
}

/**
 * The curated subset of fixed display axes the override editor exposes, in
 * display order. Every `key` is a supported `/render` override key; a blank
 * field is dropped by `renderSourceForPreview`, so the render keeps the default.
 */
export const EDITOR_AXES: readonly AxisControl[] = [
  { key: "uiMode", label: "UI mode", placeholder: "light | dark" },
  { key: "device", label: "Device", placeholder: "e.g. phone, tablet" },
  { key: "localeTag", label: "Locale", placeholder: "e.g. en, ar, ja" },
  { key: "fontScale", label: "Font scale", placeholder: "e.g. 1.0, 1.5" },
  { key: "density", label: "Density", placeholder: "e.g. 2.0, 3.0" },
  { key: "orientation", label: "Orientation", placeholder: "portrait | landscape" },
] as const;
