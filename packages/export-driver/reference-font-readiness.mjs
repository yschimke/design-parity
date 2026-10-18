/** Force declared webfonts to load, including faces used only by late content.
 * FontFaceSet.ready also resolves when a face failed; it is not a success check.
 * System-font-only documents retain their existing fontconfig behavior.
 */
export async function readyReferenceFonts(page, timeoutMs = 10000) {
  return page.evaluate(async (timeoutMs) => {
    let timer;
    const describe = f => `${f.family} ${f.weight} ${f.style}: ${f.status}`;
    try {
      return await Promise.race([
        (async () => {
          await Promise.all([...document.fonts].map(f => f.load()));
          await document.fonts.ready;
          const faces = [...document.fonts];
          const failed = faces.filter(f => f.status !== 'loaded');
          if (failed.length) throw new Error(failed.map(describe).join('; '));
          return faces.map(describe);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), timeoutMs); }),
      ]);
    } catch (error) {
      throw new Error(`reference font readiness failed (${error.message}): ` +
        [...document.fonts].map(describe).join('; '));
    } finally { clearTimeout(timer); }
  }, timeoutMs);
}
