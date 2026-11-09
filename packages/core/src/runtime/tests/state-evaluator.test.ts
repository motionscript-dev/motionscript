import { describe, expect, it } from "vitest";
import type { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { NodeRenderState } from "@/render/render-context2d";
import type { StateEvaluator } from "@/runtime/state-evaluator";
import {
    comp,
    evaluatorFor,
    node,
    probeRegistry,
    project,
    track,
    type CommandStep,
} from "@/runtime/document.fixtures";
import { FakeRenderContext } from "@/runtime/runtime.fixtures";
import { generated } from "@/components/factory/tests/generated.fixtures";

const probe = (id = "p") => node(id, "probe", { width: 10, height: 10, key: id });
const slide = (target: string, x: number, duration: number): CommandStep =>
    ({ target, args: { x }, duration, easing: { kind: "linear" } });

/** The probe slides x 0 → 100 over a second, then holds half a second: frames 0–14. */
const sliding = () => comp([probe()], [slide("p", 100, 1), 0.5]);

/** Records each node's horizontal velocity as the walk enters it. */
class MotionPass extends FakeRenderContext {
    readonly velocity = new Map<string, number>();

    override begin(state: NodeRenderState): void {
        this.velocity.set(state.id, state.velocity.x);
        super.begin(state);
    }
}

function probeIn(evaluator: StateEvaluator): Node2D {
    return evaluator.currentCanvas!.children[0];
}

/** The velocity `target` draws with at the evaluator's current frame. */
function velocityOf(evaluator: StateEvaluator, target: Node2D = probeIn(evaluator)): number {
    const pass = new MotionPass();
    evaluator.layout();
    evaluator.render(pass);
    return pass.velocity.get(target.id)!;
}

function single() {
    const { registry, log } = probeRegistry();
    return { evaluator: evaluatorFor(project([track("a", sliding())]), { registry }), log };
}

/**
 * Track `a` over frames 0–9 and `b` over 10–14, each sliding a probe for its
 * whole length, with a marker node counting how often each track's tree is built.
 */
function pair() {
    const { registry, log } = probeRegistry();
    const builds: Record<string, number> = {};
    class Marker extends generated(Rect) {
        constructor(...args: ConstructorParameters<typeof Rect>) {
            super(...args);
            builds[this.key!] = (builds[this.key!] ?? 0) + 1;
        }
    }
    registry.addNode("marker", Marker as never);
    const clip = (id: string, seconds: number) =>
        comp([probe(), node("m", "marker", { key: id })], [slide("p", 100, seconds)]);
    const evaluator = evaluatorFor(project([
        track("a", clip("a", 1)),
        track("b", clip("b", 0.5), { startAt: 1 }),
    ]), { registry });
    return { evaluator, log, builds };
}

describe("StateEvaluator – construction", () => {
    it("builds nothing until a frame is asked for, and starts on the first visual track", () => {
        const { evaluator, builds } = pair();
        expect(evaluator.currentFrame).toBe(0);
        expect(evaluator.currentTrackId).toBe("a");
        expect(evaluator.currentCanvas).toBeNull();
        expect(evaluator.activeTrackIds).toEqual([]);
        expect(builds).toEqual({});
    });
});

describe("StateEvaluator – evaluating a frame", () => {
    it("builds a track once, on the first frame that needs it", () => {
        const { evaluator, builds } = pair();
        evaluator.stateAt(0);
        const built = evaluator.currentCanvas;
        evaluator.stateAt(5);
        evaluator.stateAt(2);
        expect(evaluator.currentCanvas).toBe(built);
        expect(builds).toEqual({ a: 1 });
    });

    it("puts the track straight into the frame asked for", () => {
        const { evaluator, log } = single();
        evaluator.stateAt(3);
        expect(evaluator.currentFrame).toBe(3);
        expect(probeIn(evaluator).x).toBeCloseTo(30);
        evaluator.render(new FakeRenderContext());
        expect(log.renderTimes).toEqual([expect.closeTo(0.3)]);
    });

    // Motion is a property of the frame, not of the seek that reached it: the
    // frame before is evaluated and primed as history, so a cold jump reads the
    // velocity the timeline has there.
    it("evaluates and primes the frame before, so a cold jump reads the frame's own motion", () => {
        const { evaluator } = single();
        evaluator.stateAt(3);
        expect(velocityOf(evaluator)).toBeCloseTo(100);
    });

    it("reads no motion on the first frame, and the timeline's from the second", () => {
        const first = single().evaluator;
        first.stateAt(0);
        expect(velocityOf(first)).toBe(0);

        const second = single().evaluator;
        second.stateAt(1);
        expect(velocityOf(second)).toBeCloseTo(100);
    });

    it("is a no-op on the frame it is already on", () => {
        const { evaluator } = single();
        evaluator.stateAt(3);
        probeIn(evaluator).set({ x: 999 });
        evaluator.stateAt(3);
        expect(probeIn(evaluator).x).toBe(999);
    });

    it("floors fractional frames and clamps negatives to 0", () => {
        const { evaluator } = single();
        evaluator.stateAt(2.9);
        expect(evaluator.currentFrame).toBe(2);
        expect(probeIn(evaluator).x).toBeCloseTo(20);
        evaluator.stateAt(-5);
        expect(evaluator.currentFrame).toBe(0);
        expect(probeIn(evaluator).x).toBe(0);
    });

    it("re-evaluates after invalidate(), writing over an override, without rebuilding", () => {
        const { evaluator } = single();
        evaluator.stateAt(3);
        const built = evaluator.currentCanvas;
        probeIn(evaluator).set({ x: 999 });
        evaluator.invalidate();
        evaluator.stateAt(3);
        expect(probeIn(evaluator).x).toBeCloseTo(30);
        expect(evaluator.currentCanvas).toBe(built);
    });
});

describe("StateEvaluator – backward seek", () => {
    // A generator could only be advanced, so an earlier frame meant throwing the
    // tree out and replaying from zero.
    it("does not rebuild the track when seeking earlier", () => {
        const { evaluator } = single();
        evaluator.stateAt(8);
        const built = evaluator.currentCanvas;
        evaluator.stateAt(2);
        expect(evaluator.currentCanvas).toBe(built);
        expect(evaluator.currentFrame).toBe(2);
        expect(probeIn(evaluator).x).toBeCloseTo(20);
    });

    it("samples motion on every evaluation, whichever way the playhead moved", () => {
        const { evaluator } = single();
        evaluator.stateAt(3);
        expect(velocityOf(evaluator)).toBeCloseTo(100);
        evaluator.stateAt(12);
        expect(velocityOf(evaluator)).toBe(0);
        evaluator.stateAt(3);
        expect(velocityOf(evaluator)).toBeCloseTo(100);
    });
});

describe("StateEvaluator – several tracks", () => {
    it("builds and draws only the track covering the frame", () => {
        const { evaluator, log, builds } = pair();
        evaluator.stateAt(12);
        evaluator.render(new FakeRenderContext());
        expect(evaluator.currentTrackId).toBe("b");
        expect(evaluator.activeTrackIds).toEqual(["b"]);
        expect(builds).toEqual({ b: 1 });
        expect(log.renderTimes).toEqual([expect.closeTo(0.2)]);
    });

    it("builds an earlier track when the playhead returns to it, and each only once", () => {
        const { evaluator, builds } = pair();
        evaluator.stateAt(12);
        const b = evaluator.currentCanvas;
        evaluator.stateAt(3);
        expect(evaluator.currentTrackId).toBe("a");
        expect(evaluator.currentFrame).toBe(3);
        const a = evaluator.currentCanvas;

        evaluator.stateAt(13);
        expect(evaluator.currentCanvas).toBe(b);
        evaluator.stateAt(1);
        expect(evaluator.currentCanvas).toBe(a);
        expect(builds).toEqual({ a: 1, b: 1 });
    });

    // A track first built after another has run must still start from its own
    // zero, not from wherever the project was when it was entered.
    it("keeps each track on its own clock across crossings", () => {
        const { evaluator, log } = pair();
        const pass = new FakeRenderContext();
        for (const frame of [12, 3, 13]) {
            evaluator.stateAt(frame);
            evaluator.render(pass);
        }
        expect(log.renderTimes).toEqual([expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.3)]);
    });

    it("holds the last stack past the end of the project", () => {
        const { evaluator } = pair();
        evaluator.stateAt(20);
        expect(evaluator.currentFrame).toBe(20);
        expect(evaluator.activeTrackIds).toEqual(["b"]);
        expect(evaluator.currentTrackId).toBe("b");
        expect(probeIn(evaluator).x).toBe(100);
    });

    it("draws nothing over a hole, and keeps the editor on the last track there was", () => {
        const { registry, log } = probeRegistry();
        const evaluator = evaluatorFor(project([
            track("a", sliding()),
            track("b", sliding(), { startAt: 2 }),
        ]), { registry });
        const pass = new FakeRenderContext();
        evaluator.stateAt(5);
        evaluator.render(pass);
        const drawn = log.renders;

        evaluator.stateAt(17);
        evaluator.render(pass);
        expect(evaluator.currentFrame).toBe(17);
        expect(evaluator.activeTrackIds).toEqual([]);
        expect(evaluator.currentTrackId).toBe("a");
        expect(log.renders).toBe(drawn);
    });

    it("draws overlapping tracks back to front, each at its own time", () => {
        const { registry, log } = probeRegistry();
        const evaluator = evaluatorFor(project([
            track("under", sliding()),
            track("over", sliding(), { startAt: 0.5 }),
        ]), { registry });
        evaluator.stateAt(8);
        evaluator.render(new FakeRenderContext());
        expect(evaluator.activeTrackIds).toEqual(["under", "over"]);
        expect(evaluator.currentTrackId).toBe("over");
        expect(log.renderTimes).toEqual([expect.closeTo(0.8), expect.closeTo(0.3)]);
    });
});

