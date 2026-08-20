# Changelog

## [0.1.54](https://github.com/yschimke/design-parity/compare/v0.1.53...v0.1.54) (2026-08-20)


### Bug Fixes

* **diff:** judge a corner's clamp in the unit the radius is in ([#359](https://github.com/yschimke/design-parity/issues/359)) ([344bf9c](https://github.com/yschimke/design-parity/commit/344bf9c86177c20e7081c7c191713a41fca0a65b))

## [0.1.53](https://github.com/yschimke/design-parity/compare/v0.1.52...v0.1.53) (2026-08-17)


### Features

* **kit-index:** resolve a seed by the kit's own axis and value names ([#356](https://github.com/yschimke/design-parity/issues/356)) ([10c4894](https://github.com/yschimke/design-parity/commit/10c4894c17a7c54d984bee52ebeebe0258a2e30b))


### Bug Fixes

* **kit-index:** close three edges a declaration could still fall through ([#358](https://github.com/yschimke/design-parity/issues/358)) ([693e4b9](https://github.com/yschimke/design-parity/commit/693e4b98d0e70429c7f2b6f99c26dba38089db22))

## [0.1.52](https://github.com/yschimke/design-parity/compare/v0.1.51...v0.1.52) (2026-08-16)


### Features

* **catalog-export:** carry a component's motion axis through the export ([#354](https://github.com/yschimke/design-parity/issues/354)) ([4e4ecf9](https://github.com/yschimke/design-parity/commit/4e4ecf982d5defef7cf382c6e3e09c54e8262b1b))

## [0.1.51](https://github.com/yschimke/design-parity/compare/v0.1.50...v0.1.51) (2026-08-15)


### Features

* **kit-index:** say WHY a variant resolved to nothing ([#352](https://github.com/yschimke/design-parity/issues/352)) ([014fdad](https://github.com/yschimke/design-parity/commit/014fdad990983da1cb57785f6cb5ef5b9d0d811c))
* list a design file's pages, and propose a reference per component ([#349](https://github.com/yschimke/design-parity/issues/349)) ([c4601dc](https://github.com/yschimke/design-parity/commit/c4601dca418052143cfd3da63416c2385bbfa1b3))
* **page-backdrop:** import a page as an addressable SVG ([#350](https://github.com/yschimke/design-parity/issues/350)) ([a8f0627](https://github.com/yschimke/design-parity/commit/a8f06273968eccca35c376a1a4ee04156ec1db20))


### Bug Fixes

* **deps:** pin dependencies ([#337](https://github.com/yschimke/design-parity/issues/337)) ([edcfc02](https://github.com/yschimke/design-parity/commit/edcfc028db4ae97ca247ba12fa80a7c94335cb76))

## [0.1.50](https://github.com/yschimke/design-parity/compare/v0.1.49...v0.1.50) (2026-08-15)


### Features

* **kit-index:** match slugged values against the axis's own spelling ([#346](https://github.com/yschimke/design-parity/issues/346)) ([88a675b](https://github.com/yschimke/design-parity/commit/88a675bf131a071a1e24ac1ab07b764f50a1e86c))

## [0.1.49](https://github.com/yschimke/design-parity/compare/v0.1.48...v0.1.49) (2026-08-15)


### Features

* **kit-index:** resolve declared variant renders into the design map ([#333](https://github.com/yschimke/design-parity/issues/333)) ([278f7ea](https://github.com/yschimke/design-parity/commit/278f7ea21a1bfd79b5c64189dc52ec0b571a6cfc))
* **kit-index:** resolve kit axes that fold two knobs into one value ([#335](https://github.com/yschimke/design-parity/issues/335)) ([5f2ee2d](https://github.com/yschimke/design-parity/commit/5f2ee2d4ba62a3064ffd08389272791a6513da4f))

## [0.1.48](https://github.com/yschimke/design-parity/compare/v0.1.47...v0.1.48) (2026-08-15)


### Features

* **kit-index:** add @design-parity/kit-index ([#327](https://github.com/yschimke/design-parity/issues/327)) ([b2ab2fe](https://github.com/yschimke/design-parity/commit/b2ab2fe2008e253628e77ec9b0cf14a04926d1bf))


### Bug Fixes

* **candidate:** skip a scoped pack's deferred previews instead of rejecting the bundle ([#330](https://github.com/yschimke/design-parity/issues/330)) ([f3f2b53](https://github.com/yschimke/design-parity/commit/f3f2b53ce58932b282945ddc779a1c5243db3967))

## [0.1.47](https://github.com/yschimke/design-parity/compare/v0.1.46...v0.1.47) (2026-08-11)


### Features

* configure per-reference Figma backgrounds ([#323](https://github.com/yschimke/design-parity/issues/323)) ([c6de0d3](https://github.com/yschimke/design-parity/commit/c6de0d30af40749d66bce6439f1821b6b402986b))
* report directional alpha loss ([#321](https://github.com/yschimke/design-parity/issues/321)) ([febb483](https://github.com/yschimke/design-parity/commit/febb483c159e3cf6af271010a50dd34db6c6164b))

## [0.1.46](https://github.com/yschimke/design-parity/compare/v0.1.45...v0.1.46) (2026-08-09)


### Bug Fixes

* **release:** make the recovery dispatch safe to actually use ([#315](https://github.com/yschimke/design-parity/issues/315)) ([33a3092](https://github.com/yschimke/design-parity/commit/33a3092cf4dc1faf1d1b54e0ee1218c30647cb34))

## [0.1.45](https://github.com/yschimke/design-parity/compare/v0.1.44...v0.1.45) (2026-08-08)


### Features

* **candidate:** read each declared theme's tokens out of a bundle ([#313](https://github.com/yschimke/design-parity/issues/313)) ([2e853df](https://github.com/yschimke/design-parity/commit/2e853df00ce19e33c09a99a9b819a9074f14f72d))

## [0.1.44](https://github.com/yschimke/design-parity/compare/v0.1.43...v0.1.44) (2026-08-08)


### Bug Fixes

* **release:** let a manual dispatch publish an already-cut release ([#310](https://github.com/yschimke/design-parity/issues/310)) ([a910fa2](https://github.com/yschimke/design-parity/commit/a910fa27fba5ec9ce251d1cf5c30a3f3ad1dc9c9))

## [0.1.43](https://github.com/yschimke/design-parity/compare/v0.1.42...v0.1.43) (2026-08-08)


### Features

* **action:** split the reference import from the parity run ([#305](https://github.com/yschimke/design-parity/issues/305)) ([33951f7](https://github.com/yschimke/design-parity/commit/33951f7b1114e52d67457deb7b6e74595f4aa0af))
* **candidate:** check the compose-preview CLI version instead of discarding it ([#300](https://github.com/yschimke/design-parity/issues/300)) ([4ce4a32](https://github.com/yschimke/design-parity/commit/4ce4a32ca0640ac96cae42d9021f4fe73f58bc7f))
* **catalog-export:** carry referenceSet onto the published catalog ([#306](https://github.com/yschimke/design-parity/issues/306)) ([8213ece](https://github.com/yschimke/design-parity/commit/8213ece79ea3c296595fee531ccc49658a7ed4a9))
* **catalog-export:** make the two annotated columns comparable ([#304](https://github.com/yschimke/design-parity/issues/304)) ([1ad51b0](https://github.com/yschimke/design-parity/commit/1ad51b054f2297c9ba7a7592c3d0190427da8c3e))
* **core:** add refSet so a screen's variant links to its mapped component ([#299](https://github.com/yschimke/design-parity/issues/299)) ([32a10b8](https://github.com/yschimke/design-parity/commit/32a10b80b228272d6d866571b4530e1cb82c5e89))
* **figma:** carry component properties on a reference, and pair on them ([#303](https://github.com/yschimke/design-parity/issues/303)) ([52e6c7a](https://github.com/yschimke/design-parity/commit/52e6c7a0ab55ad8fc76bc42aff0be0037580dba5))

## [0.1.42](https://github.com/yschimke/design-parity/compare/v0.1.41...v0.1.42) (2026-08-08)


### Features

* **page-backdrop:** make the manifest a versioned wire contract ([#297](https://github.com/yschimke/design-parity/issues/297)) ([b46cf0f](https://github.com/yschimke/design-parity/commit/b46cf0fc3e29f139636f9d10717e001f094b7713))

## [0.1.41](https://github.com/yschimke/design-parity/compare/v0.1.40...v0.1.41) (2026-08-08)


### Features

* **action:** carry the previous board forward on a partial refresh ([#291](https://github.com/yschimke/design-parity/issues/291)) ([0fdeb0b](https://github.com/yschimke/design-parity/commit/0fdeb0b1a746a375dca0d7328b8a5537dc7f6ca7))
* **action:** skip a run that would reproduce the published board ([#293](https://github.com/yschimke/design-parity/issues/293)) ([4d1dd70](https://github.com/yschimke/design-parity/commit/4d1dd705adef7d127674d48599a2623136973282))
* **ci:** run the pipeline from a design-parity ref, not just a release ([#292](https://github.com/yschimke/design-parity/issues/292)) ([310325b](https://github.com/yschimke/design-parity/commit/310325b1b7c5b4ad9c83502e662ecbff79457a80))


### Bug Fixes

* **adapter-figma:** retry rate-limited requests, and expose file version ([#290](https://github.com/yschimke/design-parity/issues/290)) ([223503d](https://github.com/yschimke/design-parity/commit/223503d049141fc31d5a8f417972f47c7c382df1))
* **workflow:** capability probe reported every CLI as too old ([#287](https://github.com/yschimke/design-parity/issues/287)) ([777fe2a](https://github.com/yschimke/design-parity/commit/777fe2a2e756b99bf1c0de09e156efe5209b316d))


### Performance Improvements

* **adapter-figma:** read every reference in a handful of requests ([#294](https://github.com/yschimke/design-parity/issues/294)) ([1226939](https://github.com/yschimke/design-parity/commit/1226939e2070d6ded29d05116fc67a2d7df47438))

## [0.1.40](https://github.com/yschimke/design-parity/compare/v0.1.39...v0.1.40) (2026-08-08)


### Bug Fixes

* **shard:** scope the render exclusion to the module's preview set ([#285](https://github.com/yschimke/design-parity/issues/285)) ([34f546b](https://github.com/yschimke/design-parity/commit/34f546bfedcf42ca0ad95ad3ad9fd2feaa2f4a80))

## [0.1.39](https://github.com/yschimke/design-parity/compare/v0.1.38...v0.1.39) (2026-08-08)


### Features

* **action:** shard a parity run across parallel jobs ([#284](https://github.com/yschimke/design-parity/issues/284)) ([718ee8c](https://github.com/yschimke/design-parity/commit/718ee8c9e37236f5c84488b4ad2b25f106262616))
* **page-backdrop:** import key Figma pages as backdrops with linked components ([#281](https://github.com/yschimke/design-parity/issues/281)) ([060e57b](https://github.com/yschimke/design-parity/commit/060e57b2771084d12156d5397b024e20be2241f0))

## [0.1.38](https://github.com/yschimke/design-parity/compare/v0.1.37...v0.1.38) (2026-08-04)


### Bug Fixes

* **catalog-export:** key preview annotations on the sticker id, and name the type unit ([#277](https://github.com/yschimke/design-parity/issues/277)) ([363467d](https://github.com/yschimke/design-parity/commit/363467d14435ec9312333927f2c75336a3427a8a))

## [0.1.37](https://github.com/yschimke/design-parity/compare/v0.1.36...v0.1.37) (2026-08-04)


### Bug Fixes

* **adapter-figma:** capture spec tokens, not just geometry, in layoutFromNode ([#275](https://github.com/yschimke/design-parity/issues/275)) ([9d36c35](https://github.com/yschimke/design-parity/commit/9d36c35483271ef6515669c1a7d9e43bb4d29665))

## [0.1.36](https://github.com/yschimke/design-parity/compare/v0.1.35...v0.1.36) (2026-08-04)


### Features

* **adapter-figma:** make layoutFromNode part of the public surface ([#273](https://github.com/yschimke/design-parity/issues/273)) ([9e55881](https://github.com/yschimke/design-parity/commit/9e5588125ca21ad418af03918e14afabc6396c96))
* **catalog-export:** build reference-side annotations from captured geometry ([#272](https://github.com/yschimke/design-parity/issues/272)) ([8a796ca](https://github.com/yschimke/design-parity/commit/8a796cab6e143554de348266729c5efec98af201))

## [0.1.35](https://github.com/yschimke/design-parity/compare/v0.1.34...v0.1.35) (2026-08-04)


### Features

* **catalog-export:** emit the annotation manifest for compare-page redlines ([#270](https://github.com/yschimke/design-parity/issues/270)) ([701eaea](https://github.com/yschimke/design-parity/commit/701eaeac839eb33ea69d4c5d7690fd38ba14850b))

## [0.1.34](https://github.com/yschimke/design-parity/compare/v0.1.33...v0.1.34) (2026-08-03)


### Features

* **diff:** report layout and size drift instead of silently skipping it ([#267](https://github.com/yschimke/design-parity/issues/267)) ([b641407](https://github.com/yschimke/design-parity/commit/b6414071079df278b1e2936e3007b681894715b7))


### Bug Fixes

* **diff:** measure size-mismatched pairs instead of saturating at 100% ([#265](https://github.com/yschimke/design-parity/issues/265)) ([143d910](https://github.com/yschimke/design-parity/commit/143d910ff7c10504121c4a7a1d50ed119585809c))

## [0.1.33](https://github.com/yschimke/design-parity/compare/v0.1.32...v0.1.33) (2026-08-03)


### Features

* **figma-plugin:** organize dialog around designer tasks ([#264](https://github.com/yschimke/design-parity/issues/264)) ([e69d095](https://github.com/yschimke/design-parity/commit/e69d095758019157a007474c978bf7b8d50bc167))


### Bug Fixes

* **diff:** rasterise a vector reference at the candidate's density ([#263](https://github.com/yschimke/design-parity/issues/263)) ([0591189](https://github.com/yschimke/design-parity/commit/059118997368c1f035f05c76c6334fd0451a2a77))
* **figma-plugin:** preserve semantic native import bindings ([#260](https://github.com/yschimke/design-parity/issues/260)) ([73f5f88](https://github.com/yschimke/design-parity/commit/73f5f882348a2f212357e3a1b3b9e7b71035dc29))

## [0.1.32](https://github.com/yschimke/design-parity/compare/v0.1.31...v0.1.32) (2026-08-03)


### Bug Fixes

* **candidate:** resolve raw preview ids from bundles ([#256](https://github.com/yschimke/design-parity/issues/256)) ([20ef70b](https://github.com/yschimke/design-parity/commit/20ef70b65b2ebc70b7119ac555e06718b49003fb))
* **figma-plugin:** promote Compose pill paths ([#257](https://github.com/yschimke/design-parity/issues/257)) ([1a1e902](https://github.com/yschimke/design-parity/commit/1a1e902061061a0fb4c3583c53a294be61d5fca7))

## [0.1.31](https://github.com/yschimke/design-parity/compare/v0.1.30...v0.1.31) (2026-08-02)


### Features

* **figma-plugin:** create first-class Figma library assets ([#253](https://github.com/yschimke/design-parity/issues/253)) ([7f26b3b](https://github.com/yschimke/design-parity/commit/7f26b3b7d16e44a46f12af0f7bda736985935664))
* **figma-plugin:** import SVGs as native Figma components ([#250](https://github.com/yschimke/design-parity/issues/250)) ([18cf405](https://github.com/yschimke/design-parity/commit/18cf40545892ee186827ce14919563b8f302338c))


### Bug Fixes

* **catalog:** retain preview ids for mapped upgrades ([#255](https://github.com/yschimke/design-parity/issues/255)) ([2930222](https://github.com/yschimke/design-parity/commit/293022291f3bf536a9731bc59f2ef693bbd7a9d0))

## [0.1.30](https://github.com/yschimke/design-parity/compare/v0.1.29...v0.1.30) (2026-07-21)


### Features

* **catalog-export:** carry optional display hints (surface + hero) through ([#247](https://github.com/yschimke/design-parity/issues/247)) ([f9b7c84](https://github.com/yschimke/design-parity/commit/f9b7c8471095f768567bc904f536ce0c0c2afc78))

## [0.1.29](https://github.com/yschimke/design-parity/compare/v0.1.28...v0.1.29) (2026-07-21)


### Features

* **adapter-claude-design:** live-render a prototype per viewport ([#85](https://github.com/yschimke/design-parity/issues/85)) ([#244](https://github.com/yschimke/design-parity/issues/244)) ([f08eaa3](https://github.com/yschimke/design-parity/commit/f08eaa3a4677a4ffc54fa68c6c159e86d954e621))
* **figma-plugin:** label + caption the i18n picker dimensions ([#220](https://github.com/yschimke/design-parity/issues/220)) ([#245](https://github.com/yschimke/design-parity/issues/245)) ([c7cab60](https://github.com/yschimke/design-parity/commit/c7cab603b3ec072e09a7eedc90bcba64a13dac1c))
* **resolver:** diff one code handle against multiple design sources ([#106](https://github.com/yschimke/design-parity/issues/106)) ([#243](https://github.com/yschimke/design-parity/issues/243)) ([498e304](https://github.com/yschimke/design-parity/commit/498e3042e224d230323d5a7b8562566bdb262687))

## [0.1.28](https://github.com/yschimke/design-parity/compare/v0.1.27...v0.1.28) (2026-07-19)


### Features

* **figma:** import references as SVG, rasterised on the fly for the pixel diff ([#241](https://github.com/yschimke/design-parity/issues/241)) ([75e3931](https://github.com/yschimke/design-parity/commit/75e39319267c5387656d5c1ce524b365c845d9e4))
* **report:** one mutually-exclusive view mode per variant, gated diff labels ([#238](https://github.com/yschimke/design-parity/issues/238)) ([e3ef759](https://github.com/yschimke/design-parity/commit/e3ef759ca1e2dc2cebd507066ed7d5fe83ec8070))
* **report:** render committed SVG references crisply, end to end ([#239](https://github.com/yschimke/design-parity/issues/239)) ([292d28d](https://github.com/yschimke/design-parity/commit/292d28da843522940eeb650430165902f3a6b2ba))


### Bug Fixes

* **diff:** collapse unverifiable token groups instead of N missing errors ([#235](https://github.com/yschimke/design-parity/issues/235)) ([42d7566](https://github.com/yschimke/design-parity/commit/42d756616840aea7a1612fd9145c8b9fa86a9eb3))
* **diff:** gate text layout on vertical position + height, not content width ([#240](https://github.com/yschimke/design-parity/issues/240)) ([8fffef0](https://github.com/yschimke/design-parity/commit/8fffef000e754cfacfa34893858385a496559224))

## [0.1.27](https://github.com/yschimke/design-parity/compare/v0.1.26...v0.1.27) (2026-07-18)


### Features

* **catalog-export:** carry a component section for tabbed catalog pages ([#233](https://github.com/yschimke/design-parity/issues/233)) ([3d95de3](https://github.com/yschimke/design-parity/commit/3d95de3aad2c72ba8544900694f0c024518977b0))
* **figma-plugin:** bridge a picked catalog component into live customization ([#232](https://github.com/yschimke/design-parity/issues/232)) ([10cbfaf](https://github.com/yschimke/design-parity/commit/10cbfaf82702d59e62ed021342a0b4c960627fb5))
* **figma-plugin:** insert the editable design vector (figma-svg), not the wireframe ([#227](https://github.com/yschimke/design-parity/issues/227)) ([c138dfd](https://github.com/yschimke/design-parity/commit/c138dfd8205dff05195764dcd55f2d4f0b607b92))
* **figma-plugin:** load a catalog from a local folder (offline, no server) ([#229](https://github.com/yschimke/design-parity/issues/229)) ([032fb48](https://github.com/yschimke/design-parity/commit/032fb489d3d3e236311790c63c0c60943e84ec27))
* **figma-plugin:** re-render a live node at its current on-canvas size ([#230](https://github.com/yschimke/design-parity/issues/230)) ([71aced3](https://github.com/yschimke/design-parity/commit/71aced350c89c2f2cc890099491242a16414bb7f))
* **figma-plugin:** teach the user when no preview server is reachable ([#228](https://github.com/yschimke/design-parity/issues/228)) ([f77d818](https://github.com/yschimke/design-parity/commit/f77d818b0576473810bb2ee5f70ca71db494479e))

## [0.1.26](https://github.com/yschimke/design-parity/compare/v0.1.25...v0.1.26) (2026-07-09)


### Features

* **figma-plugin:** allow the preview.coo.ee serve host in the manifest ([#212](https://github.com/yschimke/design-parity/issues/212)) ([c6f6605](https://github.com/yschimke/design-parity/commit/c6f6605a31dd9bf2502ed1b0c65f68fb959951ce))
* **figma-plugin:** fill a slot with a child rendered to its size ([#210](https://github.com/yschimke/design-parity/issues/210)) ([37a4787](https://github.com/yschimke/design-parity/commit/37a4787c61d1edd8bf6ac3faa6cd124a9e188eb9))
* **figma-plugin:** insert a single catalog component by variant + dimension ([#215](https://github.com/yschimke/design-parity/issues/215)) ([b14bf49](https://github.com/yschimke/design-parity/commit/b14bf49cb166ae07ebc895c072b6124745e26176))
* **figma-plugin:** insert a single component as a native Figma component set ([#223](https://github.com/yschimke/design-parity/issues/223)) ([151be09](https://github.com/yschimke/design-parity/commit/151be09f8bc41dbbf5307b728853ca9fb8e14b36))
* **figma-plugin:** materialize preview slots as frames on canvas ([#208](https://github.com/yschimke/design-parity/issues/208)) ([7027fec](https://github.com/yschimke/design-parity/commit/7027fecf829d7e777bf3c8fdbbef47c59585fb1e))
* **figma-plugin:** pick a catalog from a registry instead of pasting a URL ([#217](https://github.com/yschimke/design-parity/issues/217)) ([050932d](https://github.com/yschimke/design-parity/commit/050932d11bd213f3362c36cb6d73c145f0301925))
* **figma-plugin:** propose a spec → GitHub issue from a selected frame ([#224](https://github.com/yschimke/design-parity/issues/224)) ([721fa4f](https://github.com/yschimke/design-parity/commit/721fa4f94ad2a309931d6bb59e67566108960a1c))
* **figma-plugin:** searchable, grouped component picker ([#225](https://github.com/yschimke/design-parity/issues/225)) ([d0ae646](https://github.com/yschimke/design-parity/commit/d0ae646aeb540ef235c2faa31e21ed7ffb0892eb))
* **figma-plugin:** ship an importable prebuilt bundle for local install ([#216](https://github.com/yschimke/design-parity/issues/216)) ([9c3953c](https://github.com/yschimke/design-parity/commit/9c3953c9eef7d963689a241ece1d72bb73da464d))
* **figma-plugin:** wire the slot flow into the plugin UI ([#211](https://github.com/yschimke/design-parity/issues/211)) ([12bf22f](https://github.com/yschimke/design-parity/commit/12bf22fbcbb6133e3e0f345b84cc911e0078c872))


### Bug Fixes

* repair figma plugin import flow ([#214](https://github.com/yschimke/design-parity/issues/214)) ([446ae6a](https://github.com/yschimke/design-parity/commit/446ae6a9f30296db3fa28882ca54bd54200e0d85))

## [0.1.25](https://github.com/yschimke/design-parity/compare/v0.1.24...v0.1.25) (2026-07-05)


### Features

* **catalog-export:** add the screen graph to the catalog spec and manifest ([#190](https://github.com/yschimke/design-parity/issues/190)) ([d54b1b4](https://github.com/yschimke/design-parity/commit/d54b1b435ea51bf26e31a86c35d87b389c68643b))
* **catalog-export:** bake a wireframe SVG into the bundle ahead of time ([#204](https://github.com/yschimke/design-parity/issues/204)) ([bec2faa](https://github.com/yschimke/design-parity/commit/bec2faa39b95e04b4af34147c4dc4679cf879310))
* **catalog-export:** generalize component variants to named prop axes ([#206](https://github.com/yschimke/design-parity/issues/206)) ([42d7ae1](https://github.com/yschimke/design-parity/commit/42d7ae101ce0cb35af809846690f4ef500e02cc5))
* **catalog-export:** stamp parity direction into catalog.json ([#189](https://github.com/yschimke/design-parity/issues/189)) ([8d7b4e0](https://github.com/yschimke/design-parity/commit/8d7b4e0d2e0aa7732f29dd9d54ce0cc2888e6f8e))
* **catalog-export:** support component state `variants` in the spec join ([#193](https://github.com/yschimke/design-parity/issues/193)) ([e38a941](https://github.com/yschimke/design-parity/commit/e38a941b85c8e26b7000fb69543a675eeee51634))
* **figma-plugin:** /api/previews (v2) client + override-editor model ([#191](https://github.com/yschimke/design-parity/issues/191)) ([8f4d7fd](https://github.com/yschimke/design-parity/commit/8f4d7fd093da0752ea0351cf5713daceafe3812a))
* **figma-plugin:** add the wireframe comparison lane on screen pages ([#201](https://github.com/yschimke/design-parity/issues/201)) ([f4b9f87](https://github.com/yschimke/design-parity/commit/f4b9f87f5a2b796da998cb935ec22ff4398f9786))
* **figma-plugin:** build the Components page as native Figma component sets ([#198](https://github.com/yschimke/design-parity/issues/198)) ([787fdd3](https://github.com/yschimke/design-parity/commit/787fdd3b5bdc4e2d8ee556ebb3fd9dde00c68b6c))
* **figma-plugin:** catalog-import Figma plugin ([#175](https://github.com/yschimke/design-parity/issues/175)) ([b01274b](https://github.com/yschimke/design-parity/commit/b01274be29d49ff56ba05f2721ac0dd90c3fdced))
* **figma-plugin:** emit a design-map.json correspondence on import ([#178](https://github.com/yschimke/design-parity/issues/178)) ([8c46781](https://github.com/yschimke/design-parity/commit/8c467813409e18e4a4a34626c72802e6f41a9ee9))
* **figma-plugin:** head each screen page with a designer-owned Figma spec ([#199](https://github.com/yschimke/design-parity/issues/199)) ([caadf2b](https://github.com/yschimke/design-parity/commit/caadf2bda879302ae7827d75847e55d31d9705b1))
* **figma-plugin:** import a component as an editable SVG (mode c) ([#200](https://github.com/yschimke/design-parity/issues/200)) ([352248c](https://github.com/yschimke/design-parity/commit/352248c09fbf14d5d4cc2f4199cac808705b4e80))
* **figma-plugin:** lay out per-screen import pages from the screen graph ([#195](https://github.com/yschimke/design-parity/issues/195)) ([deacafc](https://github.com/yschimke/design-parity/commit/deacafca2d96c7d60b7249fb2acafc9c3205d9a8))
* **figma-plugin:** live-render client contract for compose-preview serve ([#185](https://github.com/yschimke/design-parity/issues/185)) ([b02af39](https://github.com/yschimke/design-parity/commit/b02af396cdf02913511e45cee8623b32647f7412))
* **figma-plugin:** mode gate — design-led imports to a reference page, confirm before write ([#188](https://github.com/yschimke/design-parity/issues/188)) ([79f4d11](https://github.com/yschimke/design-parity/commit/79f4d117330e52a61a8c673616acc65edba98f70))
* **figma-plugin:** overlay spacing redlines on the wireframe lane ([#202](https://github.com/yschimke/design-parity/issues/202)) ([484258c](https://github.com/yschimke/design-parity/commit/484258c2593deb0b4bac4fc8649fd13675b28230))
* **figma-plugin:** override editor UI — instantiate a live component ([#194](https://github.com/yschimke/design-parity/issues/194)) ([3336712](https://github.com/yschimke/design-parity/commit/33367123debcdaf876265fbf09722ac50bb2fd4c))
* **figma-plugin:** parse the /render/&lt;id&gt;.slots response ([#207](https://github.com/yschimke/design-parity/issues/207)) ([8a158f4](https://github.com/yschimke/design-parity/commit/8a158f4e2055be61fdacd6a8d05434d64e453281))
* **figma-plugin:** place + refresh a single live-rendered preview ([#192](https://github.com/yschimke/design-parity/issues/192)) ([81f4ad3](https://github.com/yschimke/design-parity/commit/81f4ad3fbebccd272691d42c9bdd800ef415e8ee))
* **figma-plugin:** place the baked wireframe SVG as a true vector lane ([#205](https://github.com/yschimke/design-parity/issues/205)) ([a3d9b98](https://github.com/yschimke/design-parity/commit/a3d9b9845e8bf6767382c744d984193a3fb0dd52))
* **figma-plugin:** reconcile re-imports in place, keyed by componentId ([#184](https://github.com/yschimke/design-parity/issues/184)) ([8eefa74](https://github.com/yschimke/design-parity/commit/8eefa7410a5687913f3c6ddef28e863e784e14a9))
* **figma-plugin:** redline (spacing) annotation layer ([#177](https://github.com/yschimke/design-parity/issues/177)) ([70fd620](https://github.com/yschimke/design-parity/commit/70fd6204d7e78d316596d8827b19efdd67754e85))
* **figma-plugin:** Refresh — re-render placed live nodes against latest code ([#197](https://github.com/yschimke/design-parity/issues/197)) ([c9b36d3](https://github.com/yschimke/design-parity/commit/c9b36d35c1b3260e93c83f56e41c3067edf68c6e))
* **figma-plugin:** refresh a placed SVG node against updated code ([#203](https://github.com/yschimke/design-parity/issues/203)) ([5d8c6c3](https://github.com/yschimke/design-parity/commit/5d8c6c3636f173b75aeb8ea36d826b0fd17d74c8))
* **figma-plugin:** render provenance — stamp RenderSource for refresh ([#186](https://github.com/yschimke/design-parity/issues/186)) ([02c25db](https://github.com/yschimke/design-parity/commit/02c25dbfad8cd4b7280b51988252f4d7915a5cfe))
* **figma-plugin:** render provenance — stamp RenderSource for refresh ([#187](https://github.com/yschimke/design-parity/issues/187)) ([4e06339](https://github.com/yschimke/design-parity/commit/4e063393b545cf762caa4dc13df711876b88ab61))
* **figma-plugin:** route theme foundations to a Themes/Tokens page ([#196](https://github.com/yschimke/design-parity/issues/196)) ([0536098](https://github.com/yschimke/design-parity/commit/0536098e370317b192afba26b2db7e56959fe211))

## [0.1.24](https://github.com/yschimke/design-parity/compare/v0.1.23...v0.1.24) (2026-07-02)


### Features

* **candidate:** read @ColorCatalog/@TypographyCatalog tokens from a bundle ([4a5fc8b](https://github.com/yschimke/design-parity/commit/4a5fc8b8511a1310c00a05f9b3f1b6a0a40e10f6))
* **candidate:** read @ColorCatalog/@TypographyCatalog tokens from a bundle ([488770f](https://github.com/yschimke/design-parity/commit/488770f57874846495aadc8946b883332ad8bfc8))

## [0.1.23](https://github.com/yschimke/design-parity/compare/v0.1.22...v0.1.23) (2026-06-29)


### Features

* **catalog-export:** emit livePreview deep links into the catalog manifest ([f108fd1](https://github.com/yschimke/design-parity/commit/f108fd114f741ed00c0ef734c2c98ca3b342c441))
* **catalog-export:** emit livePreview deep links into the catalog manifest ([532deb1](https://github.com/yschimke/design-parity/commit/532deb16b2f8e4c1842463b60e065482afa27c93))


### Bug Fixes

* **catalog-export:** point livePreview at the /p viewer route ([48ae723](https://github.com/yschimke/design-parity/commit/48ae7234b11149d9053e5916801bc8a00c2aa0eb))

## [0.1.22](https://github.com/yschimke/design-parity/compare/v0.1.21...v0.1.22) (2026-06-23)


### Features

* **catalog-export:** add spec join + render-to-catalog driver ([bd5e6ff](https://github.com/yschimke/design-parity/commit/bd5e6ff870d5b9239082995042654a8e01ea23c3))
* **catalog-export:** spec join + render-to-catalog driver ([0eda9e5](https://github.com/yschimke/design-parity/commit/0eda9e550c61be09143dc6b67656f9879d0a62db))
* **catalog-export:** surface slot redlines (box + padding + gap) in the catalog ([63ff376](https://github.com/yschimke/design-parity/commit/63ff37639df12625a318b863d4555f5acc2b8185))
* **catalog-export:** surface slot redlines (box + padding + gap) in the catalog ([70a090a](https://github.com/yschimke/design-parity/commit/70a090a1e9e0632ae2f58122a60de7e10aa3fa0e))


### Bug Fixes

* **catalog-export:** gate publish on a complete render ([645d98e](https://github.com/yschimke/design-parity/commit/645d98e93a01c4882a754c48b8d33db62223e1b3))
* **catalog-export:** match catalog spec on functionName and fold theme variants ([15b81d8](https://github.com/yschimke/design-parity/commit/15b81d8f037b10aeb2647e2d915027daaaf8f4a0))
* **catalog-export:** match catalog spec on functionName and fold theme variants ([4524c31](https://github.com/yschimke/design-parity/commit/4524c31837a961aa2c4bf4e86579921169225797))
* **core:** normalizeSize accepts null (unset widthDp serializes as JSON null) ([872ed12](https://github.com/yschimke/design-parity/commit/872ed123f2b4d5f67b64ad7a8b0495d68abc9019))
* **core:** normalizeSize accepts null (unset widthDp serializes as JSON null) ([e0a16bf](https://github.com/yschimke/design-parity/commit/e0a16bf6595bd2b0c773d744c191f44eb32a7f32))

## [0.1.21](https://github.com/yschimke/design-parity/compare/v0.1.20...v0.1.21) (2026-06-23)


### Bug Fixes

* **release:** make workspace publish resilient to partial state ([071811d](https://github.com/yschimke/design-parity/commit/071811d3568513da8dfdb12bd780522f04f5fc50))
* **release:** publish workspaces individually and skip already-published versions ([a615662](https://github.com/yschimke/design-parity/commit/a615662aa558e07549dc2fac7bebeb0878268ea8))

## [0.1.20](https://github.com/yschimke/design-parity/compare/v0.1.19...v0.1.20) (2026-06-23)


### Features

* **catalog-export:** export rendered component systems as importable design catalogs ([1f0bd84](https://github.com/yschimke/design-parity/commit/1f0bd84b1cdc4ab17838fe0dca3a5f93fb79071f))
* **catalog-export:** export rendered component systems as importable design catalogs ([32cdf02](https://github.com/yschimke/design-parity/commit/32cdf028b4a9e174fedfc9030bdba162e893d147))

## [0.1.19](https://github.com/yschimke/design-parity/compare/v0.1.18...v0.1.19) (2026-06-22)


### Features

* **action:** publish design-system tokens as DTCG on the report branch ([35b9a7c](https://github.com/yschimke/design-parity/commit/35b9a7c6f1b972fb2f326f6979613cbe681c4ffc))
* **action:** publish the design-system tokens as DTCG on the report branch ([c1d794c](https://github.com/yschimke/design-parity/commit/c1d794c6bdc8a35f3c7edc674c4ce9446ff4a299))

## [0.1.18](https://github.com/yschimke/design-parity/compare/v0.1.17...v0.1.18) (2026-06-22)


### Features

* **claude-design:** consume /design-sync token artifacts; reconcile the reverse path ([70411e4](https://github.com/yschimke/design-parity/commit/70411e4f4b1bfedb04b5fa451f11f5ec8deafcae))
* **claude-design:** resolve a synced DTCG token artifact as a token-only reference ([8073ccd](https://github.com/yschimke/design-parity/commit/8073ccd0ce4432f437c898292b92fc7b069beb0f))

## [0.1.17](https://github.com/yschimke/design-parity/compare/v0.1.16...v0.1.17) (2026-06-19)


### Bug Fixes

* **candidate:** normalize font-family on the bundle path too ([05b3c22](https://github.com/yschimke/design-parity/commit/05b3c2297cd064187c79718994437e8e9f2c5ed2))
* **candidate:** normalize font-family on the bundle path too ([022d257](https://github.com/yschimke/design-parity/commit/022d2573dcbc208d7ec3d456a60fa5ef88709029))

## [0.1.16](https://github.com/yschimke/design-parity/compare/v0.1.15...v0.1.16) (2026-06-19)


### Features

* **claude-design:** capture accessible objects, not just text leaves ([cb36e5a](https://github.com/yschimke/design-parity/commit/cb36e5a0d5509cb4a3bbb82f56d7b6ed706eeb34))
* **claude-design:** capture accessible objects, not just text leaves ([02b2095](https://github.com/yschimke/design-parity/commit/02b2095e650af64fcd499e691f4f7da11a7bba36))
* **report-html:** highlight which elements differ on the diff panel ([7d7c4cf](https://github.com/yschimke/design-parity/commit/7d7c4cf5076b44f479d1b093d78ee7b96f5a40aa))
* **report-html:** highlight which elements differ on the diff panel ([106f4a1](https://github.com/yschimke/design-parity/commit/106f4a1962248e6c4c2653de332e18c9e900ef78))

## [0.1.15](https://github.com/yschimke/design-parity/compare/v0.1.14...v0.1.15) (2026-06-18)


### Bug Fixes

* **candidate:** normalize resolved font-family to its display name ([7debb38](https://github.com/yschimke/design-parity/commit/7debb385ef4e868dc9cb8ebd7ca169c352f95439))
* **candidate:** normalize resolved font-family to its display name ([0158f9f](https://github.com/yschimke/design-parity/commit/0158f9ff8ccb86a2416692e838c0f300ed729fa4))

## [0.1.14](https://github.com/yschimke/design-parity/compare/v0.1.13...v0.1.14) (2026-06-18)


### Bug Fixes

* **candidate:** read text typography on the bundle path ([617dc54](https://github.com/yschimke/design-parity/commit/617dc54f55853fee9d01fbecb1c16a8f5e89e389))
* **candidate:** read text typography on the bundle path ([e7e9b84](https://github.com/yschimke/design-parity/commit/e7e9b847cba6791420b2cb57a1361249bbb2c087))
* **claude-design:** measure reference text at its glyph box, not the cell ([1d62bb1](https://github.com/yschimke/design-parity/commit/1d62bb11799f6d7b2469d100817db6528787a268))
* **claude-design:** measure reference text at its glyph box, not the cell ([250307d](https://github.com/yschimke/design-parity/commit/250307dccaace9632bfd9d6e3254e506ff1b8668))

## [0.1.13](https://github.com/yschimke/design-parity/compare/v0.1.12...v0.1.13) (2026-06-18)


### Features

* **report:** move annotation toggles below the variant detail ([2b06051](https://github.com/yschimke/design-parity/commit/2b06051e3814e04cbd96b4226ad4d6ae59505bb4))
* **report:** move annotation toggles below the variant detail ([deb3036](https://github.com/yschimke/design-parity/commit/deb3036be69c1ccc9e73cef0bd45e30563a343fb))


### Bug Fixes

* **candidate:** parse compose/semantics boundsInRoot on the bundle path ([69821fd](https://github.com/yschimke/design-parity/commit/69821fd9b1d6a1213c99b4b2bf3e2f1c405a5589))
* **candidate:** parse compose/semantics boundsInRoot on the bundle path ([15629cf](https://github.com/yschimke/design-parity/commit/15629cf62e732703509eeacfb3569ec223f7ca2f))

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
