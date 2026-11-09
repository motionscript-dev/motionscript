import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { Text } from "@/components/builtins/text/text";
import { observeSlots } from "@/props/observer";
import { TimelineClip } from "@/runtime/clip-snapshot.fixtures";
import { evaluatorFor, precompFor, runtimeScope } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import { asProjectDocument } from "../project";
import { Registry } from "../registry";
import type { CompositionDocument, NodeSpec, VisualDocument, StillDocument } from "../types";

const FPS = 30;
const VIEWPORT = { width: 200, height: 200 };
const catalog = () => new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });

// The vocabulary this file's documents compile against. An engine builds
// one of these; a test builds its own, and nothing is shared between files.
const registry = new Registry();
// A custom ease no standard family expresses — squares `t`, distinct from
// every built-in curve — for the `{ kind: "custom" }` test below.
registry.addEase("square", (t) => t * t);

function node(id: string, type: string, props: Record<string, unknown>, parent: string | null = null, order = 0): NodeSpec {
    return { id, type, parentId: parent, layerOrder: order, props };
}

/** The scene root row, as a `NodeSpec`. */
function root(props: Record<string, unknown>): NodeSpec {
    return { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props };
}

/** A lone document, opened the way a session opens one: the only track of a project. */
const opened = (doc: VisualDocument) => asProjectDocument(doc, { fps: FPS, viewport: VIEWPORT });

function evaluatorOver(doc: VisualDocument): StateEvaluator {
    return evaluatorFor(opened(doc), { registry, assets: catalog() });
}

function precompOver(doc: VisualDocument) {
    return precompFor(opened(doc), { registry, assets: catalog() }).run();
}

/** The `Rect`s directly under the clip root, by node order. */
function rects(evaluator: StateEvaluator): Rect[] {
    return evaluator.currentCanvas!.children.filter((c): c is Rect => c instanceof Rect);
}

describe("still documents", () => {
    const doc: StillDocument = {
        kind: "still",
        nodes: [
            root({ fill: "#101014" }),
            node("card", "rect", { width: 100, height: 60, x: 10 }),
            node("title", "text", { text: "hello", fontSize: 20 }, "card", 0),
        ],
    };

    it("builds the tree its rows describe, parented and ordered", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);

        const [card] = rects(evaluator);
        expect(card).toBeDefined();
        expect(card.x).toBe(10);
        expect(card.children[0]).toBeInstanceOf(Text);
    });

    it("measures as a single frame", () => {
        const precomp = precompOver(doc);
        expect(precomp.totalFrames).toBe(1);
        expect(precomp.tracks[0].frameCount).toBe(1);
        expect(precomp.buildErrors).toEqual([]);
    });

    it("builds into a viewport-sized Canvas2D that lays its children out freeform", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);

        const canvas = evaluator.currentCanvas!;
        expect(canvas).toBeInstanceOf(Canvas2D);
        expect([canvas.width, canvas.height]).toEqual([VIEWPORT.width, VIEWPORT.height]);
        expect(canvas.flow).toBe("freeform");
    });

    it("applies the root row to that canvas rather than adding it as a child", () => {
        const evaluator = evaluatorOver(doc);
        evaluator.stateAt(0);
        expect(evaluator.currentCanvas!.fill).toHaveLength(1);
        expect(evaluator.currentCanvas!.children).toHaveLength(1);

        const bare = evaluatorOver({ kind: "still", nodes: [root({ fill: "red", zoom: 2, heading: 45 })] });
        bare.stateAt(0);
        expect(bare.currentCanvas!.children).toHaveLength(0);
        expect(bare.currentCanvas!.fill).toHaveLength(1);
        expect(bare.currentCanvas!.zoom).toBe(2);
        expect(bare.currentCanvas!.heading).toBe(45);
    });

    it("orders siblings by `order`, not by array position", () => {
        const evaluator = evaluatorOver({
            kind: "still",
            nodes: [
                node("b", "rect", { width: 1, height: 1, x: 2 }, null, 1),
                node("a", "rect", { width: 1, height: 1, x: 1 }, null, 0),
            ],
        });
        evaluator.stateAt(0);
        expect(rects(evaluator).map((r) => r.x)).toEqual([1, 2]);
    });
});

