# `@design-parity/kit-index`

The design kit's own **vocabulary**, committed — so a catalog that renders one
component at six variants can say which kit node each of the six should be
compared against, without anyone maintaining that list by hand.

## The problem

A `design-map.json` entry binds a code component to **one** design node:

```jsonc
{ "code": "ui/Button.kt#FilledButton", "source": "figma", "ref": "figma:AbCdEf/57994:2324" }
```

That is exactly right for a parity diff, and not enough for a component that
renders more than one variant. A catalog picturing `Button` at three sizes and
two shapes has six renders and one ref, and nothing says which kit node the
other five belong to. Enumerating them by hand is the mapping-config sprawl a
design map exists to avoid — and it drifts silently the moment the kit gains a
variant, because a missing entry reads as *"no counterpart in the kit"* rather
than *"nobody looked"*.

So this package derives them, from what the kit itself publishes.

## The pipeline

```text
  design kit
      │  dump   ── walk every page, deep
      ▼
  figma-inventory.json      disposable, megabytes
      │  build  ── keep only what design-map.json references
      │            + fetch the component properties the walk cannot see
      ▼
  figma-kit-index.json      COMMITTED, tens of kilobytes
      │  resolve ── project a code knob onto it
      ▼
  { nodeId, name }
```

Only the two generation steps touch the network, and both are deliberate
"refresh the vocabulary" operations that land in a commit a reviewer can see.
**Resolution runs against the committed index, never the live kit**, so a parity
run reports the same thing for everyone and needs no design-tool credentials.

## Where the code side comes from

