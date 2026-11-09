import { describe, it, expect } from "vitest";

import type { Node2D } from "@/components/trees/2d/node2d";
import type { StateEvaluator } from "@/runtime/state-evaluator";
import { comp, evaluatorFor, node, probeRegistry, project, track } from "@/runtime/document.fixtures";
import { FakeRenderContext } from "@/runtime/runtime.fixtures";

/**
 * `currentFrame` is the frame on screen, whatever has dropped the memo.
 *
 * Dropping the memo used to be spelled by writing `-1` into the frame itself,
 * so one number carried two meanings — "the frame on screen" and "evaluate
 * again" — and every reader of the first after a writer of the second got
 * frame `-1`, which `stateAt` clamps to frame 0 of the first track. The readers
 * are a host repaint, a screenshot and a render-error rescue; each writer below
 * is followed by the check every reader relies on.
 */

/** The probe slides x 0 → 100 over the clip's whole length. */
const clip = (seconds: number) => comp(
    [node("p", "probe", { width: 10, height: 10 })],
    [{ target: "p", args: { x: 100 }, duration: seconds, easing: { kind: "linear" } }],
);

/** {@link clip} under a theme of its own — an edit no built tree can be patched to. */
const rethemed = (seconds: number) => ({ ...clip(seconds), theme: { typography: { header: { fontSize: 48 } } } });

/** Track `a` over frames 0–9, `b` over 10–14. */
function pair() {
    const { registry, log } = probeRegistry();
    const a = track("a", clip(1));
    const b = track("b", clip(0.5), { startAt: 1 });
    return { evaluator: evaluatorFor(project([a, b]), { registry }), log, a, b };
}

const probeIn = (evaluator: StateEvaluator): Node2D => evaluator.currentCanvas!.children[0];

describe("StateEvaluator – currentFrame survives a dropped memo", () => {
    it("is kept across invalidate(), which then costs exactly one re-evaluation", () => {
        const { evaluator } = pair();
        evaluator.stateAt(12);
        evaluator.invalidate();
        expect(evaluator.currentFrame).toBe(12);

        // The next evaluation of that frame runs again, writing over an override…
        probeIn(evaluator).set({ x: 999 });
        evaluator.stateAt(evaluator.currentFrame);
        expect(probeIn(evaluator).x).toBeCloseTo(40);
        // …and the one after it is memoised again.
        probeIn(evaluator).set({ x: 999 });
        evaluator.stateAt(12);
        expect(probeIn(evaluator).x).toBe(999);
    });

    it("is kept across an equal clip, which keeps the tree on screen", () => {
        const { evaluator, a } = pair();
        evaluator.stateAt(12);
        const before = evaluator.currentCanvas;

        evaluator.setProject(project([a, track("b", clip(0.5), { startAt: 1 })]));
        expect(evaluator.currentFrame).toBe(12);
        evaluator.stateAt(evaluator.currentFrame);
        expect(evaluator.currentCanvas).toBe(before);
        expect(probeIn(evaluator).x).toBeCloseTo(40);
    });

    it("is kept across replacing the clip on screen", () => {
        const { evaluator, log, a } = pair();
        evaluator.stateAt(12);
        const before = evaluator.currentCanvas;

        evaluator.setProject(project([a, track("b", rethemed(0.5), { startAt: 1 })]));
        expect(evaluator.currentFrame).toBe(12);

        // Re-evaluating the frame on screen builds and drives the *new* clip at
        // its local frame 2 — not track `a` at frame 0, which is what a memo
        // spelled as `-1` sent every reader to.
        evaluator.stateAt(evaluator.currentFrame);
        expect(evaluator.activeTrackIds).toEqual(["b"]);
        expect(evaluator.currentCanvas).not.toBe(before);
        expect(probeIn(evaluator).x).toBeCloseTo(40);
        evaluator.render(new FakeRenderContext());
        expect(log.renderTimes).toEqual([expect.closeTo(0.2)]);
    });

    it("is kept across a setProject that moves the track under it", () => {
        const { evaluator, a, b } = pair();
        evaluator.stateAt(12);
        const before = evaluator.currentCanvas;

        evaluator.setProject(project([a, { ...b, startAt: 0.9 }]));
        expect(evaluator.currentFrame).toBe(12);

        // The track moved under the frame, so it is evaluated again — at the
        // local frame it now answers for, on the tree it kept.
        evaluator.stateAt(evaluator.currentFrame);
        expect(evaluator.currentCanvas).toBe(before);
        expect(probeIn(evaluator).x).toBeCloseTo(60);
    });
});