describe("composition documents", () => {
    /** A rect that slides 0 → 90 over [0,1], then fades 1 → 0 over [1,2]. */
    const slideThenFade: CompositionDocument = {
        kind: "composition",
        nodes: [node("box", "rect", { width: 10, height: 10, x: 0, opacity: 1 })],
        commands: [
            { id: "slide", type: "to", targetId: "box", at: 0, duration: 1, args: { x: 90 } },
            { id: "fade", type: "to", targetId: "box", at: 1, duration: 1, args: { opacity: 0 } },
        ],
    };

    it("derives its duration from the last command's end", () => {
        // 2s at 30fps.
        expect(precompOver(slideThenFade).totalFrames).toBe(60);
    });

    it("carries a path through a `moveTo`'s args, walked by arc length", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            nodes: [node("box", "rect", { width: 1, height: 1 })],
            commands: [
                {
                    id: "m", type: "moveTo", targetId: "box", at: 0, duration: 2,
                    args: { path: "M 0 0 L 300 0 L 300 100" },
                },
            ],
        });

        evaluator.stateAt(FPS);  // t = 1s, half the arc length in
        expect(rects(evaluator)[0].x).toBeCloseTo(200, 3);
        expect(rects(evaluator)[0].y).toBeCloseTo(0, 3);

        evaluator.stateAt(2 * FPS);
        expect(rects(evaluator)[0].x).toBeCloseTo(300, 3);
        expect(rects(evaluator)[0].y).toBeCloseTo(100, 3);
    });

    it("carries a `moveTo` onto another node's anchor, resolved where that node is at the move's start", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            nodes: [
                node("card", "rect", { width: 40, height: 20, x: 60, y: 40 }),
                node("box", "rect", { width: 1, height: 1 }, null, 1),
            ],
            commands: [
                { id: "slide", type: "to", targetId: "card", at: 0, duration: 1, args: { x: -60 } },
                {
                    id: "m", type: "moveTo", targetId: "box", at: 1, duration: 1,
                    args: { target: "card", targetAnchor: "topLeft" },
                },
            ],
        });

        evaluator.stateAt(2 * FPS);
        const box = rects(evaluator).find((r) => r.id === "box")!;
        expect(box.x).toBeCloseTo(-80, 3);
        expect(box.y).toBeCloseTo(50, 3);
    });

    it("honours an explicit duration that holds past the last command", () => {
        expect(precompOver({ ...slideThenFade, duration: 3 }).totalFrames).toBe(90);
    });

    it("chains: a command starts from where the previous one left the node", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            nodes: [node("box", "rect", { width: 1, height: 1, x: 0 })],
            commands: [
                { id: "s1", type: "to", targetId: "box", at: 0, duration: 1, args: { x: 50 } },
                { id: "s2", type: "to", targetId: "box", at: 1, duration: 1, args: { x: 80 } },
            ],
        });

        evaluator.stateAt(FPS);           // t = 1s, end of the first leg
        expect(rects(evaluator)[0].x).toBeCloseTo(50, 3);

        evaluator.stateAt(FPS + FPS / 2); // t = 1.5s, halfway through the second
        expect(rects(evaluator)[0].x).toBeCloseTo(65, 3);
    });

    it("resolves a `custom` easing through the registry, distinct from linear", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            nodes: [node("box", "rect", { width: 1, height: 1, x: 0 })],
            commands: [
                {
                    id: "s", type: "to", targetId: "box", at: 0, duration: 1,
                    easing: { kind: "custom", args: "square" }, args: { x: 100 },
                },
            ],
        });

        // The registered ease squares t, so halfway through is a quarter of the
        // way there — well short of the 50% a linear tween would show.
        evaluator.stateAt(FPS / 2);
        expect(rects(evaluator)[0].x).toBeCloseTo(25, 3);
    });

    it("reports a clear build error for an unregistered custom easing key", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [node("box", "rect", { width: 1, height: 1 })],
            commands: [
                {
                    id: "s", type: "to", targetId: "box", at: 0, duration: 1,
                    easing: { kind: "custom", args: "never-registered" }, args: { x: 100 },
                },
            ],
        };
        const message = precompOver(doc).buildErrors[0]?.message ?? "";
        expect(message).toMatch(/No ease registered under "never-registered"/);
    });

    /**
     * The property the whole model exists for: a frame is a function of its
     * time, not of the route the playhead took to reach it.
     */
    it("evaluates the same frame identically walked forwards, jumped to, or reached backwards", () => {
        const walked = evaluatorOver(slideThenFade);
        const jumped = evaluatorOver(slideThenFade);
        const backwards = evaluatorOver(slideThenFade);

        const target = 20; // frame 20 of 60

        for (let f = 0; f <= target; f++) walked.stateAt(f);
        jumped.stateAt(target);
        backwards.stateAt(59);
        backwards.stateAt(target);

        const read = (evaluator: StateEvaluator) => {
            const r = rects(evaluator)[0];
            return { x: r.x, opacity: r.opacity };
        };
        expect(read(jumped)).toEqual(read(walked));
        expect(read(backwards)).toEqual(read(walked));
    });

    it("holds a finished command at its end value rather than dropping it", () => {
        const evaluator = evaluatorOver(slideThenFade);
        evaluator.stateAt(59); // well past the slide, mid-fade

        // `x` was written by a command that finished at 1s and is never touched
        // again; it must still read 90 rather than falling back to its authored 0.
        expect(rects(evaluator)[0].x).toBeCloseTo(90, 3);
    });

    it("does not leak a not-yet-started command's value backwards", () => {
        const evaluator = evaluatorOver(slideThenFade);

        evaluator.stateAt(59);  // run to the end first
        evaluator.stateAt(0);   // then back to the very start

        expect(rects(evaluator)[0].x).toBeCloseTo(0, 3);
        expect(rects(evaluator)[0].opacity).toBeCloseTo(1, 3);
    });
});

