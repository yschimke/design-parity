/**
 * rc-js-player-render.mjs — one TypeScript-player render for the `rc` lane of `rc-compare.mjs`, and
 * the loop that repeats it until the page's font faces have stopped changing.
 *
 * Split out of `rc-compare.mjs` so the loop can be tested against a font server whose responses are
 * slow, which is the condition it exists for and the one the driver itself cannot set up.
 */

/**
 * Render one `.rc` document (base64 [b64]) to a [width]×[height] canvas on [page], which must already
 * have the TypeScript player loaded. Resolves `{ dataUrl }` or `{ error }`.
 */
export function renderRcDocumentOnce(page, { b64, width, height, theme }) {
  return page.evaluate(
    async ({ b64, w, h, theme }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      document.body.appendChild(canvas);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        const player = new window.RcdPlayer(canvas);
        player.setTheme(theme);
        await player.loadFromArrayBuffer(bytes.buffer);
        await new Promise((r) => setTimeout(r, 250));
        // The first paint is what *discovers* which named font families the document asks for —
        // resolution happens mid-paint, per TYPEFACE op — so the wait has to come after it. A
        // single-shot render has no later frame in which a face could appear, so without this the
        // branded text would screenshot in the fallback typeface.
        player.repaint();
        await player.fontsReady();
        player.repaint();
        return { dataUrl: canvas.toDataURL("image/png") };
      } catch (e) {
        return { error: String((e && e.stack) || e) };
      } finally {
        canvas.remove();
      }
    },
    { b64, w: width, h: height, theme },
  );
}

/**
 * The page's font faces, as `<declared>:<loaded>`, read only once no face is still loading.
 *
 * Waiting is the point. A paint can *start* a face load that `player.fontsReady()` does not cover:
 * the player awaits the variant it asked `document.fonts.load()` for, but the frame after it can
 * select a different face of the same family — a ranged axis face declared by a stylesheet that
 * arrived later — and Chromium begins fetching that one mid-paint while drawing the fallback. A count
 * taken at that moment sees the face as not loaded both before and after the render, reads "nothing
 * changed", and keeps a render drawn in the fallback face. `document.fonts.ready` settles once every
 * load in flight has finished (or failed), so the count compares settled states.
 */
export function settledFontState(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    let loaded = 0;
    document.fonts.forEach((face) => {
      if (face.status === "loaded") loaded++;
    });
    return `${document.fonts.size}:${loaded}`;
  });
}

/**
 * Call [renderOnce] until a render leaves the page's font faces as it found them, at most
 * [maxAttempts] times, and return the last result.
 *
 * A render that made the page load font faces it did not have is rendered again. The first render
 * that needs a downloadable face measures its text before that face arrives (#4177's second defect,
 * still reproducible on CI for the variable-axis specimens), so it scores differently from the same
 * document rendered on a page that already has the face. Which document that hits used to depend on
 * catalog order; with several workers it would also depend on how the catalog is split. Re-rendering
 * until the page's faces stop changing scores every document against the faces it asked for — the
 * result a later document always got — whatever ran before it on this page.
 *
 * The comparison is between *settled* states ([settledFontState]). Counting faces while one is still
 * downloading let a render through in the fallback face whenever the font server was slow, which is
 * how `typeface_variable_weight` came back different between two runs of the same catalog.
 *
 * [beforeAttempt] runs before each render (the driver clears the page's warnings there).
 */
export async function renderUntilFontsSettle(
  page,
  renderOnce,
  { maxAttempts = 3, beforeAttempt = () => {} } = {},
) {
  let result;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    beforeAttempt(attempt);
    const before = await settledFontState(page);
    result = await renderOnce();
    if ((await settledFontState(page)) === before) break;
  }
  return result;
}
