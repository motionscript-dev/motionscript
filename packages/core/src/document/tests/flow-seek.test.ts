import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { Rect } from "@/components/builtins/geometry/geometry";
import { evaluatorFor } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import { asProjectDocument } from "../project";
import { Registry } from "../registry";
import type { CompositionDocument, NodeSpec } from "../types";

const FPS = 30;
const VIEWPORT = { width: 400, height: 400 };
const catalog = () => new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });
const registry = new Registry();

function node(id: string, type: string, props: Record<string, unknown>, parent: string | null = null, order = 0): NodeSpec {
    return { id, type, parentId: parent, layerOrder: order, props };
}

function evaluatorOver(doc: CompositionDocument): StateEvaluator {
    return evaluatorFor(asProjectDocument(doc, { fps: FPS, viewport: VIEWPORT }), { registry, assets: catalog() });
}

/** Where the row's two tiles were laid out. */
function tiles(evaluator: StateEvaluator) {
    const row = evaluator.currentCanvas!.children.find((c): c is Rect => c instanceof Rect);
    return row!.children.map((c) => ({ ...c.layoutBounds }));
}

// A row that turns into a column over [1, 2].
const rowToColumn: CompositionDocument = {
    kind: "composition",
    nodes: [
        node("row", "rect", { flow: "horizontal", width: 200, height: 200 }),
        node("a", "rect", { width: 40, height: 40 }, "row", 0),
        node("b", "rect", { width: 40, height: 40 }, "row", 1),
    ],
    commands: [
        { id: "turn", type: "to", targetId: "row", at: 1, duration: 1, args: { flow: "vertical" } },
    ],
};

describe("a flow tween", () => {
    it("is undone by seeking back to before it, like every other prop", () => {
        const fresh = evaluatorOver(rowToColumn);
        fresh.stateAt(FPS / 2);                        // t = 0.5s, before the tween
        const before = tiles(fresh);

        const scrubbed = evaluatorOver(rowToColumn);
        scrubbed.stateAt(FPS + FPS / 2);               // t = 1.5s, halfway row → column
        expect(tiles(scrubbed)).not.toEqual(before);
        scrubbed.stateAt(FPS / 2);                     // and back to 0.5s

        expect(tiles(scrubbed)).toEqual(before);
    });

    it("lays out halfway between the two modes halfway through", () => {
        const at = (frame: number) => {
            const evaluator = evaluatorOver(rowToColumn);
            evaluator.stateAt(frame);
            return tiles(evaluator);
        };
        const row = at(0);
        const column = at(2 * FPS);
        const halfway = at(FPS + FPS / 2);
        expect(halfway.map((b) => b.x)).toEqual(row.map((b, i) => (b.x + column[i].x) / 2));
        expect(halfway.map((b) => b.y)).toEqual(row.map((b, i) => (b.y + column[i].y) / 2));
    });
});
