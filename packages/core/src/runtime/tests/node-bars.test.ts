import { describe, expect, it } from "vitest";

import { Registry } from "@/document/registry";
import type { CompositionDocument } from "@/document/types";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { Node } from "@/components/trees/node/node";
import { nodePath, type TreeState } from "@/project/tree";
import { ClipInstance } from "@/runtime/clip-instance";
import { documentKeyTimes } from "@/runtime/clip-snapshot.fixtures";
import { comp, FPS, node, openController, project, runtimeScope, track } from "@/runtime/document.fixtures";
import { frameTime, spanFrames, trackFrameCount } from "@/runtime/placement";
import { generated } from "@/components/factory/tests/generated.fixtures";

interface Bar {
    startFrame: number;
    endFrame: number;
}

/** A rect that builds a child of its own, the way a composite does. */
class Card extends generated(Rect) {
    constructor(...args: ConstructorParameters<typeof Rect>) {
        super(...args);
        this.add(new Rect({ width: 4, height: 4 }));
    }
}

const registry = () => new Registry({ nodes: { card: Card as never } });
const box = (id: string, parentId: string | null = null, layerOrder = 0) =>
    node(id, "rect", { width: 10, height: 10 }, parentId, layerOrder);

/** Nested, composite and late nodes, none of which moves an earlier sibling's index. */
function steadyDoc(): CompositionDocument {
    return comp([
        box("a"),
        { ...box("child", "a"), startAt: 0.3, endAt: 0.8 },
        node("card", "card", { width: 20, height: 20 }, null, 1),
        { ...box("q", null, 2), startAt: 0.2, endAt: 0.6 },
    ], [{ target: "a", args: { x: 40 }, duration: 0.5 }], 1);
}

/** `b` enters while `a` is still there, and slides into `a`'s index when it leaves. */
function shiftingDoc(): CompositionDocument {
    return comp([
        { ...box("a"), endAt: 0.5 },
        { ...box("b", null, 1), startAt: 0.3 },
    ], [], 1);
}

/**
 * The lifespans the discovery pass used to sample, verbatim: key-time intervals,
 * each observed at both ends, keyed by structural path.
 */
function sampledLifespans(doc: CompositionDocument, duration: number): Map<string, Bar> {
    const instance = new ClipInstance(doc, duration, runtimeScope({ registry: registry() }));
    const frameCount = trackFrameCount(duration, FPS);
    const out = new Map<string, Bar>();
    const record = (n: Node, path: string, from: number, to: number): void => {
        const existing = out.get(path);
        if (existing) existing.endFrame = Math.max(existing.endFrame, to);
        else out.set(path, { startFrame: from, endFrame: to });
        n._allChildren.forEach((child, i) => record(child, nodePath(path, i), from, to));
    };
    const at = (seconds: number) => {
        instance.attach(seconds);
        instance.evaluateAt(seconds);
    };
    try {
        instance.build();
        const last = frameCount - 1;
        const frameOf = (t: number) => Math.min(last, Math.max(0, Math.round(t * FPS)));
        const keys = documentKeyTimes(doc).filter((t) => t <= duration);
        for (let i = 0; i < keys.length - 1; i++) {
            const [startFrame, endFrame] = [frameOf(keys[i]), frameOf(keys[i + 1])];
            at(keys[i]);
            record(instance.canvas, "", startFrame, Math.max(startFrame, endFrame - 1));
            at(keys[i + 1]);
            record(instance.canvas, "", endFrame, endFrame);
        }
        return out;
    } finally {
        instance.dispose();
    }
}

/** Each present node's bar at `frame`, by the path it has there. */
function barsAt(instance: ClipInstance, frame: number, frameCount: number): Map<string, Bar | null> {
    const seconds = frameTime(frame, FPS, instance.duration);
    instance.attach(seconds);
    instance.evaluateAt(seconds);
    const bars = new Map<string, Bar | null>();
    instance.forEachOwner((_node, _owner, span, path) => bars.set(path, spanFrames(span, FPS, frameCount)));
    return bars;
}

