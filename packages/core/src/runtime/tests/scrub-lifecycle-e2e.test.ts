import { describe, it, expect } from "vitest";
import { Registry } from "@/document/registry";
import { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { BoxBounds } from "@/layout/bounds";
import type { NodeRenderState } from "@/render/render-context2d";
import { comp, evaluatorFor, node, project, track, FPS } from "@/runtime/document.fixtures";
import { nodeAt } from "@/runtime/node-picking";
import { FakeRenderContext } from "@/runtime/runtime.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";
import { generated } from "@/components/factory/tests/generated.fixtures";

/**
 * Regression: an animated `removeChildAt` must reproduce forward playback when
 * reached by a **backward scrub**.
 *
 * The command pins the removing child's box to its laid-out
 * `measuredWidth`/`measuredHeight` before shrinking it, a value that is only
 * fresh after a layout pass. This drives the document through the evaluator and
 * compares the removing child's laid-out width at mid-remove frames, reached
 * forward vs. via a backward seek.
 */

const VIEWPORT = { width: 800, height: 400 };
const TILE = 200;
const REMOVE_DURATION = 1.0; // seconds → 10 frames of shrink

/** A probe leaf that surfaces its laid-out box for assertions. */
class Probe extends Node2D {
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

const tile = (id: string, layerOrder: number) =>
    node(id, "probe", { width: TILE, height: TILE }, "row", layerOrder);

/** A row of three fixed-size tiles that, after a beat, animates the removal of the middle one. */
const scrubClip = comp(
    [
        node("row", "rect", { width: "hug", height: "fill", flow: "horizontal", gap: 24, align: "centerLeft" }),
        tile("a", 0),
        tile("victim", 1),
        tile("c", 2),
    ],
    [
        // Hold a few frames so the row is fully laid out before the remove begins.
        5 / FPS,
        { target: "row", type: "removeChildAt", args: { index: 1 }, duration: REMOVE_DURATION },
        // Tail so the timeline extends past the remove.
        5 / FPS,
    ],
);

/**
 * An evaluator over the scrub scene, and its middle tile. The tile is held from
 * construction rather than looked up by path: once removed it has no path.
 */
function scrubEvaluator(): { ev: StateEvaluator; victim: () => Probe } {
    const built: Probe[] = [];
    class Tracked extends Probe {
        constructor(...args: ConstructorParameters<typeof Probe>) {
            super(...args);
            built.push(this);
        }
    }
    const ev = evaluatorFor(project([track("a", scrubClip)], { viewport: VIEWPORT }), {
        registry: new Registry({ nodes: { probe: Tracked as never } }),
    });
    // Built in document order: a, victim, c.
    return { ev, victim: () => built[1] };
}

/** Lay out then read the victim's current laid-out width at `frame`. */
function widthAt(ev: StateEvaluator, frame: number, victim: () => Probe): number {
    ev.stateAt(frame);
    ev.layout();
    return victim().rect.width;
}

describe("backward scrub — animated removeChildAt reproduces forward playback", () => {
    // The remove starts after the 5-frame hold (frame 5) and runs 10 frames, so
    // the shrink spans frames ~5–15. Pick a frame partway through the shrink.
    const MID_REMOVE = 11;

    it("the removing child is mid-shrink at the same frame whether reached forward or backward", () => {
        const fwd = scrubEvaluator();
        // Forward: single-step up to the target, laying out each frame (real-time
        // playback order).
        let forwardWidth = 0;
        for (let f = 0; f <= MID_REMOVE; f++) {
            forwardWidth = widthAt(fwd.ev, f, fwd.victim);
        }

        const bwd = scrubEvaluator();
        // Land past the target first, then scrub *backward* to it.
        widthAt(bwd.ev, 25, bwd.victim);
        const backwardWidth = widthAt(bwd.ev, MID_REMOVE, bwd.victim);

        // Both must show the child genuinely mid-shrink — strictly between its
        // full size and 0.
        expect(forwardWidth).toBeGreaterThan(0);
        expect(forwardWidth).toBeLessThan(TILE);

        // And the two paths must land on the *same* width for the same frame.
        expect(backwardWidth).toBeCloseTo(forwardWidth, 5);
    });

    /**
     * The last frame the child is still in the tree. Past it the remove has
     * completed and the node is detached, so its `rect` keeps whatever box the
     * last layout that included it gave it — a stale artifact, not scene state.
     * What actually holds there is membership, which the next test pins.
     */
    const LAST_PRESENT = 14;

    it("a full backward scrub matches forward frame-for-frame across the whole shrink", () => {
        const fwd = scrubEvaluator();
        const forward: number[] = [];
        for (let f = 0; f <= LAST_PRESENT; f++) forward.push(widthAt(fwd.ev, f, fwd.victim));

        const bwd = scrubEvaluator();
        // Jump past the end, then scrub backward one frame at a time.
        widthAt(bwd.ev, 20, bwd.victim);
        for (let f = LAST_PRESENT; f >= 0; f--) {
            const w = widthAt(bwd.ev, f, bwd.victim);
            expect(w).toBeCloseTo(forward[f], 5);
        }
    });

    it("agrees on whether the child is in the tree, in both directions", () => {
        // Membership is a function of the time like everything else, so a node a
        // command detached comes back when the playhead moves before it.
        const fwd = scrubEvaluator();
        const forward: boolean[] = [];
        for (let f = 0; f <= 20; f++) {
            widthAt(fwd.ev, f, fwd.victim);
            forward.push(fwd.victim().parent !== null);
        }

        const bwd = scrubEvaluator();
        widthAt(bwd.ev, 20, bwd.victim);
        for (let f = 20; f >= 0; f--) {
            widthAt(bwd.ev, f, bwd.victim);
            expect(bwd.victim().parent !== null).toBe(forward[f]);
        }

        // And it really does leave: present at the start, gone by the end.
        expect(forward[0]).toBe(true);
        expect(forward[20]).toBe(false);
    });
});

/** A box sliding x 0 → 90 over two seconds, linearly: 45px/s throughout. */
const SLIDE_FRAMES = 2 * FPS;
const slide = (type = "rect") => comp(
    [node("box", type, { width: 10, height: 10, x: 0 })],
    [{ target: "box", args: { x: 90 }, duration: 2, easing: { kind: "linear" } }],
);

const boxOf = (ev: StateEvaluator) => nodeAt(ev.currentCanvas!, "0") as Rect;

describe("seeking is a function of the frame", () => {
    it("lands on the same values however the playhead arrived", () => {
        const walked = evaluatorFor(project([track("a", slide())]));
        for (let frame = 0; frame <= 13; frame++) walked.stateAt(frame);

        const jumped = evaluatorFor(project([track("a", slide())]));
        jumped.stateAt(13);

        expect(boxOf(jumped).x).toBeCloseTo(90 * (13 / SLIDE_FRAMES), 5);
        expect(boxOf(jumped).x).toBeCloseTo(boxOf(walked).x, 5);
    });

    it("builds a track's tree once, however the playhead moves", () => {
        // Counted by constructions rather than timed: the cost this is about is
        // reconstruction, which a backward seek used to pay in full.
        let builds = 0;
        class Counted extends generated(Rect) {
            constructor(...args: ConstructorParameters<typeof Rect>) {
                super(...args);
                builds++;
            }
        }
        const ev = evaluatorFor(project([track("a", slide("counted"))]), {
            registry: new Registry({ nodes: { counted: Counted as never } }),
        });
        const last = SLIDE_FRAMES - 1;

        ev.stateAt(last);
        expect(builds).toBe(1);
        const atEnd = boxOf(ev).x;

        for (let frame = last - 1; frame >= 0; frame--) ev.stateAt(frame);
        expect(builds).toBe(1);
        expect(boxOf(ev).x).toBeCloseTo(0, 4);

        ev.stateAt(last);
        expect(builds).toBe(1);
        expect(boxOf(ev).x).toBeCloseTo(atEnd, 4);
    });
});

/**
 * Motion has to be a property of the *frame*, not of the seek that arrived at
 * it: motion blur and trails are built on the sampled velocity, so a velocity
 * taken against "wherever the playhead last sat" would make the same frame look
 * different depending on how it was reached.
 */
describe("motion is deterministic per frame", () => {
    /** Records each node's velocity as it is drawn — the one place motion state reaches a renderer. */
    class MotionRecorder extends FakeRenderContext {
        readonly velocityX = new Map<string, number>();

        override begin(state: NodeRenderState): void {
            this.velocityX.set(state.id, state.velocity.x);
            super.begin(state);
        }
    }

    function velocityOf(ev: StateEvaluator): number {
        const rc = new MotionRecorder();
        ev.render(rc);
        return rc.velocityX.get(boxOf(ev).id)!;
    }

    /** The box's velocity at the last of `seeks`, reached by seeking through them. */
    function velocityAfter(seeks: number[]): number {
        const ev = evaluatorFor(project([track("a", slide())]));
        for (const frame of seeks) ev.stateAt(frame);
        return velocityOf(ev);
    }

    it("reads the same velocity however the playhead got to the frame", () => {
        const target = 10;
        const stepped = velocityAfter([8, 9, target]);
        const jumped = velocityAfter([target]);
        const fromAhead = velocityAfter([18, target]);
        const fromFarBehind = velocityAfter([1, target]);

        expect(jumped).toBeCloseTo(stepped, 5);
        expect(fromAhead).toBeCloseTo(stepped, 5);
        expect(fromFarBehind).toBeCloseTo(stepped, 5);
    });

    it("keeps reading the same velocity when the frame is asked for twice", () => {
        // Holding on a frame used to collapse dt to zero and take the blur away.
        const ev = evaluatorFor(project([track("a", slide())]));
        ev.stateAt(10);
        const first = velocityOf(ev);
        ev.stateAt(11);
        ev.stateAt(10);
        expect(velocityOf(ev)).toBeCloseTo(first, 5);
    });

    it("measures the velocity the animation actually has", () => {
        expect(velocityAfter([10])).toBeCloseTo(45, 1);
    });

    it("reads the first frame as stationary rather than inventing a jump", () => {
        // There is no frame before it to difference against.
        expect(velocityAfter([0])).toBe(0);
    });
});