For a Compose catalog, the map and its variant declarations are **derived from
annotations** rather than authored. That half lives upstream in
[`compose-ai-tools`](https://github.com/yschimke/compose-ai-tools), because
every field it reads (`@CatalogComponent(reference = …)`, `@CatalogVariant`,
`@OverrideVariant`) is defined there — and it stops at the point where a design
kit's vocabulary would be needed:

```text
  previews.json
      │  emit-design-map.mjs             compose-ai-tools: knows the ANNOTATIONS
      ├──▶ design-map.json               base refs, one per component
      └──▶ design-map-variants.json      "same component, these knobs turned" —
           (compose-preview-design-map-      unresolved, because `size=l` is a
            variants/v1)                     Compose fact and `Size=Large` is a
      │                                      kit fact
      │  design-parity-kit-index resolve  THIS PACKAGE: knows the KIT
      ▼
  design-map.json with a tagged ref/previewId pair per variant
```

`resolve` reads only committed files, so unlike `dump`/`build` it needs no
credential and is safe on every build:

```console
$ design-parity-kit-index resolve
Wrote design-map.json: 1 variant reference(s) across 1 component(s).

1 variant(s) are a component PROPERTY in the kit, not a variant beside it. A
definition node renders at the defaults, and no exact configured instance was
indexed for these values, so they remain unpaired:
  - Button/Filled / true (icon=true) — Button: `Icon` (INSTANCE_SWAP, default "54616:25409")

1 reference(s) draw optional content by default. Every render made from them
includes it, so a sticker that leaves it out is compared against something it
never claimed:
  - Button/Filled — Button: `Show icon`
```

Three kinds of miss are reported apart because they have different owners: a
variant the kit models **neither way** is a real gap; a **property-shaped** one
means the kit has the thing and a node reference just cannot ask for it; and
**defaulted content** means the reference resolved but draws more than the code
did. Rolling them together is what makes a retired pattern read as neglect.

`--check` turns it into a drift gate instead of a writer. A **collision** — two
previews resolving to one node — is refused outright (exit 2, nothing written):
the same node cannot be both previews' counterpart, and a map that said so would
have the diff report one of the two renders as wrong.

## Three kinds of variation — and only two are addressable

|  | What it is | Addressable? |
| --- | --- | --- |
| **Variant axis** (`Size=Large`) | A sibling node with its own id | ✅ directly |
| **Component property** (`Show icon`) | A switch on the node | ⚠️ only via an instance |
| **Slot / instance swap** | A region, or which sub-component nests | ❌ never |

The middle row is the one that quietly poisons parity results. `GET /v1/images`
renders a node at its **property defaults**, and a reference is a node id with
nowhere to hang an override. So a kit whose `Button` defaults `Show icon` to
`true` renders an icon+label reference for a variant whose name says only
`Type=Round, Size=Small` — and label-only code diffed against it reports a
missing icon as though the *code* were wrong.

The way out is not to mutate the kit. It is that somebody already placed an
instance at the wanted vector, on an examples page, and **that instance's node
id is a renderable handle for a point in property space no definition can
express**. `resolvePropertyInstance` finds it, matching the *whole* property
vector so a near-miss never passes as an exact one.

The third row stays unpaired on purpose. `leading=icon` says what the content
*means*, never which node supplies it; guessing would produce a confident
reference to the wrong thing.

## The governing rule

> **A wrong translation must find nothing, rather than produce a confident bad
> reference.**

Under a `design-led` direction a bad reference drives the code away from the kit
it is copying — and does so while reporting a clean parity result, which is the
worst outcome available. Every unresolved seed is surfaced as unresolved.

Surfaced *with a reason*, though, because "no counterpart in the kit" is true of
every miss and actionable for almost none. `resolve` classifies each one
([`explainUnresolved`](./src/resolve.ts)):

| Reason | What it means | What to do |
| --- | --- | --- |
| `the reference already draws this` | The base variant carries every seeded value — the render duplicates the reference | Nothing. Not a gap. |
| `each of … exists, but no node carries them together` | Both values are real; the kit's matrix skips their intersection | Nothing here — the kit would have to draw the cell |
| `no counterpart for …` | These seeds have no counterpart at all | The actual lead: map the value, or accept the gap |

The third column is the point. On a real catalog this turned
`error-unselected (state=unselected, status=error)` — where `state=unselected`
resolves perfectly well on its own — into `no counterpart for status=error`,
and stopped two `size=small` renders being read as missing kit nodes when the
reference *is* the small variant.

That rule is why the matching is fussier than it first looks. A boolean axis
accepts `True` from *any* knob, so a naive matcher had `footer=true` resolving
to `Show back=True` and `supporting=on` resolving to `Leading icon=True` — both
real nodes, both the wrong component. Candidate axes must therefore share a
whole **word** with the knob or its value, matched word-for-word rather than by
substring (`Leading icon` contains the letters of `on`).

## Usage

```ts
import { KitIndexResolver, loadKitIndex } from "@design-parity/kit-index";

const resolver = new KitIndexResolver(await loadKitIndex("figma-kit-index.json"));

// A rendered cross-product cell — every seed must map to a distinct axis, and
// the exact resulting vector must name a real sibling.
resolver.resolveVariant("figma:AbCdEf/57994:2324", [
  { key: "size", raw: "l" },
  { key: "shape", raw: "square" },
]);
// → { nodeId: "57994:2310", name: "Type=Square, Size=Large, State=Enabled" }

// A property-shaped variant, paired with an instance configured that way.
resolver.resolveVariant("figma:AbCdEf/57994:2324", { key: "icon", raw: "false" });
// → { nodeId: "…", name: "State=Enabled (configured instance)" }  — or undefined

// What a reference draws whether or not the code asked for it.
resolver.defaultedContent("figma:AbCdEf/57994:2324");
// → [{ name: "Show icon", setName: "Button" }]
```

The resolver takes the index **object**, not a path: it is a committed artifact
the caller has already read — possibly from a bundle, a cache, or a test
fixture — and a resolver that read a fixed filename from the working directory
could not be used twice in one process or tested without a real kit.

## CLI

```console
$ export FIGMA_TOKEN=figd_…

$ design-parity-kit-index dump  --file AbCdEf --depth 8
31 page(s) in AbCdEf
  [1/31] Buttons (11:1833): 42 component(s), 0 hidden-variant example(s), 7 configured instance(s), deepest 6
  …

$ design-parity-kit-index build --file AbCdEf
Wrote figma-kit-index.json: 55 set(s), 1284 variant(s), 6 hidden variant render
alias(es), 43 standalone component(s), 3 specimen node(s), 38 set(s) carrying
component properties, 61 configured instance render handle(s).

$ design-parity-kit-index validate
figma-kit-index.json is a valid kit index.

$ design-parity-kit-index resolve --check   # CI: fail if the committed map drifted
design-map.json is up to date.
```

Two steps rather than one because they fail differently: `dump` is the expensive
walk of a whole file and its output is disposable; `build` is the cheap
projection worth re-running while a design map is still changing. `build`
degrades without a token — writing an index with no property vocabulary, and
saying so — and `validate` never touches the network.

## Vocabulary

The knob→axis and value→spelling tables are data, not logic, and the defaults
are tuned against Material-3-shaped kits. A kit that files its variants
differently supplies overrides, which merge per key so renaming one axis does
not mean restating the other thirty:

```ts
new KitIndexResolver(index, {
  vocabulary: { axes: { density: ["Density", "Compactness"] } },
});
```

`resolve` reads the same shape from a **`kit-vocabulary.json`** beside the index
— picked up automatically when present, or named with `--vocabulary`:

```jsonc
{
  "axes":   { "density": ["Density", "Compactness"] },
  "values": { "cosy": ["Comfortable"] }
}
```

That file exists so a catalog can learn one more of its kit's spellings without
waiting for a release of this package. Only the *tables* live there — a rule
about how values are matched at all (the multi-word slug match, the fused-axis
search) is logic, and belongs here where it can be tested.

## Files

`figma-kit-index.json` is **generated** — regenerate it, never hand-edit it. It
is validated against
[`schema/kit-index.schema.json`](./schema/kit-index.schema.json) on load,
which matters more for a generated file than a hand-authored one: nobody
proof-reads it, and a half-written index fails as a resolver that silently finds
nothing.
