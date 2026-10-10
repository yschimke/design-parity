import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { publishUidCatalog } from './publish-uid-catalog.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'uid-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'references'));
  await mkdir(join(root, 'previews'));
  const png = PNG.sync.write(new PNG({ width: 2, height: 3 }));
  await writeFile(join(root, 'previews/capture.png'), png);
  await writeFile(join(root, 'references/reference.png'), png);
  await writeFile(join(root, 'references/design.uid'), '{"id":"screen"}');
  const revision = 'a'.repeat(40);
  const reference = { id: 'capture', previewId: 'capture', source: { provider: 'ui-builder', revision },
    raster: { path: 'references/reference.png', width: 2, height: 3 }, artifact: { kind: 'uid', path: 'references/design.uid' } };
  await writeFile(join(root, 'references/index.json'), JSON.stringify({ schema: 'compose-preview-references/v1', references: [reference] }));
  const plan = { repository: 'example/app', publication: { system: 'app-uid', title: 'App design', sourceModule: 'pilot',
    components: [{ designId: 'screen', componentId: 'Screen', sourceFile: 'src/Screen.kt' }] },
    captures: [{ previewId: 'capture', designId: 'screen', widthDp: 2, heightDp: 3, density: 1, theme: 'light', state: 'list' }] };
  return { root, out: join(root, 'out'), plan, revision };
}

test('canonical catalog IDs bind UID references and preserve source navigation and bytes', async t => {
  const args = await fixture(t);
  const result = await publishUidCatalog(args);
  assert.equal(result.references, 1);
  const catalog = JSON.parse(await readFile(join(args.out, 'catalog.json')));
  const references = JSON.parse(await readFile(join(args.out, 'references/index.json')));
  const component = catalog.components[0];
  assert.equal(component.sourceFile, 'src/Screen.kt');
  assert.equal(component.sourceDirectory, 'pilot');
  assert.deepEqual(catalog.source, { repo: 'example/app', ref: args.revision, module: 'pilot' });
  assert.equal(references.references[0].previewId, result.previews[0]);
  assert.equal(result.previews[0], 'screen__ideal__list__light__2dp');
  for (const path of ['references/design.uid', 'references/reference.png'])
    assert.deepEqual(await readFile(join(args.root, path)), await readFile(join(args.out, path)));
});

test('rejects references from another source revision', async t => {
  const args = await fixture(t);
  await assert.rejects(publishUidCatalog({ ...args, revision: 'b'.repeat(40) }), /published source revision/);
});

test('rejects missing reference binding and duplicate capture axes', async t => {
  const args = await fixture(t);
  args.plan.captures[0].previewId = 'missing';
  await assert.rejects(publishUidCatalog(args), /Missing component or reference/);
  args.plan.captures[0].previewId = 'capture';
  args.plan.publication.components.push({ ...args.plan.publication.components[0] });
  await assert.rejects(publishUidCatalog(args), /unique components/);
});
