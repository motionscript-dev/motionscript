import { describe, it, expect } from "vitest";
import { Fills } from "@/attributes/shape/fill/chain";
import type { CompositionDocument } from "@/document/types";
import type { PlaybackController } from "@/runtime/playback-controller";
import type { AssetTimelineResult } from "@/runtime/asset-timeline";
import { comp, node, openController, probeRegistry, project, track } from "@/runtime/document.fixtures";

/**
 * Background discovery driven end to end, through the controller that owns it,
 * over real clips — flexbox layout, text, a node removed mid-clip. The
 * scheduling itself is proven at the `AssetTimeline` level; this proves the
 * controller's loop around it.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A hug row whose middle child is removed mid-clip. One second long. */
function removingRow(label: string): CompositionDocument {
    return comp([
        node("row", "rect", { width: "hug", height: "fill", flow: "horizontal", gap: 24, align: "centerLeft" }),
        node("first", "rect", { width: 120, height: 120 }, "row", 0),
        node("label", "text", { text: label }, "first", 0),
        { ...node("mid", "rect", { width: 120, height: 120 }, "row", 1), endAt: 0.5 },
        node("last", "rect", { width: 120, height: 120 }, "row", 2),
    ], [1]);
}

/** A box through three half-second legs. */
function movingBox(distance: number): CompositionDocument {
    return comp([node("box", "rect", { width: 80, height: 80, x: 0, y: 0 })], [
        { target: "box", args: { x: distance }, duration: 0.5 },
        { target: "box", args: { y: distance, rotation: 45 }, duration: 0.5 },
        { target: "box", args: { x: 0, y: 0, rotation: 0 }, duration: 0.5 },
    ]);
}

/** Resolves with the first complete result the controller publishes. */
function completion() {
    let resolve!: (result: AssetTimelineResult) => void;
    const done = new Promise<AssetTimelineResult>((r) => { resolve = r; });
    return { done, onPrecompProgress: (result: AssetTimelineResult) => { if (result.complete) resolve(result); } };
}

describe("PlaybackController – background discovery", () => {
    it("discovers only what frame 0 needs up front, then streams in the rest", async () => {
        const { done, onPrecompProgress } = completion();
        const { controller, clock } = openController(project([
            track("a", removingRow("A")),
            track("b", movingBox(200), { startAt: 1 }),
            track("c", removingRow("B"), { startAt: 2.5 }),
        ]), { precompBudgetMs: 0, onPrecompProgress });

        expect(controller.precomp.tracks.map((t) => t.discovered)).toEqual([true, false, false]);
        // Spans are the document's, so the length is exact before the rest lands.
        expect(controller.totalFrames).toBe(35);
        expect(clock.duration).toBeCloseTo(3.5, 6);

        const final = await done;
        expect(final.tracks.map((t) => t.discovered)).toEqual([true, true, true]);
        expect(controller.precomp.complete).toBe(true);
        expect(controller.buildErrors).toEqual([]);
        controller.dispose();
    });

    it("finishes on the new document when one is swapped in mid-discovery", async () => {
        const { done, onPrecompProgress } = completion();
        let controller!: PlaybackController;
        const a = track("a", removingRow("A"));
        const swapped = project([a, track("c", removingRow("C"), { startAt: 1 })]);
        let swappedIn = false;
        // Swapped from inside the pass rather than from a timer, so the pass is
        // mid-track when it happens rather than racing the scheduler for it.
        const { registry } = probeRegistry(() => {
            if (swappedIn) return;
            swappedIn = true;
            controller.setProject(swapped);
        });
        const b = comp([node("p", "probe", { width: 10, height: 10, fill: Fills.image("b.png") })], [
            { target: "p", args: { x: 50 }, duration: 0.5 },
            { target: "p", args: { x: 0 }, duration: 0.5 },
        ]);
        ({ controller } = openController(project([a, track("b", b, { startAt: 1 })]), {
            registry, precompBudgetMs: 0, onPrecompProgress,
        }));

        const final = await done;
        expect(swappedIn).toBe(true);
        expect(final.tracks.map((t) => t.id)).toEqual(["a", "c"]);
        expect(final.tracks.every((t) => t.discovered)).toBe(true);
        // The dropped track's windows never reach the timeline.
        expect(final.assets.has("b.png")).toBe(false);
        expect(controller.totalFrames).toBe(20);
        controller.dispose();
    });

    it("dispose() abandons discovery still in flight", async () => {
        let controller!: PlaybackController;
        // Disposed from inside the pass: a whole project can land within one
        // timer tick, so a timer could not catch it in flight.
        const { registry, log } = probeRegistry((_t, call) => { if (call === 5) controller.dispose(); });
        // A fill tween every frame, so the probe is declared on every one of them.
        const long = comp([node("p", "probe", { width: 10, height: 10 })],
            Array.from({ length: 200 }, (_, i) => ({ target: "p", args: { fill: i % 2 ? "#ff0000" : "#0000ff" }, duration: 0.1 })));
        ({ controller } = openController(project([
            track("a", removingRow("A")),
            track("b", long, { startAt: 1 }),
            track("c", movingBox(100), { startAt: 21 }),
        ]), { registry, precompBudgetMs: 0 }));

        while (log.declares <= 5) await flush();
        const atDispose = log.declares;
        for (let i = 0; i < 5; i++) await flush();

        expect(controller.precomp.complete).toBe(false);
        // b yields between each of its 200 frames, so a run that ignored the
        // cancel would still be grinding through it.
        expect(log.declares).toBe(atDispose);
        expect(log.declares).toBeLessThan(20);
    });
});
