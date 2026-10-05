# Scoped acceptance engine

The normative `compose-preview-known-differences/v1` modules come from
[`@design-parity/known-differences`](../../../known-differences), which records the
`yschimke/compose-ai-tools` commit they match in its `src/PROVENANCE.json`. Behavior is pinned by the
language-neutral fixture tree in `packages/known-differences/test/fixtures/known-differences.zip`,
which `test/known-differences-conformance.test.ts` runs through this adapter.

Host work stays outside the engine:

- `reader.ts` owns bounded filesystem reads, containment, and exact-case resolution.
- `evaluate.ts` owns offline scope, candidate-semantics tag projection, gate-before-union ordering,
  and the result exposed by `@design-parity/diff`.

When the schema version changes, update the modules and fixtures together and run the complete
conformance test before changing the adapter.
