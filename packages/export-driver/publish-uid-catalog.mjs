#!/usr/bin/env node
// Adapt validated UID parity evidence to the canonical catalog writer and sticker identity.
import { mkdir, readFile, realpath, copyFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { writeCatalog, stickerId } from '@design-parity/catalog-export';
import { applySourceFiles } from './apply-source-files.mjs';

export async function publishUidCatalog({ plan, root, out, revision }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full source revision is required');
  const publication = plan.publication;
  if (!publication || !/^[a-z0-9][a-z0-9-]*$/.test(publication.system)) throw new Error('Plan requires publication.system');
  if (!/^[\w.-]+\/[\w.-]+$/.test(plan.repository)) throw new Error('Plan requires a repository');
  const base = await realpath(root);
  async function asset(relative) {
    const file = await realpath(resolve(base, relative));
    if (!file.startsWith(base + sep)) throw new Error('Asset escapes evidence directory');
    return file;
  }
  const manifest = JSON.parse(await readFile(await asset('references/index.json'), 'utf8'));
  const refs = new Map(manifest.references.map(ref => [ref.previewId, ref]));
  if (refs.size !== plan.captures.length || refs.size !== manifest.references.length) throw new Error('Capture/reference IDs must match');
  const components = publication.components.map(c => ({ ...c, section: 'Screens', variants: { ideal: [], layout: [] }, greenlines: [], redlines: [] }));
  const byDesign = new Map(components.map(c => [c.designId, c]));
  if (!components.length || byDesign.size !== components.length) throw new Error('Publication requires unique components');
  const byPreview = new Map();
  const routes = new Set();
  for (const capture of plan.captures) {
    const component = byDesign.get(capture.designId);
    const reference = refs.get(capture.previewId);
    if (!component || !reference) throw new Error('Missing component or reference for capture');
    if (reference.source?.provider !== 'ui-builder' || reference.artifact?.kind !== 'uid' || reference.source.revision !== revision)
      throw new Error('Reference must be a UID from the published source revision');
    const image = { uri: await asset(`previews/${capture.previewId}.png`), previewId: capture.previewId,
      width: capture.widthDp * capture.density, height: capture.heightDp * capture.density,
      state: capture.state, theme: capture.theme, size: `${capture.widthDp}dp` };
    const route = stickerId(component.componentId, 'ideal', image);
    if (!route || routes.has(route)) throw new Error('Duplicate catalog capture axes');
    routes.add(route);
    component.variants.ideal.push(image);
    byPreview.set(capture.previewId, route);
  }
  await mkdir(out, { recursive: true });
  await writeCatalog({ meta: { system: publication.system, title: publication.title }, components }, out,
    { figmaVariables: false, knownDifferences: false });
  const catalogPath = resolve(out, 'catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  applySourceFiles(catalog, { groups: [{ components: publication.components.map(c => ({ ...c, preview: c.designId })) }] },
    new Map(publication.components.map(c => [c.designId, { sourceFile: c.sourceFile, module: publication.sourceModule, directory: publication.sourceModule }])));
  catalog.source = { repo: plan.repository, ref: revision, module: publication.sourceModule };
  catalog.generatedAt = new Date().toISOString();
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  for (const reference of manifest.references) {
    reference.previewId = byPreview.get(reference.previewId);
    for (const relative of [reference.raster.path, reference.artifact.path]) {
      // Preserve the content-addressed UID and PNG bytes; the server verifies their hashes.
      const source = await asset(relative);
      const target = resolve(out, relative);
      if (!target.startsWith(resolve(out) + sep)) throw new Error('Asset escapes catalog directory');
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }
  await writeFile(resolve(out, 'references/index.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { system: publication.system, previews: [...routes], references: manifest.references.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['plan', 'root', 'out', 'revision'].map(k => [k, { type: 'string' }])) });
  const plan = JSON.parse(await readFile(values.plan, 'utf8'));
  console.log(JSON.stringify(await publishUidCatalog({ ...values, plan }), null, 2));
}
