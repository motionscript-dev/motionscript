import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import { NullRenderContext } from "@/render/null-render-context";
import { AssetDeclaration } from "@/assets/scope";
import { ManifestAssetCatalog } from "@/assets/catalog";
import { Fills } from "@/attributes/shape/fill/chain";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { declareTree } from "@/components/trees/node/node-walk";
import { applyEditorStates } from "@/components/trees/node/node-editor-state";
import { collectBoxes, pickNode } from "@/runtime/node-picking";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";

/**
 * `hidden` and `locked`, which arrive as a record over the tree rather than as
 * props. What is being pinned here is the *difference* between them: hiding
 * removes a node from the picture and from the flow, locking removes it from the
 * pointer and from nothing else.
 */

class PaintingContext extends NullRenderContext {
    override readonly drawsVisibleOnly = true;
    draws = 0;
    protected override drawGraphics(): void {
        this.draws++;
    }
}

/** How many drawings `node` and its subtree hand the renderer in one pass. */
function drawsOf(node: { render(ctx: PaintingContext): void }): number {
    const ctx = new PaintingContext();
    node.render(ctx);
    return ctx.draws;
}

function laidOut(node: Rect): Rect {
    node.attach(attachScope());
    node.layout({ x: 0, y: 0, width: 200, height: 200 }, {
        measureText: () => ({ width: 0, height: 0 }),
    } as never);
    return node;
}

describe("hidden", () => {
    it("is not drawn, and takes its subtree with it", () => {
        const root = new Rect({ width: 100, height: 100 });
        const node = new Rect({ key: "a", width: 10, height: 10 });
        node.add(new Rect({ width: 5, height: 5 }));
        root.add(node);
        laidOut(root);
        applyEditorStates(root, { a: { hidden: true } });

        // One op: the root's own. Neither the hidden node nor its child.
        expect(drawsOf(root)).toBe(1);
    });

    it("still declares its assets", () => {
        // Same rule as the opacity skip beside it: a node hidden now and shown in
        // a moment must already have its picture, or the frame it comes back on
        // renders blank.
        const node = new Rect({
            key: "a",
            width: 10,
            height: 10,
            fill: Fills.image("photo.png"),
        });
        laidOut(node);
        applyEditorStates(node, { a: { hidden: true } });

        const declaration = new AssetDeclaration(new ManifestAssetCatalog({
            image: { "photo.png": { src: "photo.png", width: 8, height: 8, sizeBytes: 0 } },
            video: {}, audio: {}, font: {},
        }));
        declareTree(node, declaration);

        expect(declaration.declarations.get("photo.png")?.type).toBe("image");
    });

    it("gives up its layout slot rather than leaving a hole", () => {
        const hugRow = (hide: boolean): Rect => {
            const row = new Rect({
                width: "hug",
                height: "hug",
                flow: "horizontal",
                gap: 10,
                children: [
                    new Rect({ key: "a", width: 100, height: 50 }),
                    new Rect({ key: "b", width: 100, height: 50 }),
                ],
            } as never);
            row.attach(attachScope());
            applyEditorStates(row, hide ? { a: { hidden: true } } : {});
            return row;
        };

        expect(hugRow(false).flowChildren()).toHaveLength(2);
        expect(hugRow(true).flowChildren()).toHaveLength(1);

        // 2 x 100 + one 10px gap, against one child and no gap: the hidden node
        // takes its cell *and* the gap beside it, which is `display: none`
        // rather than `visibility: hidden`.
        const measured = (row: Rect): number | undefined =>
            row.measure({ maxWidth: 1000, maxHeight: 1000 }, new FakeMeasureContext()).width;
        expect(measured(hugRow(false))).toBe(210);
        expect(measured(hugRow(true))).toBe(100);
    });

    it("stays in the tree, so its siblings keep their paths", () => {
        const root = new Rect({ width: 200, height: 200 });
        const a = new Rect({ key: "a", width: 10, height: 10 });
        const b = new Rect({ key: "b", width: 10, height: 10 });
        root.add([a, b]);
        laidOut(root);

        const pathOf = (key: string): string | undefined => {
            const out: { path: string; id: string }[] = [];
            collectBoxes(root, "", out as never, true);
            const target = key === "a" ? a : b;
            return out.find((box) => box.id === target.id)?.path;
        };
        const bBefore = pathOf("b");

        applyEditorStates(root, { a: { hidden: true } });
        // `b` is still the second slot. Dropping `a` from the tree instead would
        // renumber it to the first, which is what put a host's gizmo on the wrong
        // node.
        expect(bBefore).toBe("1");
        expect(pathOf("b")).toBe("1");
    });
});

describe("locked", () => {
    it("is not the answer to a pick, but still draws", () => {
        const root = new Rect({ width: 200, height: 200 });
        const node = new Rect({ key: "a", width: 100, height: 100 });
        root.add(node);
        laidOut(root);
        applyEditorStates(root, { a: { locked: true } });

        expect(pickNode(root, { x: 0, y: 0 })).toBeNull();
        expect(drawsOf(root)).toBe(2);
    });

    it("keeps its box, carrying the flag", () => {
        const root = new Rect({ width: 200, height: 200 });
        const node = new Rect({ key: "a", width: 100, height: 100 });
        root.add(node);
        laidOut(root);
        applyEditorStates(root, { a: { locked: true } });

        const out: { locked: boolean }[] = [];
        collectBoxes(root, "", out as never, true);
        // A host still has to outline one selected from its layer tree.
        expect(out).toHaveLength(1);
        expect(out[0].locked).toBe(true);
    });
});

describe("the record is the whole truth", () => {
    it("un-hides a node whose key it stops mentioning", () => {
        const root = new Rect({ width: 200, height: 200 });
        const node = new Rect({ key: "a", width: 10, height: 10 });
        root.add(node);
        laidOut(root);

        applyEditorStates(root, { a: { hidden: true } });
        expect(node.hidden).toBe(true);
        applyEditorStates(root, {});
        expect(node.hidden).toBe(false);
    });
});
