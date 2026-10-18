These OFL-licensed assets are for offline evidence capture only. The shipping
plugin and app typography are unchanged. The Latin subsets cover the committed
English fixtures; adding another script requires its pinned subset too.

- `Inter-latin.woff2`: Google Fonts `ofl/inter/Inter[opsz,wght].ttf` at
  commit `0b58fb370093f9a9f4ff785d94405710b79de67c`. Generated with fonttools
  4.65.0 + brotli 1.2.0: subset U+0000–024F and U+2000–25FF first,
  instantiate `opsz=14`, retain variable weight 100–900, then save
  with `flavor="woff2"`.
  Includes arrows and symbols omitted from the fontsource Latin subset.
- `JetBrainsMono-latin.woff2`: `@fontsource-variable/jetbrains-mono@5.2.8`,
  `files/jetbrains-mono-latin-wght-normal.woff2` (variable weight 100–800).

License texts are kept alongside the fonts. The evidence input manifest hashes
the font bytes and capture helper, so replacing a face requires regeneration.
