import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { chromium } from 'playwright';
import { referenceFontCss, readyReferenceFonts, paintedFonts, verifyReferenceFonts } from './reference-fonts.mjs';

test('reference text paints the pinned Inter face at every UI weight', async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const html = readFileSync(new URL('../figma/ui.html', import.meta.url), 'utf8');
    await page.setContent(html.replace('<style>', `<style>${referenceFontCss()}`));
    await verifyReferenceFonts(page);
    for (const [selector, weight] of [['h1', '700'], ['label[for=catalog]', '600'], ['#view-add .hint', '400']]) {
      assert.equal(await page.$eval(selector, e => getComputedStyle(e).fontWeight), weight);
      const fonts = await paintedFonts(page, selector);
      assert.ok(fonts.some(f => f.glyphCount > 0), `${selector} must paint text`);
      assert.ok(fonts.every(f => f.familyName === 'Inter' && f.isCustomFont), JSON.stringify(fonts));
    }
  } finally { await browser.close(); }
});

test('capture fails with actionable diagnostics for missing and corrupt fonts', async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<p style="font-family:Inter">Design Parity</p>');
    // document.fonts.ready succeeds with an empty font set: it cannot guard this.
    await page.evaluate(() => document.fonts.ready);
    await assert.rejects(readyReferenceFonts(page), /reference font unavailable: Inter, weight 400/);
    await page.setContent(`<style>${referenceFontCss().replace(/base64,[^)]+/g, 'base64,AAAA')}</style><p>Text</p>`);
    await assert.rejects(readyReferenceFonts(page), /reference font readiness failed:.*Inter.*error/s);
  } finally { await browser.close(); }
});
