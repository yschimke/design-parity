/**
 * Load a catalog from a **local directory** — no server, no network.
 *
 * A Figma plugin UI can read a folder the designer picks (`<input webkitdirectory>`):
 * the iframe gets the files and can turn each into an object (`blob:`) URL. This
 * module is the pure glue that lets the *existing* fetch-based insert flow run
 * against those local files unchanged: rewrite every manifest asset path to its
 * `blob:` URL, and — since {@link resolveImageUrl} passes `blob:` through — the
 * planner, picker, and inserts fetch the local bytes exactly as they would a
 * remote render. So browsing + inserting a published catalog needs no server at
 * all; a server is only for the Override editor's live customization.
 *
 * Pure: no `figma`, no `fetch`, no DOM. The UI supplies `urlFor` (a path → object
 * URL lookup over the picked `FileList`).
 */
import type { CatalogManifest } from "@design-parity/catalog-export";

/**
 * Strip the leading directory segment from a `webkitRelativePath`
 * (`compose-m3/images/x.png` → `images/x.png`), so a file keys on its
 * **bundle-relative** path — the same path the manifest uses. Paths with no
 * separator are returned as-is.
 */
export function stripLocalRoot(relativePath: string): string {
  const slash = relativePath.indexOf("/");
  return slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
}

/**
 * Rewrite every asset reference in a manifest — each image `path` and each
 * component `wireframe` — to the URL `urlFor` returns for its bundle-relative
 * path (typically a `blob:` object URL for a local file). A path with no local
 * file is left unchanged. Everything else on the manifest is copied through, so
 * the result is a normal {@link CatalogManifest} the planner/picker consume as-is.
 */
export function rewriteManifestAssets(
  manifest: CatalogManifest,
  urlFor: (path: string) => string | undefined,
): CatalogManifest {
  const components = manifest.components.map((component) => {
    const images = component.images.map((image) => {
      const url = urlFor(image.path);
      return url ? { ...image, path: url } : image;
    });
    const out = { ...component, images };
    if (component.wireframe) {
      const wireframe = urlFor(component.wireframe);
      if (wireframe) out.wireframe = wireframe;
    }
    return out;
  });
  return { ...manifest, components };
}
