import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { readyReferenceFonts } from './reference-font-readiness.mjs';

const available = existsSync(chromium.executablePath());
test('reference font readiness rejects failed faces even though fonts.ready resolves', { skip: available ? false : 'no Playwright Chromium installed' }, async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>@font-face{font-family:Broken;src:url(data:font/woff2;base64,AAAA)}p{font-family:Broken,sans-serif}</style><p>Reference</p>`);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => [...document.fonts][0].status), 'error');
    await assert.rejects(readyReferenceFonts(page), /reference font readiness failed.*Broken normal normal: error/);
  } finally { await browser.close(); }
});

test('reference capture awaits delayed and initially unused faces, with bounded diagnostics', { skip: available ? false : 'no Playwright Chromium installed' }, async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const bytes = readFileSync(new URL('../figma-plugin/docs/fonts/Inter-latin.woff2', import.meta.url));
    let release, requested;
    const gate = new Promise(resolve => { release = resolve; });
    const request = new Promise(resolve => { requested = resolve; });
    await page.route('https://fonts.test/inter.woff2', async route => {
      requested(); await gate;
      await route.fulfill({ body: bytes, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
    });
    await page.setContent(`<style>@font-face{font-family:Inter;src:url(https://fonts.test/inter.woff2);font-weight:100 900}</style><p>No Inter yet</p>`);
    assert.equal(await page.evaluate(() => [...document.fonts][0].status), 'unloaded');
    let finished = false;
    const ready = readyReferenceFonts(page).then(value => { finished = true; return value; });
    await request;
    assert.equal(finished, false, 'must await the font response');
    await assert.rejects(readyReferenceFonts(page, 25), /timed out.*Inter 100 900 normal: loading/);
    release();
    assert.deepEqual(await ready, ['Inter 100 900 normal: loaded']);
    await page.locator('p').evaluate(e => { e.style.fontFamily = 'Inter'; });
    // The identity query reports painted frames; capture after revealing the face.
    await page.screenshot();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'p' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.length > 0 && fonts.every(f => f.familyName === 'Inter' && f.isCustomFont && f.glyphCount > 0), JSON.stringify(fonts));
  } finally { await browser.close(); }
});
