/**
 * The translation layer between a code catalog's knobs and a design kit's
 * vocabulary.
 *
 * The two taxonomies are genuinely different and neither is wrong: a code knob
 * describes the component's API (`size=l`), a kit axis describes how the design
 * team files its variants (`Size=Large`). Nothing derives one from the other,
 * so the mapping is a table.
 *
 * What keeps a table from becoming a guess: **every candidate it proposes is
 * checked against the kit's real axis list before use**, and a seed that
 * resolves to nothing is reported as unresolved rather than approximated. A
 * wrong translation is worse than none — under a `design-led` direction it
 * would drive the code away from the kit it is copying, citing a node nobody
 * meant.
 *
 * The defaults below are tuned against Material-3-shaped kits. A kit that files
 * its variants differently supplies its own via {@link Vocabulary}; the
 * defaults are a starting point, not a contract.
 */

/** Knob key → the kit axes it might name, in preference order. */
export type AxisAliases = Record<string, string[]>;

/** Knob value → the kit's spelling(s), in preference order. */
export type ValueAliases = Record<string, string[]>;

export interface Vocabulary {
  axes: AxisAliases;
  values: ValueAliases;
}

/**
 * Knob key -> the kit axis it names. The kit's taxonomy is its own; ours
 * describes the Compose API. Where the two disagree it is a translation, not a
 * guess — each entry is checked against the set's real axis list before use.
 */
export const DEFAULT_AXIS_ALIASES: AxisAliases = {
  // `status` is a code word for error/disabled. Material-3-shaped kits file
  // `Disabled` under `State` and `Error …` under `Type`, so the knob names both
  // axes and the value decides which one answers.
  status: ["State", "Type"],
  state: ["State", "Type", "Selected", "Configuration"],
  selected: ["Selected", "Type"],
  size: ["Size"],
  shape: ["Type", "Shape"],
  count: ["Nav items", "Segments", "Icons", "Groups", "# of lines"],
  actions: ["Icons"],
  lines: ["Multi-line", "# of lines"],
  labels: ["Configuration", "Label"],
  content: ["Configuration", "Layout", "Show icon", "Icon"],
  leading: ["Configuration", "Leading icon"],
  trailing: ["Show trailing icon", "Trailing icon", "Configuration"],
  icon: ["Icon", "Show icon"],
  style: ["Style"],
  // `layout` is a code word for both: a card's content arrangement is the kit's
  // `Layout`, a time picker's is its `Orientation`. The value decides.
  layout: ["Layout", "Orientation"],
  mode: ["Type"],
  hours: ["Format"],
  header: ["Show back", "Configuration"],
  progress: ["Progress"],
  handle: ["Configuration"],
  dividers: ["Groups", "Configuration"],
  avatar: ["Show avatar"],
  fab: ["Configuration"],
  expanded: ["Type"],
  menu: ["Configuration"],
  badge: ["Badge"],
  caret: ["Configuration"],
  footer: ["Configuration"],
  headline: ["Configuration"],
  nav: ["Configuration"],
  inset: ["Configuration"],
  label: ["Size"],
  action: ["Configuration"],
  close: ["Show close affordance"],
  configuration: ["Configuration"],
};

/** Knob value -> the kit's spelling. Multiple candidates are tried in order. */
export const DEFAULT_VALUE_ALIASES: ValueAliases = {
  xs: ["XSmall"],
  s: ["Small"],
  m: ["Medium"],
  l: ["Large"],
  xl: ["XLarge"],
  on: ["True", "Enabled"],
  off: ["False", "Unselected"],
  true: ["True"],
  false: ["False"],
  none: ["False", "Label only", "None"],
  icon: ["Icon only", "True"],
  disabled: ["Disabled"],
  enabled: ["Enabled"],
  hovered: ["Hovered"],
  focused: ["Focused"],
  // `Presssed` is the Material 3 kit's own misspelling, on all ten
  // `Button - outline` press variants and nowhere else. The kit is read-only to
  // us, so the choice is to carry the typo or leave that component's press
  // state uncompared; the correct spelling is tried first, so this only ever
  // catches the one set that needs it.
  pressed: ["Pressed", "Presssed"],
  selected: ["True", "Selected"],
  unselected: ["False", "Unselected"],
  checked: ["Selected", "True"],
  unchecked: ["Unselected", "False"],
  indeterminate: ["Indeterminate"],
  error: ["Error selected", "Error"],
  empty: ["False", "0"],
  square: ["Square"],
  round: ["Round"],
  input: ["Keyboard", "Input"],
  vertical: ["Vertical"],
  horizontal: ["Horizontal"],
  media: ["Media & text"],
  slot: ["Slot"],
  "text+action": ["Text & action"],
  two: ["Two lines"],
  one: ["One line"],
  // Container roles: our knobs hyphenate what the kit spaces.
  "primary-container": ["Primary container"],
  "secondary-container": ["Secondary container"],
  "tertiary-container": ["Tertiary container"],
  avatar: ["Label & avatar", "True"],
  "icon+label": ["Label & icon"],
  both: ["Label & icon"],
  query: ["True"],
  text: ["Label only"],
  "12": ["12 hour"],
  "24": ["24 hour"],
};

