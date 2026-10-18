import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright';

// Run after build:plugin, in the browser CI job. No fonts or network are fetched.
test('all five captures match committed bytes with different host font sets', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-font-determinism-'));
  try {
    writeFileSync(join(root, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/conf.d</include><dir>/usr/share/fonts/truetype/dejavu</dir><cachedir>${root}/cache</cachedir></fontconfig>`);
    const fontSet = env => spawnSync('fc-list', [], { env: { ...process.env, ...env }, encoding: 'utf8' });
    const hostFonts = fontSet({});
    const limitedFonts = fontSet({ FONTCONFIG_FILE: join(root, 'fonts.conf') });
    assert.equal(hostFonts.status, 0);
    assert.equal(limitedFonts.status, 0);
    assert.notEqual(hostFonts.stdout, limitedFonts.stdout, 'guard: font sets must actually differ');
    assert.ok(limitedFonts.stdout.includes('DejaVu'), 'guard: alternate font set must exist');
    for (const profile of ['host', 'dejavu-only', 'dejavu-repeat']) {
      const output = join(root, profile);
      mkdirSync(output);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ui-preview.mjs', import.meta.url))], {
        env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath(), UI_PREVIEW_OUT: output,
          ...(profile === 'host' ? {} : { FONTCONFIG_FILE: join(root, 'fonts.conf') }) },
        encoding: 'utf8', timeout: 60000,
      });
      assert.equal(result.status, 0, `${profile}: ${result.stdout}\n${result.stderr}`);
      for (const task of ['add', 'library', 'customize', 'handoff', 'uibuilder']) {
        const name = `ui-task-${task}.png`;
        assert.equal(createHash("sha256").update(readFileSync(join(output, name))).digest("hex"), createHash("sha256").update(readFileSync(new URL(name, import.meta.url))).digest("hex"), `${profile}: ${name} drifted`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