describe("spanFrames", () => {
    it("covers a node present to the end through the last frame", () => {
        expect(spanFrames({ start: 0, end: Infinity }, 10, 10)).toEqual({ startFrame: 0, endFrame: 9 });
    });

    it("starts at the first frame whose time reaches the start, and ends before the end", () => {
        expect(spanFrames({ start: 0.25, end: 0.55 }, 10, 10)).toEqual({ startFrame: 3, endFrame: 5 });
        expect(spanFrames({ start: 0.2, end: 0.6 }, 10, 10)).toEqual({ startFrame: 2, endFrame: 5 });
    });

    it("covers nothing for an empty span or one past the clip", () => {
        expect(spanFrames({ start: 0.4, end: 0.4 }, 10, 10)).toBeNull();
        expect(spanFrames({ start: 1, end: Infinity }, 10, 10)).toBeNull();
        expect(spanFrames({ start: 0.31, end: 0.39 }, 10, 10)).toBeNull();
    });

    it("agrees with the evaluator's clock on every frame, however the boundary falls", () => {
        for (const fps of [24, 30, 60]) {
            const frameCount = 2 * fps;
            for (let a = 0; a <= frameCount; a++) {
                for (const nudge of [-1e-9, 0, 1e-9]) {
                    const span = { start: a / fps + nudge, end: (a + 7) / fps + nudge };
                    const bar = spanFrames(span, fps, frameCount);
                    for (let f = 0; f < frameCount; f++) {
                        const t = frameTime(f, fps, Infinity);
                        const inside = t >= span.start && t < span.end;
                        expect(bar !== null && f >= bar.startFrame && f <= bar.endFrame).toBe(inside);
                    }
                }
            }
        }
    });
});

describe("ClipInstance.spanOf", () => {
    it("answers a row's effective span, a composite child's parent's, and the clip for the root", () => {
        const doc = comp([
            { ...node("card", "card", { width: 20, height: 20 }), startAt: 0.2, endAt: 0.9 },
            { ...box("inner", "card"), startAt: 0.5 },
        ], [], 1);
        const instance = new ClipInstance(doc, 0.8, runtimeScope({ registry: registry() }));
        instance.build();
        instance.attach(0.6);
        instance.evaluateAt(0.6);

        const [card] = instance.canvas._allChildren;
        const [built, inner] = card._allChildren;
        expect(instance.spanOf(instance.canvas)).toEqual({ start: 0, end: 0.8 });
        expect(instance.spanOf(card)).toEqual({ start: 0.2, end: 0.9 });
        expect(instance.spanOf(built)).toEqual({ start: 0.2, end: 0.9 });
        // Clipped by its parent's departure.
        expect(instance.spanOf(inner)).toEqual({ start: 0.5, end: 0.9 });
        expect(instance.spanOf(new Rect({}))).toBeUndefined();
        instance.dispose();
    });

    it("does not mistake a composite child carrying its parent's id for the row", () => {
        class Echo extends generated(Rect) {
            constructor(...args: ConstructorParameters<typeof Rect>) {
                super(...args);
                this.add(new Rect({ id: this.id, width: 4, height: 4 }));
            }
        }
        const doc = comp([{ ...node("echo", "echo", { width: 20, height: 20 }), startAt: 0.3 }], [], 1);
        const instance = new ClipInstance(doc, 1, runtimeScope({ registry: new Registry({ nodes: { echo: Echo as never } }) }));
        instance.build();
        instance.attach(0.5);
        instance.evaluateAt(0.5);

        const keys: string[] = [];
        instance.forEachOwner((_node, owner) => keys.push(owner));
        expect(keys).toEqual(["", "echo", "echo/0"]);
        instance.dispose();
    });
});

describe("ClipInstance.ownerKeyOf", () => {
    function built(doc: CompositionDocument, duration = 1) {
        const instance = new ClipInstance(doc, duration, runtimeScope({ registry: registry() }));
        instance.build();
        return instance;
    }

    it("is the row id for a node a document row built, and \"\" for the canvas", () => {
        const instance = built(steadyDoc());
        instance.attach(0);
        instance.evaluateAt(0);

        expect(instance.ownerKeyOf(instance.canvas)).toBe("");
        expect(instance.ownerKeyOf(instance.node("a")!)).toBe("a");
        expect(instance.ownerKeyOf(instance.node("card")!)).toBe("card");
        instance.dispose();
    });

    it("is the row id and the child indices below it for a node a composite built", () => {
        const instance = built(steadyDoc());
        instance.attach(0);
        instance.evaluateAt(0);

        const card = instance.node("card")!;
        expect(instance.ownerKeyOf(card._allChildren[0])).toBe("card/0");
        instance.dispose();
    });

    it("joins a deeper path with dots, below the row", () => {
        class Deep extends generated(Rect) {
            constructor(...args: ConstructorParameters<typeof Rect>) {
                super(...args);
                this.add(new Rect({ width: 4, height: 4 }));
                const second = new Rect({ width: 4, height: 4 });
                second.add(new Rect({ width: 2, height: 2 }));
                this.add(second);
            }
        }
        const instance = new ClipInstance(
            comp([node("deep", "deep", { width: 20, height: 20 })], [], 1), 1,
            runtimeScope({ registry: new Registry({ nodes: { deep: Deep as never } }) }),
        );
        instance.build();

        const deep = instance.node("deep")!;
        const leaf = deep._allChildren[1]._allChildren[0];
        expect(instance.ownerKeyOf(deep._allChildren[0])).toBe("deep/0");
        expect(instance.ownerKeyOf(deep._allChildren[1])).toBe("deep/1");
        expect(instance.ownerKeyOf(leaf)).toBe("deep/1.0");
        instance.dispose();
    });

    it("answers for a node that is not mounted: the key it will have once it arrives", () => {
        const instance = built(steadyDoc());
        // `q` enters at 0.2 s, so at time 0 it is built and not in the tree.
        instance.attach(0);
        instance.evaluateAt(0);

        const late = instance.node("q")!;
        expect(late.mounted).toBe(false);
        expect(instance.ownerKeyOf(late)).toBe("q");
        instance.dispose();
    });

    it("is undefined for a node no row built, and for the children of one", () => {
        const instance = built(steadyDoc());
        const orphan = new Rect({ width: 1, height: 1 });
        orphan.add(new Rect({ width: 1, height: 1 }));

        expect(instance.ownerKeyOf(orphan)).toBeUndefined();
        expect(instance.ownerKeyOf(orphan._allChildren[0])).toBeUndefined();
        instance.dispose();
    });

    it("agrees with the owner keys forEachOwner visits with", () => {
        const instance = built(steadyDoc());
        instance.attach(0);
        instance.evaluateAt(0);

        instance.forEachOwner((visited, key) => {
            expect(instance.ownerKeyOf(visited), key).toBe(key);
        });
        instance.dispose();
    });
});