export const DEFAULT_VOCABULARY: Vocabulary = {
  axes: DEFAULT_AXIS_ALIASES,
  values: DEFAULT_VALUE_ALIASES,
};

/**
 * Merge caller-supplied aliases over the defaults, per key. A kit that renames
 * one axis should not have to restate the other thirty.
 */
export function mergeVocabulary(overrides?: Partial<Vocabulary>): Vocabulary {
  if (!overrides) return DEFAULT_VOCABULARY;
  return {
    axes: { ...DEFAULT_AXIS_ALIASES, ...overrides.axes },
    values: { ...DEFAULT_VALUE_ALIASES, ...overrides.values },
  };
}

/** Strip everything but letters and digits, lowercased — the comparison form. */
export const norm = (s: unknown): string =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * The comparison form for a name somebody **declared**, as opposed to one being guessed at.
 *
 * {@link norm} exists to compare a code slug against a kit spelling, and strips everything outside
 * `[a-z0-9]`. That is fine for a slug and wrong for a declaration: a kit filing its axes as `サイズ`
 * and `状態` normalises both to the empty string, so an equality test matches whichever axis
 * happened to be indexed first — a confident reference to the wrong node, which is precisely what
 * declaring the kit's own name exists to prevent. This keeps letters and digits in any script and
 * drops only the separators and punctuation two spellings of one name can reasonably differ by.
 */
export const normName = (s: unknown): string =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Whether two names are the same name, for a declared one.
 *
 * Falls back to whole-string equality when either side is nothing but punctuation, since two names
 * that both normalise to the empty string are not thereby equal.
 */
export const sameName = (a: unknown, b: unknown): boolean => {
  const left = normName(a);
  const right = normName(b);
  if (left && right) return left === right;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
};

/** The distinct lowercase words in a name or value, for set-wise comparison. */
export const wordsOf = (s: unknown): Set<string> =>
  new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

/** `actions` and `action` name the same thing; our knobs pluralise, the kit does not. */
export const singular = (s: string): string =>
  s.length > 3 && s.endsWith("s") ? s.slice(0, -1) : s;

export const TRUTHY = new Set(["true", "on", "yes", "1"]);
export const FALSY = new Set(["false", "off", "no", "0", "none"]);

/**
 * The kit axes a knob could name, most specific first.
 *
 * Three sources, in order: a name that matches the knob directly, a name the
 * alias table proposes, and — as a last resort — an axis the vocabulary does
 * not name but that this knob is recognisably *about*.
 *
 * That last resort is deliberately narrow. Verifying a candidate against the
 * real variant list is not enough on its own: a boolean axis accepts `True`
 * from any knob, so `footer=true` cheerfully matched `Show back=True` and
 * `supporting=on` matched `Leading icon=True`. Both are confident references to
 * the wrong node, which is worse than none — design-parity then measures a
 * difference nobody asked about.
 *
 * So the affinity has to be a shared WORD, with the knob's key or with its
 * value (`content=avatar` means the `Show avatar` axis, and it is the value
 * that says so). Word for word, not substring: `Leading icon` contains the
 * letters of `on`, so `supporting=on` looked related to it under a substring
 * test and resolved to the wrong axis with the right value.
 */
export function axisCandidates(
  knob: string,
  axes: Record<string, string>,
  raw: unknown,
  vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): string[] {
  const named = vocabulary.axes[knob] ?? [];
  const byName = Object.keys(axes).filter((a) => {
    const n = norm(a);
    const k = norm(knob);
    return n === k || n.startsWith(k) || k.startsWith(n);
  });
  const aliased = named.filter((a) => a in axes);
  const words = [norm(knob), norm(raw ?? "")].filter(Boolean);
  const related = Object.keys(axes).filter((a) => {
    const parts = a
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return words.some((w) => parts.includes(w) || norm(a) === w);
  });
  return [...new Set([...byName, ...aliased, ...related])];
}

/** The kit spellings a knob value could take, most likely first. */
export function valueCandidates(
  raw: unknown,
  vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): string[] {
  const text = String(raw);
  const out = [...(vocabulary.values[text.toLowerCase()] ?? [])];
  out.push(text);
  // A float knob like progress=0.25 is a percentage in the kit.
  const f = Number(raw);
  if (Number.isFinite(f) && f <= 1 && text.includes(".")) {
    out.push(String(Math.round(f * 100)));
  }
  if (Number.isFinite(f) && f === 0) out.push("0");
  if (Number.isFinite(f) && f === 1) out.push("100");
  // The kit capitalises its values ("Elevated"); our knobs do not.
  out.push(text.charAt(0).toUpperCase() + text.slice(1));
  return [...new Set(out)];
}
