# Changelog

## [0.1.12](https://github.com/yschimke/design-parity/compare/v0.1.11...v0.1.12) (2026-06-18)


### Features

* **action:** version verdict.json with formatVersion + published schema ([9867a5b](https://github.com/yschimke/design-parity/commit/9867a5b0980f36f2aaa3990424a7f19bebdeb68e))
* **action:** version verdict.json with formatVersion + published schema ([04654f1](https://github.com/yschimke/design-parity/commit/04654f13726c5cf5e8c6ff85298d49f3ce8bb1fb)), closes [#71](https://github.com/yschimke/design-parity/issues/71)
* **candidate:** prefer the emulator-free CMP Desktop/JVM render path ([deb9e10](https://github.com/yschimke/design-parity/commit/deb9e10f7f939f8146fef6259751c0efadd0128a))
* **candidate:** prefer the emulator-free CMP Desktop/JVM render path ([50253f7](https://github.com/yschimke/design-parity/commit/50253f78ca529d8c3efac6ea7dedf090c10409de))
* **design-map:** let previewId carry themed variants like ref ([3b18202](https://github.com/yschimke/design-parity/commit/3b18202518883ea8f0b453e06d96a5a70cf84667))
* **design-map:** let previewId carry themed variants like ref ([9c38ddc](https://github.com/yschimke/design-parity/commit/9c38ddcb132ac49b0dfbace5c01db2bfa78daa49)), closes [#111](https://github.com/yschimke/design-parity/issues/111)
* **diff,figma:** extend design-system audit to typography + numeric tokens ([6d86823](https://github.com/yschimke/design-parity/commit/6d86823b8b6bcb0b839287a54c2f92133d068903))
* **diff,figma:** extend design-system audit to typography + numeric tokens ([b43f295](https://github.com/yschimke/design-parity/commit/b43f295250ce0cb83f9d6d8e2a2b4a1e0a81c486)), closes [#100](https://github.com/yschimke/design-parity/issues/100)


### Bug Fixes

* **claude-design:** resolve Chrome to an absolute path before launch ([c01551a](https://github.com/yschimke/design-parity/commit/c01551adb6db74cbe566710fef64880a2c20434b))
* **claude-design:** resolve Chrome to an absolute path before launch ([e1ba7e2](https://github.com/yschimke/design-parity/commit/e1ba7e228386a12a6076db7c542e798b917c72d3))

## [0.1.11](https://github.com/yschimke/design-parity/compare/v0.1.10...v0.1.11) (2026-06-17)


### Features

* **claude-design:** capture computed style for reference spec overlays ([0a3120f](https://github.com/yschimke/design-parity/commit/0a3120fde326cd9f4c131963e0f1758aed74359b))
* **claude-design:** capture computed style for reference spec overlays ([17f07e1](https://github.com/yschimke/design-parity/commit/17f07e16e4a9126a3958a0e198486d0486d1e3e0))
* **report:** layout-delta annotation layer ([c46248e](https://github.com/yschimke/design-parity/commit/c46248ec0c4a5f40d9797132288ca5e85dfa7c32))
* **report:** layout-delta annotation layer ([4983ae5](https://github.com/yschimke/design-parity/commit/4983ae5d7309d9c633ab8dfe45dfa3ef8d099ddb))
* **report:** toggleable annotation overlays (box model + typography) ([7104cf4](https://github.com/yschimke/design-parity/commit/7104cf4dc311a17f792d97c5a6247aa9135864dd))
* **report:** toggleable annotation overlays on report panels ([8f6cad7](https://github.com/yschimke/design-parity/commit/8f6cad76aa82247d146308f153c15c2cb384e084))

## [0.1.10](https://github.com/yschimke/design-parity/compare/v0.1.9...v0.1.10) (2026-06-17)


### Bug Fixes

* **cli:** run main via the launcher so `design-parity run` isn't a no-op ([4aead49](https://github.com/yschimke/design-parity/commit/4aead497364afb7ac4499ce062f9455a1665b193))
* **cli:** run main via the launcher so `design-parity run` isn't a no-op ([70545fa](https://github.com/yschimke/design-parity/commit/70545fa8803c023ce29cb6d5f5d7b7bf8f4d0803))

## [0.1.9](https://github.com/yschimke/design-parity/compare/v0.1.8...v0.1.9) (2026-06-17)


### Features

* **candidate,diff:** consume per-node typography for real font parity ([8779e77](https://github.com/yschimke/design-parity/commit/8779e774b053dfb39d70a3aa92bcfec4e9c98d2f))
* **candidate,diff:** consume per-node typography for real font parity ([f349405](https://github.com/yschimke/design-parity/commit/f34940571a1e15a620201448d2bd7e669659dd23))
* **candidate:** read v6 textColor / typography.fontSize with flat fallback ([8449ed3](https://github.com/yschimke/design-parity/commit/8449ed374de7289cc8ca63b9deffeb8077b49b54))
* **claude-design:** capture reference layout geometry (layout diff, increment 2) ([b333eb7](https://github.com/yschimke/design-parity/commit/b333eb7f91f3c8679cb39b4f13f7834179a00c7d))
* **claude-design:** capture reference layout geometry for the layout diff ([4f01c2c](https://github.com/yschimke/design-parity/commit/4f01c2c0ae9a876f5025848ba63ed0482f92d597))
* **diff:** structural layout diff — flag per-element position/size deltas ([4a81c24](https://github.com/yschimke/design-parity/commit/4a81c2447a8b9d2fcff14849e9564947f366d14f))
* **diff:** structural layout diff — per-element position/size deltas (increment 1) ([1aec9a6](https://github.com/yschimke/design-parity/commit/1aec9a6614f0fa9f4d33feb80aad686a6431003a))
* **diff:** wire structural layout diff into the engine and report ([d4849c0](https://github.com/yschimke/design-parity/commit/d4849c0b614680ac58dddaf4777ab69683e4bb43))
* **diff:** wire structural layout diff into the engine and report ([2da16e8](https://github.com/yschimke/design-parity/commit/2da16e84f41388413a8f96f129874dfd32dd2b66))

## [0.1.8](https://github.com/yschimke/design-parity/compare/v0.1.7...v0.1.8) (2026-06-17)


### Features

* **cli:** expose landing-page link context (repo-slug/branch) on `run` ([812fb88](https://github.com/yschimke/design-parity/commit/812fb887fac2f964cc4c2ec30e6e7c0245271470))
* **cli:** expose landing-page link context on `run` ([ddf2c11](https://github.com/yschimke/design-parity/commit/ddf2c11edd41342e88c1401eb451169a74def45d))

## [0.1.7](https://github.com/yschimke/design-parity/compare/v0.1.6...v0.1.7) (2026-06-16)


### Bug Fixes

* **checks:** don't flag measurement values as locale-grouped numbers ([64a7050](https://github.com/yschimke/design-parity/commit/64a705042e4bc709bcab9e8da99a7b2aa7d50dcf))
* **checks:** don't flag measurement values as locale-grouped numbers ([0799c0b](https://github.com/yschimke/design-parity/commit/0799c0b6637153aa30d7bca5c0f47a342e1d0445))
* **diff:** allow 1dp density-rounding slack on spacing/radius tokens ([55a3ef5](https://github.com/yschimke/design-parity/commit/55a3ef5da76b46155caf7225986344f7d707c0cc))
* **diff:** assert a11y coverage tree-wide, not on the root node ([7bd3a7d](https://github.com/yschimke/design-parity/commit/7bd3a7d761df890eb9c44aad25798f8011765b8b))
* **diff:** match M3 accent base roles against either ground ([aa4b135](https://github.com/yschimke/design-parity/commit/aa4b135da7b5f174968fc63e62e5d91e6c35380a))
* **diff:** preserve distinct candidate token values when flattening ([2fb8a55](https://github.com/yschimke/design-parity/commit/2fb8a5551861c7b589eec273d1d7ef9c1582075f))
* **diff:** stop false token/a11y findings against real bundle candidates ([63aabaa](https://github.com/yschimke/design-parity/commit/63aabaa4b4463f25c384ba3f5678e037c3f83922))

## [0.1.6](https://github.com/yschimke/design-parity/compare/v0.1.5...v0.1.6) (2026-06-16)


### Features

* **report-html:** lay variants out as a light/dark theme matrix ([8a56e97](https://github.com/yschimke/design-parity/commit/8a56e972210eec201491ff744c848daca0cc10ff))
* **report-html:** lay variants out as a light/dark theme matrix ([1bb3f28](https://github.com/yschimke/design-parity/commit/1bb3f28f56d1f1116615f1cbccd123b9911612b5))

## [0.1.5](https://github.com/yschimke/design-parity/compare/v0.1.4...v0.1.5) (2026-06-16)


### Features

* **action:** let a component declare DTCG spec tokens via design-map tokensFile ([bda4601](https://github.com/yschimke/design-parity/commit/bda4601bc4a961cdbd383a065c8ce083167988bf))
* **action:** let a component declare DTCG spec tokens via design-map tokensFile ([#89](https://github.com/yschimke/design-parity/issues/89)) ([d9aeb88](https://github.com/yschimke/design-parity/commit/d9aeb887437aa6c1340b41980342f7b5349af4c2))


### Bug Fixes

* **diff:** report unmappable colour/typography tokens as advisory, not missing ([2650399](https://github.com/yschimke/design-parity/commit/26503990b4f9de630f9402d95130aa4bf42da984))
* **diff:** report unmappable colour/typography tokens as advisory, not missing ([#102](https://github.com/yschimke/design-parity/issues/102)) ([ff9ecbc](https://github.com/yschimke/design-parity/commit/ff9ecbc117944a1b35b4bcf057385111ca3f80ec))

## [0.1.4](https://github.com/yschimke/design-parity/compare/v0.1.3...v0.1.4) (2026-06-15)


### Features

* bidirectional binding — reverse index + @DesignRef harvest (Phase 4) ([eacf2ec](https://github.com/yschimke/design-parity/commit/eacf2ec025adf346418d1f9ac188e58481a7aee4))
* **candidate:** translate extended compose/semantics token fields ([e6056a7](https://github.com/yschimke/design-parity/commit/e6056a7919bdcc3e35ce36cf6f6d5c26baf86468))
* **candidate:** translate extended compose/semantics token fields ([9bcaae0](https://github.com/yschimke/design-parity/commit/9bcaae08b70bf480bc9bac27a6f8613846abfd66))
* **cli:** design-parity reverse — design→code lookup ([daccc86](https://github.com/yschimke/design-parity/commit/daccc86de73265559fac21e2dff0c367bd386aec))
* **core:** accept W3C DTCG token files as a reference-side token-spec format ([5bf214f](https://github.com/yschimke/design-parity/commit/5bf214f45cc734caf3c7318ba614cc29b9608d07))
* **core:** accept W3C DTCG token files as a reference-side token-spec format ([#89](https://github.com/yschimke/design-parity/issues/89)) ([035a7e7](https://github.com/yschimke/design-parity/commit/035a7e7421a9c2d258c15ff98afb81034f0c296b))
* design-system token-table audit (Phase 3) ([64ce1f0](https://github.com/yschimke/design-parity/commit/64ce1f080b3156a5afc0339475aa2c01caaef0ac))
* **diff:** match tokens by Material role with a low-confidence naming heuristic ([85a032c](https://github.com/yschimke/design-parity/commit/85a032c36829bf761a0f022cc10f3fe136557f75))
* **diff:** match tokens by Material role with a low-confidence naming heuristic ([#87](https://github.com/yschimke/design-parity/issues/87)) ([9b0fdf1](https://github.com/yschimke/design-parity/commit/9b0fdf1794eaf0502fdc2d5762bafbfc788aa46a))
* multi-node design references (one component, several frames) ([c16a94f](https://github.com/yschimke/design-parity/commit/c16a94ff623e0bd15f3c8f30695ff0bb5b110dd4))
* **report-html:** shorten component labels on the landing page so the table fits ([28465e6](https://github.com/yschimke/design-parity/commit/28465e68b2fd084b5411019f7c122b4fd99575dd))
* **report-html:** shorten component labels on the landing page so the table fits ([32c4f29](https://github.com/yschimke/design-parity/commit/32c4f2986d8036903ffe36979372607262d5cafd))

## [0.1.3](https://github.com/yschimke/design-parity/compare/v0.1.2...v0.1.3) (2026-06-15)


### Features

* **candidate:** read resolved design tokens from compose/semantics nodes ([#1897](https://github.com/yschimke/design-parity/issues/1897)) ([c47626c](https://github.com/yschimke/design-parity/commit/c47626cd6723e20a257b2f4cb924980eeb3c8a49))
* **candidate:** read resolved design tokens from compose/semantics nodes ([#1897](https://github.com/yschimke/design-parity/issues/1897)) ([313b37e](https://github.com/yschimke/design-parity/commit/313b37e54d066f11b09183f3de7a9abae627a74f))
* **diff:** token alias map binding design names to code names ([#78](https://github.com/yschimke/design-parity/issues/78)) ([03ee01d](https://github.com/yschimke/design-parity/commit/03ee01d5370c59d37e9f510d5c26f2533e4fbabb))
* **report-html:** per-screen History links to git commit history ([e8e8441](https://github.com/yschimke/design-parity/commit/e8e8441fd65d2bbe24dde665fecf0eb753336ef3))
* **report-html:** preview thumbnails + htmlpreview links on the branch index ([3580d54](https://github.com/yschimke/design-parity/commit/3580d542fd20bc65ab933151bfba96f9d2ebd7b6))


### Bug Fixes

* **diff:** match candidate colours by alpha and role (issue [#74](https://github.com/yschimke/design-parity/issues/74)) ([03e30b1](https://github.com/yschimke/design-parity/commit/03e30b1afc6e874864b7502b80db2e3524359cf1))

## [0.1.2](https://github.com/yschimke/design-parity/compare/v0.1.1...v0.1.2) (2026-06-14)


### Features

* **report-html:** generate a branch landing page (README.md + index.html) ([ff92c77](https://github.com/yschimke/design-parity/commit/ff92c77298c8090b2dc2b4c2ebc7f284b577506d))
