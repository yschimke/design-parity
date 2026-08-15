/**
 * The narrow design-tool port the importer runs against, plus its Figma REST
 * binding.
 *
 * The importer needs exactly two things — a page's node tree and a PNG of that
 * page — so that is the whole port. Keeping it this small means every test in
 * this package runs offline against a hand-written tree, and a second source
 * (should one ever grow a page-level read API) implements two methods rather
 * than inheriting a Figma-shaped adapter.
 */
import type { FigmaRestClient } from "@design-parity/adapter-figma";

/**
 * A node in a fetched page tree. Structural, and a subset of Figma's shape: the
 * fields the importer reads and nothing more.
 */
export interface PageNode {
  id: string;
  name: string;
  /** Figma node type — `"FRAME"`, `"INSTANCE"`, `"TEXT"`, … */
  type: string;
  /** Explicitly `false` when the layer is hidden; absent means visible. */
  visible?: boolean;
  /** Absolute canvas-space box. Absent for nodes with no geometry. */
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  /** For an `INSTANCE`, the node id of its main component. */
  componentId?: string;
  children?: PageNode[];
}

/** File-level metadata about a main component or component set. */
export interface ComponentMeta {
  name?: string;
  /** Set this component is a variant of, when it is one. */
  componentSetId?: string;
}

/** One page's tree, with the component metadata needed to resolve instances. */
export interface PageDocument {
  document: PageNode;
  /** Main components referenced by the tree, keyed by node id. */
  components?: Record<string, ComponentMeta>;
  /** Component sets referenced by the tree, keyed by node id. */
  componentSets?: Record<string, ComponentMeta>;
}

/** Everything the importer needs from a design tool. */
export interface PageFetcher {
  /** The node tree of one page frame. */
  fetchPage(fileKey: string, nodeId: string): Promise<PageDocument>;
  /** A PNG of that frame, rendered at `scale`. */
  renderPage(fileKey: string, nodeId: string, scale: number): Promise<Uint8Array>;
  /**
   * That frame as an SVG carrying `data-node-id` on every element — a backdrop
   * the viewer can address rather than merely display (see `svg-backdrop.ts`).
   *
   * Optional because it is a strictly stronger request than {@link renderPage}:
   * a source with a page-level read API but no structured export still
   * implements the port, and a repo that hasn't asked for SVG backdrops never
   * calls this. The importer says so plainly rather than falling back, since a
   * silent downgrade to a picture is the failure this whole path exists to
   * avoid.
   */
  renderPageSvg?(fileKey: string, nodeId: string): Promise<string>;
}

/** Raw `GET /v1/files/:key/nodes` shape, narrowed to what this package reads. */
interface FileNodesLike {
  nodes: Record<
    string,
    | {
        document: PageNode;
        components?: Record<string, ComponentMeta>;
        componentSets?: Record<string, ComponentMeta>;
      }
    | null
  >;
}

/**
 * Bind the port to the adapter's REST client.
 *
 * The client is typed for the per-component adapter, whose node subset omits
 * `componentId` and the file-level `components` map — so the single cast the
 * importer needs is confined here rather than sprayed through the walk.
 */
export function figmaRestPageFetcher(client: FigmaRestClient): PageFetcher {
  return {
    async fetchPage(fileKey, nodeId) {
      const res = (await client.getFileNodes(fileKey, [nodeId])) as unknown as FileNodesLike;
      const entry = res.nodes[nodeId];
      if (!entry) {
        throw new Error(
          `page-backdrop: Figma file '${fileKey}' has no node '${nodeId}' (is it a top-level frame on a page?)`,
        );
      }
      const out: PageDocument = { document: entry.document };
      if (entry.components) out.components = entry.components;
      if (entry.componentSets) out.componentSets = entry.componentSets;
      return out;
    },

    async renderPage(fileKey, nodeId, scale) {
      const { bytes } = await client.renderImage(fileKey, nodeId, {
        format: "png",
        scale,
      });
      return bytes;
    },

    async renderPageSvg(fileKey, nodeId) {
      const { bytes } = await client.renderImage(fileKey, nodeId, {
        format: "svg",
        includeNodeId: true,
      });
      return new TextDecoder().decode(bytes);
    },
  };
}