describe("presence", () => {
    const doc: CompositionDocument = {
        kind: "composition",
        duration: 3,
        nodes: [
            { ...node("early", "rect", { width: 1, height: 1 }), endAt: 2 },
            { ...node("late", "rect", { width: 1, height: 1 }, null, 1), startAt: 1 },
        ],
        commands: [],
    };

    it("adds and removes nodes at the spans the document declares", () => {
        const evaluator = evaluatorOver(doc);

        evaluator.stateAt(0);
        expect(rects(evaluator)).toHaveLength(1);

        evaluator.stateAt(FPS + 5);   // past 1s: both present
        expect(rects(evaluator)).toHaveLength(2);

        evaluator.stateAt(2 * FPS + 5); // past 2s: `early` gone
        expect(rects(evaluator)).toHaveLength(1);
    });

    it("computes presence from the document, so a backward seek restores it", () => {
        const evaluator = evaluatorOver(doc);

        evaluator.stateAt(2 * FPS + 5);
        expect(rects(evaluator)).toHaveLength(1);

        evaluator.stateAt(FPS + 5);
        expect(rects(evaluator)).toHaveLength(2);

        evaluator.stateAt(0);
        expect(rects(evaluator)).toHaveLength(1);
    });

    it("measures the clip to a node's departure when nothing declares a duration", () => {
        const { duration: _duration, ...undeclared } = doc;
        expect(precompOver(undeclared).totalFrames).toBe(2 * FPS);
    });

    /** A tween built against the t=0 tree would find its late target unmounted and never move. */
    it("animates a node that enters after the clip starts", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            duration: 3,
            nodes: [{ ...node("late", "rect", { width: 10, height: 10, x: 0 }), startAt: 1 }],
            commands: [{ id: "slide", type: "to", targetId: "late", at: 1.5, duration: 1, args: { x: 100 } }],
        });

        evaluator.stateAt(2 * FPS); // t = 2s, halfway through the slide
        expect(rects(evaluator)[0].x).toBeCloseTo(50, 3);

        evaluator.stateAt(3 * FPS);
        expect(rects(evaluator)[0].x).toBeCloseTo(100, 3);

        evaluator.stateAt(FPS + FPS / 2); // back to the slide's own start
        expect(rects(evaluator)[0].x).toBeCloseTo(0, 3);
    });

    it("keeps a late node's tween chained onto the one before it", () => {
        const evaluator = evaluatorOver({
            kind: "composition",
            duration: 4,
            nodes: [{ ...node("late", "rect", { width: 10, height: 10, x: 0 }), startAt: 1 }],
            commands: [
                { id: "a", type: "to", targetId: "late", at: 1, duration: 1, args: { x: 40 } },
                { id: "b", type: "to", targetId: "late", at: 2, duration: 1, args: { x: 80 } },
            ],
        });

        evaluator.stateAt(2 * FPS + FPS / 2);
        expect(rects(evaluator)[0].x).toBeCloseTo(60, 3);
    });
});