describe("StateEvaluator – layout & render", () => {
    it("lays each track out against the full viewport", () => {
        const { registry } = probeRegistry();
        const evaluator = evaluatorFor(
            project([track("a", sliding())], { viewport: { width: 320, height: 180 } }),
            { registry },
        );
        evaluator.stateAt(1);
        evaluator.layout();
        expect(evaluator.currentCanvas!.layoutBounds).toMatchObject({ width: 320, height: 180 });
    });

    // A node's world position is its box plus its `x`, so priming against a box
    // left over from another frame would make motion depend on how the playhead
    // arrived.
    it("lays out the frame before too, so motion reads a fresh box", () => {
        const { registry } = probeRegistry();
        const pushed = () => evaluatorFor(project([track("a", comp([
            node("row", "rect", { flow: "horizontal", width: 200, height: 100 }),
            node("grow", "rect", { width: 0, height: 10 }, "row", 0),
            node("p", "probe", { width: 10, height: 10 }, "row", 1),
        ], [{ target: "grow", args: { width: 100 }, duration: 1, easing: { kind: "linear" } }]))]), { registry });
        const inRow = (evaluator: StateEvaluator) => evaluator.currentCanvas!.children[0].children[1];
        const boxX = (frame: number) => {
            const evaluator = pushed();
            evaluator.stateAt(frame);
            return inRow(evaluator).layoutBounds!.x;
        };
        const expected = (boxX(3) - boxX(2)) / 0.1;
        expect(expected).not.toBeCloseTo(0);

        const cold = pushed();
        cold.stateAt(3);
        expect(velocityOf(cold, inRow(cold))).toBeCloseTo(expected);

        const returning = pushed();
        returning.stateAt(9);
        returning.stateAt(3);
        expect(velocityOf(returning, inRow(returning))).toBeCloseTo(expected);
    });

    it("renders through the pass it is given", () => {
        const { evaluator, log } = single();
        evaluator.stateAt(1);
        evaluator.render(new FakeRenderContext());
        expect(log.renders).toBe(1);
    });
});

describe("StateEvaluator – editor states", () => {
    it("applies a track's editor states on the next evaluation of the frame", () => {
        const { evaluator, log } = single();
        const pass = new FakeRenderContext();
        evaluator.stateAt(3);

        evaluator.setEditorStates("a", { p: { hidden: true } });
        evaluator.stateAt(3);
        evaluator.render(pass);
        expect(log.renders).toBe(0);

        evaluator.setEditorStates("a", undefined);
        evaluator.stateAt(3);
        evaluator.render(pass);
        expect(log.renders).toBe(1);
    });
});

describe("StateEvaluator – dispose", () => {
    it("evaluates and draws nothing once disposed", () => {
        const { evaluator, log } = single();
        evaluator.stateAt(3);
        evaluator.dispose();

        evaluator.stateAt(5);
        evaluator.render(new FakeRenderContext());
        expect(evaluator.currentFrame).toBe(3);
        expect(evaluator.currentCanvas).toBeNull();
        expect(log.renders).toBe(0);
    });
});
