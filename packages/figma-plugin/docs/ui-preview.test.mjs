import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { chromium } from 'playwright';

/** Decode an 8-bit RGB/RGBA, non-interlaced PNG (what Chromium writes) to RGBA rows. */
function decodePng(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), channels = bytes[25] === 6 ? 4 : 3;
  const idat = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
    for (let x = 0; x < width; x++) {
      line.copy(out, (y * width + x) * 4, x * channels, x * channels + channels);
      if (channels === 3) out[(y * width + x) * 4 + 3] = 255;
    }
    previous = line;
  }
  return { width, height, data: out };
}

/** Where two captures differ: size, changed-pixel count and their bounding box, in device pixels. */
function describeDrift(actualBytes, expectedBytes) {
  const actual = decodePng(actualBytes), expected = decodePng(expectedBytes);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return `size ${actual.width}x${actual.height}, committed ${expected.width}x${expected.height}`;
  }
  let changed = 0, left = Infinity, top = Infinity, right = -1, bottom = -1, maxDelta = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    let delta = 0;
    for (let k = 0; k < 4; k++) delta = Math.max(delta, Math.abs(actual.data[i + k] - expected.data[i + k]));
    if (!delta) continue;
    const x = (i / 4) % actual.width, y = Math.floor(i / 4 / actual.width);
    changed++; maxDelta = Math.max(maxDelta, delta);
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return changed ? `${changed} px differ (max channel delta ${maxDelta}) within x ${left}..${right}, y ${top}..${bottom}` : 'same pixels, different PNG bytes';
}

// Run after build:plugin, in the browser CI job. No fonts or network are fetched.
test('all five captures match committed bytes with different host font sets', () => {
  const root = process.env.UI_PREVIEW_TEST_OUT || mkdtempSync(join(tmpdir(), 'ui-font-determinism-'));
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(join(root, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/conf.d</include><dir>/usr/share/fonts/truetype/dejavu</dir><cachedir>${root}/cache</cachedir></fontconfig>`);
    const fontSet = env => spawnSync('fc-list', [], { env: { ...process.env, ...env }, encoding: 'utf8' });
    const hostFonts = fontSet({});
    const limitedFonts = fontSet({ FONTCONFIG_FILE: join(root, 'fonts.conf') });
    assert.equal(hostFonts.status, 0);
    assert.equal(limitedFonts.status, 0);
    assert.notEqual(hostFonts.stdout, limitedFonts.stdout, 'guard: font sets must actually differ');
    assert.ok(limitedFonts.stdout.includes('DejaVu'), 'guard: alternate font set must exist');
    // Every profile and capture is checked before failing, and each drift says where it is: a lone
    // first mismatch hid whether the other four captures, or the other launches, moved too.
    const drift = [];
    for (const profile of ['host', 'dejavu-only', 'dejavu-repeat']) {
      const output = join(root, profile);
      mkdirSync(output, { recursive: true });
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ui-preview.mjs', import.meta.url))], {
        env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath(), UI_PREVIEW_OUT: output,
          ...(profile === 'host' ? {} : { FONTCONFIG_FILE: join(root, 'fonts.conf') }) },
        encoding: 'utf8', timeout: 60000,
      });
      assert.equal(result.status, 0, `${profile}: ${result.stdout}\n${result.stderr}`);
      for (const task of ['add', 'library', 'customize', 'handoff', 'uibuilder']) {
        const name = `ui-task-${task}.png`;
        const actual = readFileSync(join(output, name)), expected = readFileSync(new URL(name, import.meta.url));
        const sha = bytes => createHash('sha256').update(bytes).digest('hex');
        if (sha(actual) !== sha(expected)) {
          drift.push(`${profile}: ${name} drifted (sha256 ${sha(actual).slice(0, 12)}, committed ${sha(expected).slice(0, 12)}): ${describeDrift(actual, expected)}`);
        }
      }
    }
    assert.deepEqual(drift, [], `captures differ from the committed evidence (kept under ${root} when UI_PREVIEW_TEST_OUT is set):\n${drift.join('\n')}`);
  } finally { if (!process.env.UI_PREVIEW_TEST_OUT) rmSync(root, { recursive: true, force: true }); }
});
