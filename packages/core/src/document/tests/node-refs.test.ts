import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import { evaluatorFor, precompFor } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import { asProjectDocument } from "../project";
import { Registry } from "../registry";
import type { CompositionDocument, NodeSpec, VisualDocument } from "../types";

/**
 * `"=[card.x]"` — a prop following another node's prop, where a variable follows a
 * value nothing draws. The reference resolves at *read* time, which is the whole
 * difference: `build` binds in document order and `syncPresence` adds and removes
 * nodes as time moves, so the node named may not exist yet and a node that does
 * exist may be legitimately absent at *t*.
 */

const FPS = 30;
const VIEWPORT = { width: 200, height: 200 };

// The vocabulary this file's documents compile against. An engine builds
// one of these; a test builds its own, and nothing is shared between files.
const registry = new Registry();

/** One rect row. `key` is the handle an expression names it by; `id` addresses it. */
function node(id: string, props: Record<string, unknown>, key?: string, order = 0): NodeSpec {
    return { id, type: "rect", parentId: null, layerOrder: order, props, ...(key ? { key } : {}) };
}

const opened = (doc: VisualDocument) => asProjectDocument(doc, { fps: FPS, viewport: VIEWPORT });

function evaluatorOver(doc: VisualDocument): StateEvaluator {
    return evaluatorFor(opened(doc), { registry });
}

/** The rects, in document order — the readers and the read, side by side. */
function rects(evaluator: StateEvaluator): Rect[] {
    return evaluator.currentCanvas!.children.filter((c): c is Rect => c instanceof Rect);
}

describe("reading another node's prop", () => {
    it("resolves the key to that node's prop, arithmetic and all", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            nodes: [
                node("card", { width: 10, height: 10, x: 10 }, "card"),
                node("label", { width: 10, height: 10, x: "=[card.x]+20" }, undefined, 1),
            ],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator).map((r) => r.x)).toEqual([10, 30]);
    });

    it("hands a lone reference over untouched, so it can name a compound prop", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            nodes: [
                node("card", { width: 10, height: 10, padding: { top: 4 } }, "card"),
                node("label", { width: 10, height: 10, padding: "=[card.padding]" }, undefined, 1),
            ],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator)[1].padding).toEqual({ top: 4, left: 0, right: 0, bottom: 0 });
    });

    /**
     * The point of resolving late rather than at compile time: `build` binds in
     * document order, so a reader authored before what it reads has nothing to
     * resolve against yet.
     */
    it("resolves a node authored after the prop that reads it", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            nodes: [
                node("label", { width: 10, height: 10, x: "=[card.x]" }),
                node("card", { width: 10, height: 10, x: 42 }, "card", 1),
            ],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator)[0].x).toBe(42);
    });

    it("follows a tween on what it reads, with no command of its own", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            nodes: [
                node("card", { width: 10, height: 10, x: 0 }, "card"),
                node("label", { width: 10, height: 10, x: "=[card.x]*2" }, undefined, 1),
            ],
            commands: [
                { id: "slide", type: "to", targetId: "card", at: 0, duration: 1, args: { x: 50 } },
            ],
        });

        evaluator.stateAt(0);
        expect(rects(evaluator).map((r) => r.x)).toEqual([0, 0]);
        evaluator.stateAt(FPS / 2);
        expect(rects(evaluator).map((r) => r.x)).toEqual([25, 50]);
        evaluator.stateAt(FPS);
        expect(rects(evaluator).map((r) => r.x)).toEqual([50, 100]);
    });

    it("reaches the scene root, which is a row like any other", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            nodes: [
                { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: { zoom: 3 }, key: "scene" },
                node("label", { width: 10, height: 10, x: "=[scene.zoom]*5" }),
            ],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator)[0].x).toBe(15);
    });
});

/**
 * An absent node reads `undefined`: `NaN` through arithmetic — loud in the first
 * frame, where a silent `0` reads as a deliberate collapse — and an unset prop on
 * its own. Not a throw, because absence is a legitimate state: a node entering
 * at 2s would otherwise crash the frame at 0s.
 */
describe("a node that is not there", () => {
    const doc: CompositionDocument = {
        kind: "composition",
        duration: 3,
        nodes: [
            node("label", { width: 10, height: 10, x: "=[card.x]+1" }),
            { ...node("card", { width: 10, height: 10, x: 100 }, "card", 1), startAt: 1, endAt: 2 },
        ],
        commands: [],
    };

    it("is NaN before the node enters", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);
        expect(rects(evaluator)[0].x).toBeNaN();
    });

    it("is the node's prop while it is in the tree", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(FPS);
        expect(rects(evaluator).find((r) => r.width === 10)!.x).toBe(101);
    });

    it("is NaN again once the node leaves", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(FPS * 2);
        expect(rects(evaluator)[0].x).toBeNaN();
    });

    it("stays a pure function of time — reached backwards it agrees", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(FPS * 2);
        evaluator.stateAt(FPS);
        expect(rects(evaluator).find((r) => r.width === 10)!.x).toBe(101);
    });
});