describe("retired command types", () => {
    it("names `endAt` when a `remove` reaches a node type without one", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [node("box", "rect", { width: 1, height: 1 })],
            commands: [{ id: "r", type: "remove", targetId: "box", at: 1, args: {} }],
        };
        expect(precompOver(doc).buildErrors[0]?.message ?? "").toMatch(/leaves at its `endAt`/);
    });
});

describe("a command whose targetId names no row", () => {
    const missing = (type: string, args: Record<string, unknown> = {}): CompositionDocument => ({
        kind: "composition",
        nodes: [root({}), node("a", "rect", { width: 10, height: 10 })],
        commands: [{ id: "c1", type, targetId: "ghost", at: 0, duration: 1, args }],
    });

    // `to`/`set`/`save` come from the global table, `moveTo` from the node type's own.
    it.each([
        ["to", { x: 5 }],
        ["set", { x: 5 }],
        ["save", {}],
        ["moveTo", {}],
    ])("fails %s with one error naming the target, not the node type", (type, args) => {
        const message = precompOver(missing(type, args)).buildErrors[0]?.message ?? "";
        expect(message).toMatch(/Command c1 \("[A-Za-z]+"\) targets node "ghost", which this document does not declare/);
        expect(message).not.toMatch(/Node type/);
    });
});