describe("bars from spans", () => {
    it("match the sampled lifespans wherever no sibling index moves", () => {
        const doc = steadyDoc();
        const duration = 1;
        const frameCount = trackFrameCount(duration, FPS);
        const sampled = sampledLifespans(doc, duration);

        const instance = new ClipInstance(doc, duration, runtimeScope({ registry: registry() }));
        instance.build();
        const seen = new Set<string>();
        for (let frame = 0; frame < frameCount; frame++) {
            for (const [path, bar] of barsAt(instance, frame, frameCount)) {
                seen.add(path);
                expect({ frame, path, bar }).toEqual({ frame, path, bar: sampled.get(path) });
            }
        }
        expect([...seen].sort()).toEqual([...sampled.keys()].sort());
        instance.dispose();
    });

    it("keep a node's own bar when an earlier sibling leaves, where sampled paths mixed two nodes", () => {
        const doc = shiftingDoc();
        const frameCount = trackFrameCount(1, FPS);
        // `a` [0, 4] and `b` [3, 9] both sat at "0" at some point, so the path's
        // lifespan was their union.
        expect(sampledLifespans(doc, 1).get("0")).toEqual({ startFrame: 0, endFrame: 9 });

        const instance = new ClipInstance(doc, 1, runtimeScope());
        instance.build();
        expect(barsAt(instance, 2, frameCount).get("0")).toEqual({ startFrame: 0, endFrame: 4 });
        expect(barsAt(instance, 4, frameCount).get("1")).toEqual({ startFrame: 3, endFrame: 9 });
        expect(barsAt(instance, 7, frameCount).get("0")).toEqual({ startFrame: 3, endFrame: 9 });
        instance.dispose();
    });
});

describe("PlaybackController.getTreeState bars", () => {
    const bar = (state: TreeState) => ({ id: state.id, startFrame: state.startFrame, endFrame: state.endFrame });

    it("draws the node on screen with its own span after an earlier sibling leaves", async () => {
        const { controller } = openController(project([track("t", shiftingDoc(), { startAt: 1 })]));
        await controller.seek(17);

        const tree = controller.getTreeState()!;
        expect(tree.children.map(bar)).toEqual([{ id: "b", startFrame: 13, endFrame: 19 }]);
        controller.dispose();
    });

    it("gives a composite's own children their parent's bar", async () => {
        const doc = comp([{ ...node("card", "card", { width: 20, height: 20 }), startAt: 0.2, endAt: 0.7 }], [], 1);
        const { controller } = openController(project([track("t", doc)]), { registry: registry() });
        await controller.seek(4);

        const [card] = controller.getTreeState()!.children;
        expect(bar(card)).toEqual({ id: "card", startFrame: 2, endFrame: 6 });
        expect(card.children.map((c) => [c.startFrame, c.endFrame])).toEqual([[2, 6]]);
        controller.dispose();
    });

    it("clamps bars to a track that cuts its clip short", async () => {
        const doc = comp([{ ...box("late"), startAt: 0.5 }], [], 2);
        const { controller } = openController(project([track("t", doc, { startAt: 1, duration: 1 })]));
        await controller.seek(16);

        const tree = controller.getTreeState()!;
        expect([tree.startFrame, tree.endFrame]).toEqual([10, 19]);
        expect(tree.children.map(bar)).toEqual([{ id: "late", startFrame: 15, endFrame: 19 }]);
        controller.dispose();
    });
});
