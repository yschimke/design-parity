import { readFileSync } from 'node:fs';

export const FONT_INPUTS = {
  'docs/fontconfig.conf': new URL('./fontconfig.conf', import.meta.url),
  'docs/reference-fonts.mjs': new URL('./reference-fonts.mjs', import.meta.url),
  'docs/fonts/Inter-latin.woff2': new URL('./fonts/Inter-latin.woff2', import.meta.url),
  'docs/fonts/JetBrainsMono-latin.woff2': new URL('./fonts/JetBrainsMono-latin.woff2', import.meta.url),
};

// Capture-only faces: the shipping plugin's CSS and font choices are unchanged.
export function referenceFontCss() {
  const face = (family, file, maxWeight = 900) => `@font-face{font-family:"${family}";font-style:normal;font-weight:100 ${maxWeight};src:url(data:font/woff2;base64,${readFileSync(new URL(file, import.meta.url)).toString('base64')}) format('woff2');}`;
  return face('Inter', './fonts/Inter-latin.woff2') +
    face('Reference Mono', './fonts/JetBrainsMono-latin.woff2', 800) +
    `input,select,button,textarea,input::file-selector-button{font-family:Inter!important;}
     code,pre,#designmap,#issue-body,#spec-json,#ui-builder-scene,#ui-builder-snapshot{font-family:"Reference Mono"!important;}`;
}

export async function readyReferenceFonts(page) {
  await page.evaluate(async () => {
    const expected = ['Inter', 'Reference Mono'];
    const load = async () => {
      for (const family of expected) {
        for (const weight of [400, 600, 700]) {
          const faces = await document.fonts.load(`${weight} 16px "${family}"`, 'Design Parity 0123');
          if (!faces.length || faces.some(f => f.status !== 'loaded')) {
            throw new Error(`reference font unavailable: ${family}, weight ${weight}`);
          }
        }
      }
      await document.fonts.ready;
    };
    let timer;
    try {
      await Promise.race([load(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('reference font loading timed out: Inter / Reference Mono')), 10000);
      })]);
    } catch (error) {
      throw new Error(`reference font readiness failed: ${error.message}; ` +
        [...document.fonts].map(f => `${f.family} ${f.weight} ${f.style}: ${f.status}`).join('; '));
    } finally { clearTimeout(timer); }
  });
}

export async function verifyReferenceFonts(page) {
  await readyReferenceFonts(page);
  const report = {};
  // The header is visible in every view. Probe both families even in tasks whose
  // code fields are hidden. CDP reports actual painted identity, including fallback.
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'reference-font-probes';
    probe.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;background:white';
    for (const [family, id] of [['Inter', 'sans'], ['Reference Mono', 'mono']]) {
      for (const weight of [400, 600, 700]) {
        const span = document.createElement('span');
        span.id = `reference-${id}-${weight}`;
        span.style.cssText = `display:block;font-family:"${family}";font-weight:${weight}`;
        span.textContent = id === 'sans' ? 'Design Parity → × 0123' : 'Design Parity 0123';
        probe.append(span);
      }
    }
    document.body.append(probe);
  });
  try {
    // CDP reports painted glyphs. Offscreen probes can be culled after scrolling;
    // capture a frame with visible probes, then remove them before the evidence.
    await page.screenshot();
    for (const [id, expected] of [['sans', 'Inter'], ['mono', 'JetBrains Mono']]) {
      for (const weight of [400, 600, 700]) {
        const fonts = await paintedFonts(page, `#reference-${id}-${weight}`);
        if (!fonts.length || fonts.some(f => f.familyName !== expected || !f.isCustomFont || !f.glyphCount)) {
          throw new Error(`reference font identity mismatch: expected ${expected} ${weight}; painted ${JSON.stringify(fonts)}`);
        }
        report[`${expected} ${weight} normal`] = fonts;
      }
    }
  } finally { await page.$eval('#reference-font-probes', e => e.remove()); }
  const session = await page.createCDPSession();
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeIds } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body *' });
    for (const nodeId of nodeIds) {
      const { object } = await session.send('DOM.resolveNode', { nodeId });
      const { result } = await session.send('Runtime.callFunctionOn', {
        objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function() {
          return this.getClientRects().length && [...this.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) ? this.textContent.trim().slice(0, 100) : null;
        }`,
      });
      if (!result.value) continue;
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      if (fonts.some(f => !f.isCustomFont || !['Inter', 'JetBrains Mono'].includes(f.familyName))) {
        throw new Error(`reference text fallback: ${result.value}; painted ${JSON.stringify(fonts)}`);
      }
    }
  } finally { await session.detach(); }
  return report;
}

/** Read Chromium's painted fonts, rather than the requested CSS family. */
export async function paintedFonts(page, selector) {
  const session = await page.createCDPSession();
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts;
  } finally { await session.detach(); }
}
