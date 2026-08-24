# Scoped acceptance engine

`vendor/` is the TypeScript build form of the normative
`compose-preview-known-differences/v1` modules from `yschimke/compose-ai-tools` at
commit `47243aa90`. The only mechanical changes are the `.mjs` → `.js` import suffixes used by
NodeNext output and `@ts-nocheck`; behavior is pinned by the copied language-neutral fixture tree in
`packages/diff/test/fixtures/known-differences`.

Host work stays outside the vendored contract:

- `reader.ts` owns bounded filesystem reads, containment, and exact-case resolution.
- `evaluate.ts` owns offline scope, candidate-semantics tag projection, gate-before-union ordering,
  and the result exposed by `@design-parity/diff`.

When the schema version changes, update the modules and fixtures together and run the complete
conformance test before changing the adapter.
