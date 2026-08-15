# Key design pages as backdrops

> **Opt-in, off by default.** Nothing in this guide happens until a repo commits
> a `design-pages.json` with `"enabled": true` and someone runs the
> `design-parity-pages` CLI by hand. The feature is not wired into
> `@design-parity/action`, so adopting it changes nothing about what the PR bot
> does. Implemented by
> [`@design-parity/page-backdrop`](../packages/page-backdrop/README.md).

Per-component parity answers *"does this Button match its Figma node?"*. That is
the right question once you know which components exist and where they are used.
It is the wrong question when you are looking at a **screen** and want to know
what is actually implemented.

A page backdrop imports one key screen as a flat background image, finds every
component instance on it, and links each one back to the code component that
implements it. What you get is a map of the screen: green where Code Connect
binds a design component to code, blue where the repo's `design-map.json` does,
amber where only a name matched, and a dashed red outline where **nothing** does.

![Hotspots over an imported Figma page](./images/page-backdrop/hotspots.png)

The dashed rectangle on the album art is the whole point: that part of the
design has no code component behind it. On a real screen those gaps are what a
design review is looking for, and they are invisible in a per-component run
because a component that doesn't exist has nothing to diff.

## The manifest is the surface, the HTML is the fallback

`pages.json` is a versioned wire contract — see
[page-backdrop-contract.md](./page-backdrop-contract.md). The self-contained HTML
viewer below is the *fallback*: offline, artifact-friendly, needs no server.

A consumer with a renderer behind it can do better. Given a placement's
`previewId` and `bounds`, a preview server can render the component **live at the
placement's exact dimensions** rather than scaling a fixed-size screenshot to fit
— a materially stronger comparison, and one the producer can't make because it
has no renderer and must not grow one.

## Showing the code on top

Toggle the overlay and each placement's own render is laid over the design in
place:

![Renders overlaid on the design](./images/page-backdrop/overlay.png)

A render is pinned to its placement's top-left corner and scaled to the
placement's **width**, keeping its own aspect ratio. It deliberately does not
stretch to fill the box — a component that renders taller than its slot is a
real finding, and stretching would hide it. Set the blend to `difference` and
matching pixels go black, so only the drift is lit:

![The difference blend](./images/page-backdrop/difference.png)

Three true things are visible in those shots: the play button renders taller
than its design slot; the Up-next card sits a few pixels low; and one code
component (`FilterChip`) legitimately backs three chip instances, so its single
render appears three times.

The renders come from **the caller** — this package never renders anything. Pass
them in with `--render CODE=path.png`, from `compose-preview`, a committed
baseline, or anywhere else. Placements with no render simply have no overlay.

## The flow

Three deliberate steps, only the first of which touches a design tool:

1. **import** — fetch the key pages, walk each one for component instances,
   resolve every instance to a code handle, write `pages.json` + one PNG per
   page. A human-invoked "refresh the backdrops" commit, not a per-push check.
2. **view** — build one self-contained HTML page from the committed manifest.
3. everything downstream reads the manifest; **no live Figma call at review
   time.**

```bash
design-parity-pages list --file <fileKey>      # what pages exist? (no config needed)
design-parity-pages status                     # is it on for this repo?
design-parity-pages import --code-connect figma.connect.json --design-map design-map.json
design-parity-pages view --render ui/Player.kt#PlayButton=build/previews/PlayButton.png
```

## Which pages?

Explicit ones. `pages` in the config is a hand-written list of frame node ids in
priority order — nothing is auto-discovered. "Key pages" is a judgement about
what matters in a product, and it belongs in a reviewed commit rather than in a
heuristic that silently starts importing forty frames when a designer
reorganises a file.

Hand-written is not the same as hand-*discovered*, though: the ids have to come
from somewhere, and hunting them out of a browser URL one page at a time is how
a config ends up with two pages in it. `design-parity-pages list --file <key>`
prints every page in the file as a markdown table — id, name, and a deep link —
in one request, and is deliberately the one subcommand that runs *before* the
opt-in config exists, since it is what you use to write one.

## How linking works

The same precedence as the per-component resolver, applied per instance: **Code
Connect → `design-map.json` → name convention → unlinked**, with the one
page-specific wrinkle that a page holds *instances* while links attach to
*components*. Each placement is therefore tried against the component set, then
the main component, then the instance itself. Full detail in the
[package README](../packages/page-backdrop/README.md#how-placements-are-linked).

## Trying it

`fixtures/page-backdrop/` holds a real import of the screen above plus the three
renders that go over it, so the viewer can be built with no Figma credentials
and no renderer. It is exercised by CI on every run, so these screenshots stay
honest.
