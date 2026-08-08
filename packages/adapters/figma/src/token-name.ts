/**
 * Figma name → token key, shared by the two readers that need the same answer.
 *
 * `normalize.ts` keys the file's published type ramp by it; `layout.ts` keys a
 * text node's annotation by it, so a reference annotation says `body/large`
 * where the design applied that published style. Both must produce the same key
 * for the same style name or the ramp and the per-node reading disagree about
 * what the design calls its own type — which is the whole point of quoting it.
 */

/**
 * Normalize a full token path, keeping its `/` segments (so the diff's Material
 * role lookup can read `radius/medium` → `medium`, `Body/Large` → `bodyLarge`):
 * trim + lowercase each segment, collapse inner whitespace to `-`.
 */
export function tokenPath(name: string): string {
  return name
    .split("/")
    .map((s) => s.trim().replace(/\s+/g, "-").toLowerCase())
    .filter(Boolean)
    .join("/");
}
