import { describe, it, expect } from "vitest";
import type { ProjectDocument } from "@/document/project";
import type { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { comp, evaluatorFor, precompFor, project, track } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

// The fixture project runs at 10fps, so frame 20 is the end of a 2s ramp.

/** A project whose one clip ramps a canvas prop over two seconds. */
function ramping(props: Record<string, unknown>): ProjectDocument {
    return project([track("a", comp([], [{ target: null, args: props, duration: 2 }]))]);
}

/** Mirror one playback pass: frames 1..`frames` in order, sampling the canvas after each. */
function play(evaluator: StateEvaluator, frames: number, read: (canvas: Canvas2D) => number): number[] {
    const samples: number[] = [];
    for (let frame = 1; frame <= frames; frame++) {
        evaluator.stateAt(frame);
        samples.push(read(evaluator.currentCanvas!));
    }
    return samples;
}

describe("canvas-prop animation across passes", () => {
    /**
     * Regression: a prior full pass leaves the canvas at its tweened end-state.
     * The next pass must still ramp from the authored value — a tween that
     * snapshotted its `from` there would have `from === target` and visibly do
     * nothing.
     */
    it("re-ramps a canvas prop after a prior full run", () => {
        const doc = ramping({ zoom: 3 });
        precompFor(doc).run();
        const evaluator = evaluatorFor(doc);

        // Pass 1: drive to completion → canvas.zoom ends at 3.
        play(evaluator, 30, (c) => c.zoom);
        expect(evaluator.currentCanvas!.zoom).toBe(3);

        // Pass 2 (playback): must ramp from the default (1) again, not sit at 3.
        const samples = play(evaluator, 5, (c) => c.zoom);
        expect(samples[0]).toBeLessThan(3);
        expect(samples[samples.length - 1]).toBeGreaterThan(samples[0]);
    });

    it("re-ramps for padding and heading too (camera + layout props)", () => {
        const top = (c: Canvas2D) => (c.padding as { top: number }).top;
        const padded = evaluatorFor(ramping({ padding: 40 }));
        play(padded, 30, top);
        const pad = play(padded, 5, top);
        expect(pad[0]).toBeLessThan(40);
        expect(pad[pad.length - 1]).toBeGreaterThan(pad[0]);

        const turned = evaluatorFor(ramping({ heading: 90 }));
        play(turned, 30, (c) => c.heading);
        const head = play(turned, 5, (c) => c.heading);
        expect(head[0]).toBeLessThan(90);
        expect(head[head.length - 1]).toBeGreaterThan(head[0]);
    });

    /**
     * The stronger guarantee the evaluation model adds: a frame is a function of
     * its time. A generator could only be advanced, so this needed a whole
     * rebuild; now re-asking is enough.
     */
    it("returns to the start value when asked for frame 0 again", () => {
        const evaluator = evaluatorFor(ramping({ zoom: 3 }));

        evaluator.stateAt(20);
        expect(evaluator.currentCanvas!.zoom).toBeCloseTo(3, 5);
        evaluator.stateAt(0);
        expect(evaluator.currentCanvas!.zoom).toBeCloseTo(1, 5);
    });
});