/** The `ClipTimeline` itself, built the way the runtime builds one. */
describe("ClipTimeline", () => {
    const row = (id: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
        ({ ...node(id, "rect", { width: 20, height: 20, ...props }), ...extra });
    const move = (id: string, targetId: string, at: number, args: Record<string, unknown>, duration = 1) =>
        ({ id, type: "to", targetId, at, duration, args });

    const clipOver = (doc: CompositionDocument | StillDocument, reg: Registry = registry): TimelineClip => {
        const clip = new TimelineClip(doc, runtimeScope({ registry: reg }));
        clip.build();
        return clip;
    };
    const live = <N extends object>(clip: TimelineClip, id: string): N => clip.timeline.liveNode(id) as unknown as N;

    describe("duration", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            nodes: [row("a")],
            commands: [move("m", "a", 1, { x: 5 }, 2)],
        };

        it("is known before the timeline is built, from the document alone", () => {
            const clip = new TimelineClip(doc, runtimeScope({ registry }));
            expect(clip.timeline.duration).toBe(3);
        });

        it("follows a declared duration over what the commands imply", () => {
            expect(new TimelineClip({ ...doc, duration: 9 }, runtimeScope({ registry })).timeline.duration).toBe(9);
        });

        it("is zero for a still", () => {
            expect(new TimelineClip({ kind: "still", nodes: [row("a")] }, runtimeScope({ registry })).timeline.duration).toBe(0);
        });

        it("changes with the document an update moves it to", () => {
            const clip = clipOver(doc);
            const next: CompositionDocument = { ...doc, commands: [move("m", "a", 1, { x: 5 }, 5)] };
            expect(clip.update(next)).not.toBeNull();
            expect(clip.timeline.duration).toBe(6);
        });
    });

    describe("times outside the clip", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            duration: 4,
            nodes: [row("a", { x: 0 }), row("late", { x: 0 }, { startAt: 1, endAt: 3 })],
            commands: [move("t", "a", 0, { x: 100 }), move("u", "late", 1.5, { x: 50 })],
        };

        it("has nothing present, and nothing moving, before 0", () => {
            const clip = clipOver(doc);
            clip.seek(2);
            for (const t of [-5, -0.001]) {
                clip.seek(t);
                expect(live<Rect>(clip, "a").mounted).toBe(false);
                expect(live<Rect>(clip, "a").x).toBe(0);
                expect(clip.canvas._allChildren).toHaveLength(0);
            }
        });

        it("brings the nodes back at 0 after a negative time", () => {
            const clip = clipOver(doc);
            clip.seek(-1);
            clip.seek(0);
            expect(live<Rect>(clip, "a").mounted).toBe(true);
            expect(clip.canvas._allChildren).toHaveLength(1);
        });

        it("holds every finished command at its end past the last frame", () => {
            const clip = clipOver(doc);
            for (const t of [4, 10, 1e9]) {
                clip.seek(t);
                expect(live<Rect>(clip, "a").x).toBe(100);
                // `late` left at 3s and stays gone, holding what it had reached.
                expect(live<Rect>(clip, "late").mounted).toBe(false);
                expect(live<Rect>(clip, "late").x).toBe(50);
            }
        });

        it("gives the same frame for any two times past the end", () => {
            const clip = clipOver(doc);
            clip.seek(4);
            const at4 = live<Rect>(clip, "a").x;
            clip.seek(40);
            expect(live<Rect>(clip, "a").x).toBe(at4);
        });
    });

    describe("evaluateAt and presence", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            duration: 4,
            nodes: [row("late", { x: 0 }, { startAt: 1 })],
            commands: [move("u", "late", 1.5, { x: 50 })],
        };

        it("writes props but leaves the tree as syncPresence left it", () => {
            const clip = clipOver(doc);
            clip.attach(2);
            clip.timeline.evaluateAt(2);

            const late = live<Rect>(clip, "late");
            expect(late.mounted).toBe(false);
            expect(clip.canvas._allChildren).toHaveLength(0);
            expect(late.x).toBe(25);
        });

        it("is the caller's syncPresence that brings the node in", () => {
            const clip = clipOver(doc);
            clip.attach(2);
            expect(clip.timeline.syncPresence(2)).toBe(true);
            expect(live<Rect>(clip, "late").mounted).toBe(true);
            expect(clip.timeline.syncPresence(2)).toBe(false);
            clip.timeline.evaluateAt(2);
            expect(live<Rect>(clip, "late").x).toBe(25);
        });
    });

    describe("a command on a node that is not mounted at its `at`", () => {
        // A validator would refuse the document; the timeline still builds it.
        const doc: CompositionDocument = {
            kind: "composition",
            duration: 4,
            nodes: [row("later", { x: 7 }, { startAt: 2 })],
            commands: [move("t", "later", 0, { x: 100 })],
        };

        it("takes its time and writes nothing, before and after the node arrives", () => {
            const clip = clipOver(doc);
            const [placed] = clip.timeline.placedCommands();
            expect([placed.start, placed.duration, placed.writes.size]).toEqual([0, 1, 0]);

            for (const t of [0, 0.5, 1, 2, 3]) {
                clip.seek(t);
                expect(live<Rect>(clip, "later").x).toBe(7);
            }
        });
    });

    describe("a build that cannot proceed", () => {
        it("throws for a node type a strict registry does not know, naming the row", () => {
            const doc: CompositionDocument = {
                kind: "composition",
                nodes: [{ ...row("a"), type: "ghost" }],
                commands: [],
            };
            const clip = new TimelineClip(doc, runtimeScope({ registry: new Registry({ strict: true }) }));
            expect(() => clip.build()).toThrow(/Unknown node type "ghost" \(node a\)\. This registry knows: /);
        });

        it("builds a placeholder for one a lenient registry does not know, and says so", () => {
            const doc: CompositionDocument = {
                kind: "composition",
                nodes: [{ ...row("a"), type: "ghost" }],
                commands: [],
            };
            const clip = new TimelineClip(doc, runtimeScope({ registry }));
            clip.build();
            expect(clip.timeline.issues().map((i) => [i.code, i.nodeId, i.type])).toEqual([["unknown-node-type", "a", "ghost"]]);
        });

        it("throws for a variable declared twice", () => {
            const doc: CompositionDocument = {
                kind: "composition",
                nodes: [row("a")],
                commands: [],
                variables: [{ id: "g", value: 1 }, { id: "g", value: 2 }],
            };
            expect(() => new TimelineClip(doc, runtimeScope({ registry })).build())
                .toThrow(/Duplicate variable id "g"\. Ids must be unique/);
        });

        it("throws for a lerp the registry does not hold, naming the variable", () => {
            const doc: CompositionDocument = {
                kind: "composition",
                nodes: [row("a")],
                commands: [],
                variables: [{ id: "g", value: 1, lerp: "bezier" }],
            };
            expect(() => new TimelineClip(doc, runtimeScope({ registry })).build())
                .toThrow(/Unknown variable lerp "bezier" \(variable "g"\)/);
        });
    });

    // Nothing guards a second `build` or `compile`. A second `compile` doubles the
    // placed commands, and a second `build` leaves the tree on the first build's nodes.
    it.todo("fails loudly on a second build or compile, naming the cause");

    describe("rows with no usable span", () => {
        it("never mounts a row whose end is not after its start", () => {
            const clip = clipOver({
                kind: "composition",
                duration: 4,
                nodes: [row("empty", {}, { startAt: 2, endAt: 2 }), row("inverted", {}, { startAt: 3, endAt: 1 }), row("ok")],
                commands: [move("t", "empty", 2, { x: 5 })],
            });
            for (const t of [0, 1, 2, 2.5, 3, 4]) {
                clip.seek(t);
                expect(live<Rect>(clip, "empty").mounted).toBe(false);
                expect(live<Rect>(clip, "inverted").mounted).toBe(false);
                expect(live<Rect>(clip, "ok").mounted).toBe(true);
                expect(clip.canvas._allChildren).toHaveLength(1);
            }
        });
    });

    describe("a node that leaves and comes back", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            duration: 5,
            nodes: [row("a", { x: 0 }, { startAt: 1, endAt: 3 })],
            commands: [move("t", "a", 1.5, { x: 100 })],
        };
        const expected = (t: number): number => Math.min(Math.max((t - 1.5) / 1, 0), 1) * 100;

        it("takes the frame its first arrival gave it, however the playhead came back", () => {
            const clip = clipOver(doc);
            const a = live<Rect>(clip, "a");
            // Forward past the end of its span, then back in at different places and different ways.
            for (const t of [0, 2.2, 4, 1.2, 2.9, 3.5, 1.6, 2.5, 0.5, 2.0]) {
                clip.seek(t);
                if (t >= 1 && t < 3) {
                    expect(a.mounted, `mounted at ${t}`).toBe(true);
                    expect(a.x, `x at ${t}`).toBeCloseTo(expected(t), 9);
                } else {
                    expect(a.mounted, `mounted at ${t}`).toBe(false);
                }
            }
        });

        it("restores its authored props on every return, not what the last visit left", () => {
            const clip = clipOver(doc);
            const a = live<Rect>(clip, "a");
            clip.seek(2.9);                  // deep into the tween, near the end of the span
            clip.seek(4);                    // gone
            clip.seek(1.2);                  // back before the tween has begun
            expect(a.x).toBe(0);
        });
    });

    describe("presenceSlot", () => {
        const doc: CompositionDocument = {
            kind: "composition",
            duration: 5,
            nodes: [row("a", {}, { startAt: 1, endAt: 3 })],
            commands: [],
        };

        it("follows whether the row is in the tree", () => {
            const clip = clipOver(doc);
            const slot = clip.timeline.presenceSlot("a")!;
            expect(slot.get()).toBe(false);
            clip.seek(2);
            expect(slot.get()).toBe(true);
            clip.seek(3.5);
            expect(slot.get()).toBe(false);
            clip.seek(1.5);
            expect(slot.get()).toBe(true);
        });

        it("is always true for the root, and absent for an id nothing declares", () => {
            const clip = clipOver(doc);
            expect(clip.timeline.presenceSlot("")!.get()).toBe(true);
            expect(clip.timeline.presenceSlot("nope")).toBeUndefined();
        });

        it("is a slot an observer can depend on", () => {
            const clip = clipOver(doc);
            const slot = clip.timeline.presenceSlot("a")!;
            const reads: unknown[] = [];
            observeSlots({ read: (s) => reads.push(s), write: () => { } }, () => slot.get());
            expect(reads).toEqual([slot]);
        });
    });

    describe("a still", () => {
        const doc: StillDocument = { kind: "still", nodes: [row("a", { x: 3 })] };

        it("has nothing to evaluate, and holds its authored props at any time", () => {
            const clip = clipOver(doc);
            expect(clip.timeline.placedCommands()).toEqual([]);
            for (const t of [0, 5, -1]) {
                expect(() => clip.timeline.evaluateAt(t)).not.toThrow();
            }
            expect(live<Rect>(clip, "a").x).toBe(3);
        });
    });
});

