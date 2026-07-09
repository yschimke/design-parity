/**
 * The **catalog registry** — the named catalogs a designer picks from instead of
 * pasting a raw URL.
 *
 * A {@link CatalogSource} is a label + the raw root of a published
 * `design-artifacts/<system>` branch (the folder holding `catalog.json`). Three
 * are built in (Compose / RemoteCompose / Wear Material 3); a designer can
 * **register** their own, and the whole set — plus the last-picked id — persists
 * across sessions in `figma.clientStorage` (the main thread owns the I/O; this
 * module owns the pure merge/add/remove/select logic so it's unit-testable).
 *
 * Only the *custom* entries and the last selection are persisted
 * ({@link dehydrateRegistry}); the built-ins are re-seeded from code on load
 * ({@link hydrateRegistry}) so their URLs stay current even for a returning user.
 * Pure: no `figma`, no `fetch`.
 */

/** One selectable catalog: a stable id, a human label, and its raw base URL. */
export interface CatalogSource {
  /** Stable id (a slug); the dropdown's option value and the persisted key. */
  id: string;
  /** Human label shown in the dropdown, e.g. `"Compose Material 3"`. */
  label: string;
  /** Raw root containing `catalog.json` (no trailing slash, no `/catalog.json`). */
  baseUrl: string;
  /** Built-in catalogs are code-seeded and can't be removed. Absent ⇒ custom. */
  builtin?: boolean;
}

const ARTIFACTS_ROOT =
  "https://raw.githubusercontent.com/yschimke/compose-ai-tools/refs/heads/design-artifacts";

/**
 * The catalogs seeded for every user, in display order: Compose M3, RemoteCompose
 * M3, Wear M3 — each a published `design-artifacts/<system>` branch on the
 * `raw.githubusercontent.com` host the plugin manifest already allows.
 */
export const DEFAULT_CATALOGS: readonly CatalogSource[] = [
  { id: "compose-m3", label: "Compose Material 3", baseUrl: `${ARTIFACTS_ROOT}/compose-m3`, builtin: true },
  { id: "remote-m3", label: "RemoteCompose Material 3", baseUrl: `${ARTIFACTS_ROOT}/remote-m3`, builtin: true },
  { id: "wear-m3", label: "Wear Material 3", baseUrl: `${ARTIFACTS_ROOT}/wear-m3`, builtin: true },
];

/** The live registry the UI renders: the full catalog list + the remembered pick. */
export interface CatalogRegistry {
  catalogs: CatalogSource[];
  /** The id of the last-selected catalog (remembered across sessions). */
  lastSelectedId?: string;
}

/** The persisted slice: only custom entries + the last pick (built-ins re-seed). */
export interface StoredRegistry {
  custom: CatalogSource[];
  lastSelectedId?: string;
}

/** Fields a designer supplies to register a catalog. */
export interface RegisterInput {
  label: string;
  baseUrl: string;
}

/** Trim a base URL to the raw root: drop trailing slashes and an accidental `/catalog.json`. */
export function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/catalog\.json$/i, "")
    .replace(/\/+$/, "");
}

/** A URL-safe slug for a catalog id derived from its label. */
function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "catalog"
  );
}

/** A slug not already taken by an existing catalog (append `-2`, `-3`, … on collision). */
function uniqueId(base: string, existing: CatalogSource[]): string {
  const taken = new Set(existing.map((c) => c.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Whether a persisted value is a usable {@link CatalogSource} (guards old / corrupt storage). */
function isValidSource(value: unknown): value is CatalogSource {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.id.length > 0 &&
    typeof c.label === "string" &&
    c.label.length > 0 &&
    typeof c.baseUrl === "string" &&
    /^https?:\/\//i.test(c.baseUrl)
  );
}

/**
 * Build the live {@link CatalogRegistry} from persisted storage: the current
 * built-ins first, then each still-valid custom entry that doesn't collide with a
 * built-in (by id or normalized URL). The remembered selection is honoured when
 * it still resolves, else it falls back to the first catalog.
 */
export function hydrateRegistry(stored?: StoredRegistry): CatalogRegistry {
  const catalogs: CatalogSource[] = DEFAULT_CATALOGS.map((c) => ({ ...c }));
  for (const raw of stored?.custom ?? []) {
    if (!isValidSource(raw)) continue;
    const custom: CatalogSource = { id: raw.id, label: raw.label, baseUrl: normalizeBaseUrl(raw.baseUrl), builtin: false };
    const clashes = catalogs.some(
      (c) => c.id === custom.id || normalizeBaseUrl(c.baseUrl) === custom.baseUrl,
    );
    if (!clashes) catalogs.push(custom);
  }
  const remembered = catalogs.find((c) => c.id === stored?.lastSelectedId);
  const registry: CatalogRegistry = { catalogs };
  const lastSelectedId = remembered?.id ?? catalogs[0]?.id;
  if (lastSelectedId) registry.lastSelectedId = lastSelectedId;
  return registry;
}

/** Extract the persisted slice (custom entries + last pick) from a live registry. */
export function dehydrateRegistry(registry: CatalogRegistry): StoredRegistry {
  const custom = registry.catalogs
    .filter((c) => !c.builtin)
    .map(({ id, label, baseUrl }) => ({ id, label, baseUrl }));
  const stored: StoredRegistry = { custom };
  if (registry.lastSelectedId) stored.lastSelectedId = registry.lastSelectedId;
  return stored;
}

/**
 * Register a catalog: validate the label + URL, then add it and select it. A URL
 * that matches an existing catalog isn't duplicated — that catalog is selected
 * instead. Throws on an empty label or a non-http(s) URL.
 */
export function registerCatalog(registry: CatalogRegistry, input: RegisterInput): CatalogRegistry {
  const label = input.label.trim();
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!label) throw new Error("Enter a name for the catalog.");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("Enter a valid http(s) catalog URL.");

  const existing = registry.catalogs.find((c) => normalizeBaseUrl(c.baseUrl) === baseUrl);
  if (existing) return { ...registry, lastSelectedId: existing.id };

  const catalog: CatalogSource = { id: uniqueId(slugify(label), registry.catalogs), label, baseUrl, builtin: false };
  return { catalogs: [...registry.catalogs, catalog], lastSelectedId: catalog.id };
}

/**
 * Remove a **custom** catalog by id (built-ins are kept). When the removed
 * catalog was selected, the selection falls back to the first remaining one.
 */
export function removeCatalog(registry: CatalogRegistry, id: string): CatalogRegistry {
  const target = registry.catalogs.find((c) => c.id === id);
  if (!target || target.builtin) return registry;
  const catalogs = registry.catalogs.filter((c) => c.id !== id);
  const registryOut: CatalogRegistry = { catalogs };
  const lastSelectedId = registry.lastSelectedId === id ? catalogs[0]?.id : registry.lastSelectedId;
  if (lastSelectedId) registryOut.lastSelectedId = lastSelectedId;
  return registryOut;
}

/** Set the remembered selection to `id` (no-op when the id is unknown). */
export function selectCatalog(registry: CatalogRegistry, id: string): CatalogRegistry {
  if (!registry.catalogs.some((c) => c.id === id)) return registry;
  return { ...registry, lastSelectedId: id };
}

/** The catalog with `id`, or `undefined`. */
export function findCatalog(registry: CatalogRegistry, id: string | undefined): CatalogSource | undefined {
  return registry.catalogs.find((c) => c.id === id);
}

/** The currently selected catalog, or `undefined` when nothing resolves. */
export function selectedCatalog(registry: CatalogRegistry): CatalogSource | undefined {
  return findCatalog(registry, registry.lastSelectedId);
}
