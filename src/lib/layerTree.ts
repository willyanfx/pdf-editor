/**
 * Shape of a PDF's layers (optional content groups) for the Layers panel. Kept
 * free of pdf.js imports so it can be unit-tested on plain data.
 */

/** One entry of pdf.js's `OptionalContentConfig.getOrder()`: a group id, or a
 * labelled set of entries. A `null` name is an unlabelled bucket (pdf.js uses
 * one for groups the file didn't list in its /Order array). */
export type LayerOrderItem = string | { name: string | null; order: LayerOrderItem[] };

export type LayerNode =
  | { kind: "layer"; id: string; name: string }
  | { kind: "folder"; name: string; children: LayerNode[] };

export const UNTITLED_LAYER = "Untitled layer";

/** Turn pdf.js's order into the panel's tree. Unlabelled buckets are inlined, and
 * ids with no matching group (a malformed file) are skipped. */
export function buildLayerTree(
  order: LayerOrderItem[] | null,
  groupName: (id: string) => string | null | undefined,
  hasGroup: (id: string) => boolean,
): LayerNode[] {
  if (!order) return [];
  const out: LayerNode[] = [];
  for (const item of order) {
    if (typeof item === "string") {
      if (hasGroup(item)) {
        out.push({ kind: "layer", id: item, name: groupName(item)?.trim() || UNTITLED_LAYER });
      }
      continue;
    }
    const children = buildLayerTree(item.order, groupName, hasGroup);
    if (children.length === 0) continue;
    if (item.name === null || !item.name.trim()) out.push(...children);
    else out.push({ kind: "folder", name: item.name, children });
  }
  return out;
}
