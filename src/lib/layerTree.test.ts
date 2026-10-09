import { expect, test } from "vite-plus/test";
import { buildLayerTree, layerIds, UNTITLED_LAYER, type LayerOrderItem } from "./layerTree";

const names: Record<string, string | null> = {
  "1R": "Background",
  "2R": "Dimensions",
  "3R": "Notes",
  "4R": null,
};
const name = (id: string) => names[id];
const has = (id: string) => id in names;

test("no order means no layers", () => {
  expect(buildLayerTree(null, name, has)).toEqual([]);
  expect(buildLayerTree([], name, has)).toEqual([]);
});

test("a flat order becomes a flat list, naming untitled groups", () => {
  expect(buildLayerTree(["1R", "4R"], name, has)).toEqual([
    { kind: "layer", id: "1R", name: "Background" },
    { kind: "layer", id: "4R", name: UNTITLED_LAYER },
  ]);
});

test("labelled sets become folders; unlabelled ones are inlined", () => {
  const order: LayerOrderItem[] = [
    "1R",
    { name: "Annotations", order: ["2R", "3R"] },
    { name: null, order: ["4R"] },
  ];
  expect(buildLayerTree(order, name, has)).toEqual([
    { kind: "layer", id: "1R", name: "Background" },
    {
      kind: "folder",
      name: "Annotations",
      children: [
        { kind: "layer", id: "2R", name: "Dimensions" },
        { kind: "layer", id: "3R", name: "Notes" },
      ],
    },
    { kind: "layer", id: "4R", name: UNTITLED_LAYER },
  ]);
});

test("ids without a group, and folders left empty by that, are dropped", () => {
  const order: LayerOrderItem[] = ["9R", { name: "Ghosts", order: ["8R"] }, "1R"];
  expect(buildLayerTree(order, name, has)).toEqual([
    { kind: "layer", id: "1R", name: "Background" },
  ]);
});

test("layerIds lists every layer through nested folders in order", () => {
  const tree = buildLayerTree(
    ["1R", { name: "A", order: ["2R", { name: "B", order: ["3R"] }] }],
    name,
    has,
  );
  expect(layerIds(tree)).toEqual(["1R", "2R", "3R"]);
});
