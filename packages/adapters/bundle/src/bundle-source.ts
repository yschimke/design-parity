/**
 * Reading entries out of a bundle, whether it is a committed directory or a
 * `.zip`. Both expose the same tiny interface — `file(path)` returns the raw
 * bytes for a bundle-relative path, or `undefined` if absent — so the adapter
 * is agnostic to the on-disk packaging.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { unzipSync } from "fflate";

import { BundleNotFoundError } from "./errors.js";

export interface BundleContents {
  /** Raw bytes for a bundle-relative path, or `undefined` if not present. */
  file(path: string): Promise<Uint8Array | undefined>;
}

/** Normalize a bundle-relative path to forward slashes, no leading `./`. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

class DirectoryContents implements BundleContents {
  readonly #root: string;
  constructor(root: string) {
    this.#root = root;
  }
  async file(path: string): Promise<Uint8Array | undefined> {
    try {
      return await readFile(resolve(this.#root, normalize(path)));
    } catch {
      return undefined;
    }
  }
}

class ZipContents implements BundleContents {
  readonly #entries: Record<string, Uint8Array>;
  constructor(entries: Record<string, Uint8Array>) {
    this.#entries = entries;
  }
  async file(path: string): Promise<Uint8Array | undefined> {
    return this.#entries[normalize(path)];
  }
}

/**
 * Open a bundle at `abs` (an absolute path). A `.zip` is unzipped in memory;
 * anything else is treated as a directory.
 *
 * @throws {@link BundleNotFoundError} if the path does not exist or a `.zip`
 *   cannot be read/inflated.
 */
export async function openBundle(
  abs: string,
  ref: string,
): Promise<BundleContents> {
  if (abs.toLowerCase().endsWith(".zip")) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(abs);
    } catch (cause) {
      throw new BundleNotFoundError(ref, { cause });
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch (cause) {
      throw new BundleNotFoundError(ref, { cause });
    }
    return new ZipContents(entries);
  }

  let isDir: boolean;
  try {
    isDir = (await stat(abs)).isDirectory();
  } catch (cause) {
    throw new BundleNotFoundError(ref, { cause });
  }
  if (!isDir) throw new BundleNotFoundError(ref);
  return new DirectoryContents(abs);
}
