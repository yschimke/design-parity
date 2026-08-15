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

## Files

`figma-kit-index.json` is **generated** — regenerate it, never hand-edit it. It
is validated against
[`schema/kit-index.schema.json`](./schema/kit-index.schema.json) on load,
which matters more for a generated file than a hand-authored one: nobody
proof-reads it, and a half-written index fails as a resolver that silently finds
nothing.
