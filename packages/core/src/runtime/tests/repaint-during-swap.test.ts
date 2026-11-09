import { describe, it, expect } from "vitest";

import { Fills } from "@/attributes/shape/fill/chain";
import type { PlaybackController } from "@/runtime/playback-controller";
import { comp, node, openController, probeRegistry, project, track } from "@/runtime/document.fixtures";

/**
 * A host repaint that lands between a document swap and the swap's own paint.
 *
 * `setProject` loads before it paints, and the canvas keeps the previous
 * complete frame until the load is in. An editor that swaps a document in
 * typically repaints straight afterwards — it has just cleared the transient
 * override that stood in for the edit — and that repaint used to draw. Two
 * things were wrong with what it drew. It was the swapped-in clip *before its
 * assets had arrived*, which is the frame the swap exists to avoid. And it was
 * drawn at frame `-1`: the evaluator had just dropped its frame memo by writing
 * that sentinel over the frame, and `stateAt` clamps a negative frame to 0 —
 * frame 0 of the **first track**. On a multi-track project every edit that
 * swapped a clip in put the first track on screen for the length of a fetch.
 *
 * Two guarantees, one from each side of the seam. The evaluator's
 * `currentFrame` is the frame on screen, whatever has invalidated its memo. And
 * the controller declines a repaint while a swap is between its load and its
 * paint, because that paint reads every override and the view as they stand
 * when it lands and so already covers whatever the repaint was for.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(controller: PlaybackController): Promise<void> {
    for (let i = 0; i < 20 && !controller.precomp.complete; i++) await flush();
}

const clip = (props: Record<string, unknown> = {}) => comp([node("p", "probe", { width: 10, height: 10, ...props })], [1]);

/** Track `b` edited: the same id, its one node resized — which rebuilds it, a lone node being the whole clip. */
const editedB = (props: Record<string, unknown> = { width: 12 }) => track("b", clip(props), { startAt: 1 });

/** Two one-second tracks, the playhead parked at local frame 5 of the second, everything discovered. */
async function parkedInB() {
    const { registry, log } = probeRegistry();
    const a = track("a", clip());
    const b = track("b", clip(), { startAt: 1 });
    const opened = openController(project([a, b]), { registry });
    await settle(opened.controller);
    expect(opened.controller.precomp.complete).toBe(true);
    await opened.controller.seek(15);
    return { ...opened, log, a, b };
}

describe("PlaybackController – a host repaint during a document swap", () => {
    it("draws nothing until the swap lands, and never the first track", async () => {
        const { a, controller, rc, log } = await parkedInB();
        const renders = rc.renderCount;
        const drawn = log.renderTimes.length;

        controller.setProject(project([a, editedB()]));
        // What an editor does straight after a swap: drop the transient override
        // that stood in for the edit, and repaint.
        controller.repaint();

        expect(rc.renderCount).toBe(renders);
        expect(log.renderTimes.length).toBe(drawn);

        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 1);
        // Painted at the frame the playhead is on — local frame 5 of `b` — and
        // never `a` at frame 0, which is the frame `-1` this used to draw.
        expect(log.renderTimes.slice(drawn)).toEqual([expect.closeTo(0.5)]);
    });

    it("clearNodeOverrides in that window waits for the swap too", async () => {
        const { a, controller, rc, log } = await parkedInB();
        controller.setNodeOverride("0", { x: 1 });
        const renders = rc.renderCount;
        const drawn = log.renderTimes.length;

        controller.setProject(project([a, editedB()]));
        // Clearing repaints so the node snaps back — but not before the swap
        // has loaded, and never as frame `-1`.
        controller.clearNodeOverrides("0");
        expect(rc.renderCount).toBe(renders);
        expect(log.renderTimes.length).toBe(drawn);

        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 1);
        expect(log.renderTimes.slice(drawn)).toEqual([expect.closeTo(0.5)]);
    });

    it("the same holds for a swap that only moves the track on screen", async () => {
        const { a, b, controller, rc, log } = await parkedInB();
        const renders = rc.renderCount;
        const drawn = log.renderTimes.length;

        controller.setProject(project([a, { ...b, startAt: 1.2 }]));
        controller.repaint();
        expect(rc.renderCount).toBe(renders);
        expect(log.renderTimes.length).toBe(drawn);

        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 1);
        // Frame 15 is now local frame 3 of the moved track.
        expect(log.renderTimes.slice(drawn)).toEqual([expect.closeTo(0.3)]);
    });

    it("repaints again once the swap has landed", async () => {
        const { a, controller, rc, log } = await parkedInB();
        controller.setProject(project([a, editedB()]));
        await controller.whenReplaced();

        const renders = rc.renderCount;
        controller.repaint();
        expect(rc.renderCount).toBe(renders + 1);
        expect(log.renderTimes.at(-1)).toBeCloseTo(0.5);
    });

    it("repaints again when a seek has superseded the swap", async () => {
        // A seek bumps the generation, so the swap's paint will never land — a
        // repaint held for it would be held forever. The seek's own paint is the
        // one on screen now, and a repaint after it has to work.
        const { a, controller, rc, storage } = await parkedInB();

        // Park the swap's load so a seek can get in ahead of it.
        let releaseLoad!: () => void;
        const gate = new Promise<void>((resolve) => { releaseLoad = resolve; });
        const realLoad = storage.loadAsset.bind(storage);
        let gated = false;
        storage.loadAsset = (key, record) => {
            realLoad(key, record);
            if (!gated) { gated = true; return gate; }
            return Promise.resolve();
        };

        controller.setProject(project([a, editedB({ fill: Fills.image("new.png") })]));

        await controller.seek(12);
        const renders = rc.renderCount;
        controller.repaint();
        expect(rc.renderCount).toBe(renders + 1);

        // …and the superseded swap still refuses to paint when it wakes.
        releaseLoad();
        await flush();
        expect(rc.renderCount).toBe(renders + 1);
    });
});