describe("resolving an easing from a document", () => {
    const slide = (easing: CompositionDocument["commands"][number]["easing"]): CompositionDocument => ({
        kind: "composition",
        nodes: [node("box", "rect", { width: 1, height: 1, x: 0 })],
        commands: [{ id: "s", type: "to", targetId: "box", at: 0, duration: 1, easing, args: { x: 100 } }],
    });
    /** `x` of the box halfway through a one-second slide. */
    const halfway = (easing: CompositionDocument["commands"][number]["easing"], reg: Registry = registry): number => {
        const clip = new TimelineClip(slide(easing), runtimeScope({ registry: reg }));
        clip.build();
        clip.seek(0.5);
        return (clip.timeline.liveNode("box") as unknown as Rect).x;
    };
    const buildError = (easing: unknown) =>
        precompOver(slide(easing as never)).buildErrors.map((e) => e.message).join("\n");

    it("runs `linear` as the identity, whatever args it carries", () => {
        expect(halfway({ kind: "linear" })).toBe(50);
        expect(halfway({ kind: "linear", args: "cubic" })).toBe(50);
    });

    it("defaults `in`, `out` and `inOut` to the quad family", () => {
        expect(halfway({ kind: "in" })).toBe(25);
        expect(halfway({ kind: "out" })).toBe(75);
        expect(halfway({ kind: "inOut" })).toBe(50);
    });

    it("reads the family from args", () => {
        expect(halfway({ kind: "in", args: "cubic" })).toBe(12.5);
        expect(halfway({ kind: "out", args: "cubic" })).toBe(87.5);
        expect(halfway({ kind: "in", args: "quint" })).toBeCloseTo(3.125, 9);
        expect(halfway({ kind: "inOut", args: "cubic" })).toBe(50);
    });

    it("reads the knobs of a family given as an object", () => {
        expect(halfway({ kind: "in", args: { type: "back", overshoot: 0 } })).toBeCloseTo(12.5, 9);
        expect(halfway({ kind: "in", args: { type: "back" } })).toBeCloseTo(-8.76975, 6);
        expect(halfway({ kind: "out", args: { type: "back", overshoot: 4 } })).toBeGreaterThan(100);
    });

    it("runs a drawn curve in `custom` args, with no registration", () => {
        expect(halfway({ kind: "custom", args: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeCloseTo(50, 5);
    });

    it("looks a string in `custom` args up in the registry", () => {
        const keyed = new Registry();
        keyed.addEase("slow-start", (t) => t * t * t);
        expect(halfway({ kind: "custom", args: "slow-start" }, keyed)).toBe(12.5);
    });

    it.each([
        ["a number", 5],
        ["an object that is not a curve", { x: 1 }],
        ["a curve of a single point", [{ x: 0, y: 0 }]],
        ["a boolean", true],
        ["nothing at all", undefined],
    ])("fails the build for `custom` args that are %s, saying what it needs", (_, args) => {
        expect(buildError({ kind: "custom", args })).toMatch(/A "custom" ease needs a curve or its Registry\.addEase key in `args`/);
    });

    it("echoes what it was given in that message", () => {
        expect(buildError({ kind: "custom", args: 5 })).toMatch(/\(got 5\)/);
        expect(buildError({ kind: "custom", args: { x: 1 } })).toMatch(/\(got \{"x":1\}\)/);
    });

    it("lists what is registered when a key is not", () => {
        const keyed = new Registry();
        keyed.addEase("a", (t) => t);
        keyed.addEase("b", (t) => t);
        const build = (reg: Registry) =>
            new TimelineClip(slide({ kind: "custom", args: "c" }), runtimeScope({ registry: reg })).build();
        expect(() => build(keyed)).toThrow('No ease registered under "c". Registered: a, b.');
        expect(() => build(new Registry())).toThrow('No ease registered under "c". Registered: none.');
    });

    // An unrecognised kind falls back to no easing at all rather than failing.
    it.todo("throws on an unrecognised easing kind instead of falling back");
});
