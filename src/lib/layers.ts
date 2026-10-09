import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildLayerTree, type LayerNode, type LayerOrderItem } from "./layerTree";

/**
 * Layer (optional content) visibility for the open PDF.
 *
 * pdf.js builds a fresh OptionalContentConfig on every `getOptionalContentConfig()`
 * call and react-pdf never passes one to `page.render`, so there's no public way
 * to make react-pdf's canvases honour a toggled layer. Instead we keep one config
 * per document, and once the user changes a layer, wrap `PDFPageProxy.render` so
 * renders against that document carry our config. The pdfjs-dist version is
 * pinned (see CLAUDE.md), so reaching for `_transport` is stable.
 *
 * Visibility is a viewing aid only: export keeps the file's own defaults.
 */

type Config = Awaited<ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>>;

export type LayerState = {
  tree: LayerNode[];
  /** Whether each layer is currently shown, by layer id. */
  visibility: Record<string, boolean>;
  /** The file's own default visibility, for "reset". */
  initial: Record<string, boolean>;
};

type Entry = {
  config: Config;
  promise: Promise<Config>;
  initial: Record<string, boolean>;
  /** True once the user has changed something; until then pdf.js's own default
   * config is exactly right and nothing needs injecting. */
  dirty: boolean;
};

type Transport = object;
// Shared on globalThis: the render hook below lives on a pdf.js prototype and
// outlives this module, so after a dev hot reload the old hook must keep reading
// the same map as the new module.
const entries = ((globalThis as { __layerEntries?: WeakMap<Transport, Entry> }).__layerEntries ??=
  new WeakMap<Transport, Entry>());

const HOOK_FLAG = "__layerRenderHook";

/** pdf.js hands out one transport per document, shared by its page proxies. */
const transportOf = (proxy: unknown): Transport => (proxy as { _transport: Transport })._transport;

function readVisibility(config: Config): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, group] of config) out[id] = !!group.visible;
  return out;
}

/** Wrap `render` on the page-proxy prototype (once) so renders pick up our config.
 * The class isn't exported at runtime, so the prototype comes from a live page. */
async function installRenderHook(pdf: PDFDocumentProxy): Promise<void> {
  const proto = Object.getPrototypeOf(await pdf.getPage(1)) as Record<string, unknown>;
  if (proto[HOOK_FLAG]) return;
  proto[HOOK_FLAG] = true;
  const original = proto.render as (params: Record<string, unknown>) => unknown;
  proto.render = function (this: unknown, params: Record<string, unknown>) {
    const entry = entries.get(transportOf(this));
    const patched =
      entry?.dirty && !params.optionalContentConfigPromise
        ? { ...params, optionalContentConfigPromise: entry.promise }
        : params;
    return original.call(this, patched);
  };
}

/** Read the document's layers; null when it has none. */
export async function loadLayers(pdf: PDFDocumentProxy): Promise<LayerState | null> {
  const config = await pdf.getOptionalContentConfig();
  const order = config.getOrder() as LayerOrderItem[] | null;
  const tree = buildLayerTree(
    order,
    (id) => config.getGroup(id)?.name,
    (id) => config.getGroup(id) !== null,
  );
  if (tree.length === 0) return null;
  const visibility = readVisibility(config);
  entries.set(transportOf(pdf), {
    config,
    promise: Promise.resolve(config),
    initial: visibility,
    dirty: false,
  });
  await installRenderHook(pdf);
  return { tree, visibility, initial: visibility };
}

/** Show or hide one layer and return every layer's resulting visibility (turning
 * one on can turn off its radio-button siblings). Null if the document has no
 * layer state, e.g. it was swapped out while the user clicked. */
export function setLayerVisibility(
  pdf: PDFDocumentProxy,
  id: string,
  visible: boolean,
): Record<string, boolean> | null {
  const entry = entries.get(transportOf(pdf));
  if (!entry) return null;
  entry.config.setVisibility(id, visible);
  entry.dirty = true;
  return readVisibility(entry.config);
}

/** Put every layer back to the file's own default visibility. */
export function resetLayers(pdf: PDFDocumentProxy): Record<string, boolean> | null {
  const entry = entries.get(transportOf(pdf));
  if (!entry) return null;
  for (const [id, visible] of Object.entries(entry.initial)) {
    entry.config.setVisibility(id, visible, false);
  }
  entry.dirty = true;
  return readVisibility(entry.config);
}
