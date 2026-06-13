// The top-level `design-parity` package re-exports the programmatic API of
// @design-parity/action, so `import { orchestrate } from "design-parity"` works
// the same as importing from the scoped package. The CLI entrypoint is bin/.
export * from "@design-parity/action";
