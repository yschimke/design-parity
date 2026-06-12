/**
 * Filenames of the committed artifacts setup/bootstrap writes. Centralized so
 * detection can ignore files this package itself produces (see {@link
 * detectMaturity}) and the CLI and tests agree on paths.
 */
import { PARITY_CONFIG_FILENAME } from "@design-parity/policy";

/** Parity policy (`ParityConfig`) — written for every rung. Owned by `policy`. */
export const CONFIG_FILE = PARITY_CONFIG_FILENAME;

/** Opinionated `DesignTokens` baseline — bootstrap rung only. */
export const TOKENS_FILE = "design-tokens.json";

/** Starter `ChecksConfig` for `@design-parity/checks` — bootstrap rung only. */
export const CHECKS_FILE = "design-parity.checks.json";

/** Starter manifest correspondence — bootstrap rung only. */
export const DESIGN_MAP_FILE = "design-map.json";