describe("refusals", () => {
    /**
     * AssetTimeline records a throwing clip in `buildErrors` rather than letting it
     * escape — a host shows it in an errors panel — so that is where a refusal is
     * read from.
     */
    const buildError = (doc: CompositionDocument): string =>
        precompFor(opened(doc), { registry }).run().buildErrors.map((e) => e.message).join("\n");

    it("refuses a key nothing is keyed with, naming what a reference can be", () => {
        expect(buildError({
            kind: "composition",
            nodes: [node("label", { width: 10, height: 10, x: "=[ghost.x]" })],
            commands: [],
        })).toMatch(/"ghost\.x" resolves to nothing in this document.*\[key\.prop\]/s);
    });
});

/**
 * Two props reading each other. The cycle is a validation error
 * (`checkExpressionCycles`), and this is why it has to be: the runtime does not
 * crash on one. `PropSlot.get` refuses to re-enter and hands back the last value it
 * settled on, so a cycle renders a frame that quietly disagrees with the document
 * — which is exactly the failure a validator exists to turn into a message.
 */
describe("a cycle", () => {
    it("settles rather than recursing", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            nodes: [
                node("a", { width: 10, height: 10, x: "=[b.y]" }, "a"),
                node("b", { width: 10, height: 10, y: "=[a.x]" }, "b", 1),
            ],
        });
        expect(() => evaluator.stateAt(0)).not.toThrow();
        expect(rects(evaluator)[0].x).toBe(0);
    });
});

/**
 * A lone reference hands the value over untouched, so a node that is not there
 * hands over `undefined` and the prop is left holding it. No arithmetic turns it
 * into `NaN`, and nothing throws.
 */
describe("a lone reference to a node that is not there", () => {
    const doc: CompositionDocument = {
        kind: "composition",
        duration: 3,
        nodes: [
            node("label", { width: 10, height: 10, x: "=[card.x]", opacity: "=[card.opacity]", fill: "=[card.fill]" }),
            { ...node("card", { width: 10, height: 10, x: 100, opacity: 0.5, fill: "#ff0000" }, "card", 1), startAt: 1, endAt: 2 },
        ],
        commands: [],
    };
    const label = (evaluator: StateEvaluator) => rects(evaluator).find((r) => r.id === "label")!;

    it("leaves a numeric prop undefined, with no fallback to its default", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);
        expect(label(evaluator).x).toBeUndefined();
        expect(label(evaluator).opacity).toBeUndefined();
    });

    it("leaves a fill with no layers", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);
        expect(label(evaluator).fill).toEqual([]);
    });

    it("takes the node's own value while it is in the tree", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(FPS + 5);
        expect(label(evaluator).x).toBe(100);
        expect(label(evaluator).opacity).toBe(0.5);
        expect((label(evaluator).fill as unknown[]).length).toBe(1);
    });

    it("goes back to undefined once the node leaves, and again when the playhead returns", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(FPS * 2 + 5);
        expect(label(evaluator).x).toBeUndefined();
        evaluator.stateAt(FPS + 5);
        expect(label(evaluator).x).toBe(100);
        evaluator.stateAt(0);
        expect(label(evaluator).x).toBeUndefined();
    });

    /**
     * A mapped prop cannot hold `undefined`: its readers dereference the stored form
     * (`padding.left`), so the build used to throw on the first read of the binding,
     * at t=0 for a node that enters at 1s. It holds what a node built without the
     * prop holds until the node is there.
     */
    describe("behind a mapper", () => {
        const mapped: CompositionDocument = {
            kind: "composition",
            duration: 3,
            nodes: [
                node("label", { width: 10, height: 10, padding: "=[card.padding]", cornerRadius: "=[card.cornerRadius]" }),
                { ...node("card", { width: 10, height: 10, padding: 6, cornerRadius: 4 }, "card", 1), startAt: 1, endAt: 2 },
            ],
            commands: [],
        };
        const buildErrors = () =>
            precompFor(opened(mapped), { registry }).run().buildErrors.map((e) => e.message);
        const ZERO = { left: 0, right: 0, top: 0, bottom: 0 };
        const SIX = { left: 6, right: 6, top: 6, bottom: 6 };
        const reads = (evaluator: StateEvaluator) => {
            const rect = label(evaluator);
            return { padding: rect.padding, cornerRadius: rect.cornerRadius };
        };

        it("builds", () => {
            expect(buildErrors()).toEqual([]);
        });

        it("holds the prop's default while the node is not there", () => {
            const evaluator = evaluatorOver(mapped);
            evaluator.stateAt(0);
            expect(reads(evaluator)).toEqual({
                padding: ZERO,
                cornerRadius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
            });
        });

        it("takes the node's own value while it is in the tree, and the default again once it leaves", () => {
            const evaluator = evaluatorOver(mapped);
            evaluator.stateAt(FPS + 5);
            expect(reads(evaluator)).toEqual({
                padding: SIX,
                cornerRadius: { topLeft: 4, topRight: 4, bottomLeft: 4, bottomRight: 4 },
            });
            evaluator.stateAt(FPS * 2 + 5);
            expect(reads(evaluator).padding).toEqual(ZERO);
        });

        it("stays a pure function of time — reached from either side it agrees", () => {
            const evaluator = evaluatorOver(mapped);
            evaluator.stateAt(FPS + 5);
            evaluator.stateAt(0);
            expect(reads(evaluator).padding).toEqual(ZERO);
            evaluator.stateAt(FPS + 5);
            expect(reads(evaluator).padding).toEqual(SIX);
        });
    });
});
