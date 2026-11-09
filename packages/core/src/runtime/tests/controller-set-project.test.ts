import { describe, it, expect } from "vitest";

import { Fills } from "@/attributes/shape/fill/chain";
import type { AssetTimelineResult } from "@/runtime/asset-timeline";
import type { PlaybackController } from "@/runtime/playback-controller";
import { comp, node, openController, probeRegistry, project, track } from "@/runtime/document.fixtures";

/**
 * A document swapped into a controller that is already running.
 *
 * A swap is reconciled by track id rather than rebuilt: a track whose clip is
 * unchanged keeps its tree and its discovery, and one whose clip patches in
 * place keeps them too, re-declaring only what the edit reached. A track that
 * has to start again is discovered **before** `setProject` returns when it is
 * under the playhead, because the paint the swap schedules is for that frame;
 * everything else streams in behind the paint exactly as it does at mount.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(controller: PlaybackController): Promise<void> {
    for (let i = 0; i < 20 && !controller.precomp.complete; i++) await flush();
}

const probe = (props: Record<string, unknown> = {}) => node("p", "probe", { width: 10, height: 10, ...props });
const clip = (seconds = 1, props: Record<string, unknown> = {}) => comp([probe(props)], [seconds]);
/** {@link clip} under a theme of its own — colours resolve against it as props are written, so no built tree patches onto it. */
const rethemed = (seconds = 1) => ({ ...clip(seconds), theme: { typography: { header: { fontSize: 48 } } } });

/** Two one-second tracks, the playhead parked at local frame 5 of the second, everything discovered. */
async function parkedInB() {
    const { registry, log } = probeRegistry();
    const progress: AssetTimelineResult[] = [];
    const a = track("a", clip());
    const b = track("b", clip(), { startAt: 1 });
    const opened = openController(project([a, b]), {
        registry,
        onPrecompProgress: (result) => progress.push(result),
    });
    await settle(opened.controller);
    await opened.controller.seek(15);
    return { ...opened, log, progress, a, b };
}

describe("PlaybackController.setProject", () => {
    // Both halves read the probe's `prepares` count as the tell for whether a
    // track was discovered again: a fresh build runs a discovery pass over the new
    // tree, so the probe is prepared again.
    it("keeps the track on screen built and discovered when only another track changed", async () => {
        const { controller, log, b } = await parkedInB();
        const prepared = log.declares;

        controller.setProject(project([track("a", rethemed()), b]));
        expect(controller.precomp.tracks.map(t => t.discovered)).toEqual([false, true]);
        expect(log.declares).toBe(prepared);

        await controller.whenReplaced();
        expect(log.declares).toBe(prepared);
    });

    it("keeps every tree and every discovery for an equal document, whatever objects carry it", async () => {
        const { controller, log, rc } = await parkedInB();
        const prepared = log.declares;
        const built = [...log.constructed];
        const published = controller.precomp;

        controller.setProject(project([track("a", clip()), track("b", clip(), { startAt: 1 })]));
        expect(controller.precomp).toBe(published);
        expect(log.constructed).toEqual(built);

        const renders = rc.renderCount;
        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 1);
        expect(log.declares).toBe(prepared);
    });

    it("patches a one-node clip on screen, republishing nothing for an edit no declaration read", async () => {
        const { controller, log, rc, a } = await parkedInB();
        const prepared = log.declares;
        const published = controller.precomp;

        controller.setProject(project([a, track("b", clip(1, { x: 30 }), { startAt: 1 })]));
        expect(controller.precomp).toBe(published);
        // A placement edit is written onto the live node.
        expect(log.constructed).toEqual(["p", "p"]);

        const renders = rc.renderCount;
        await controller.whenReplaced();
        expect(rc.renderCount).toBe(renders + 1);
        expect(log.declares).toBe(prepared);
        expect(controller.getNodeState("p")?.properties.x).toBe(30);
    });

    it("rebuilds the track on screen when its clip cannot be patched, discovering it before it returns", async () => {
        const { controller, log, a } = await parkedInB();
        const prepared = log.declares;

        controller.setProject(project([a, track("b", rethemed(), { startAt: 1 })]));
        // Synchronously, with no yield in between: frame 15 has to name a
        // discovered track the instant the caller asks, because the paint
        // `setProject` schedules is for that frame.
        expect(controller.precomp.tracks[1].discovered).toBe(true);

        await controller.whenReplaced();
        expect(log.declares).toBeGreaterThan(prepared);
    });

    it("clamps the playhead into a timeline that got shorter", async () => {
        const { controller, clock, log, a } = await parkedInB();
        const painted: number[] = [];
        controller.onFramePainted = (frame) => painted.push(frame);

        controller.setProject(project([a]));
        expect(controller.totalFrames).toBe(10);
        expect(clock.duration).toBeCloseTo(1, 6);

        await controller.whenReplaced();
        expect(painted).toEqual([9]);
        expect(controller.currentTrackId).toBe("a");
        expect(log.renderTimes.at(-1)).toBeCloseTo(0.9);
    });

    it("streams a track past the playhead in behind the paint, without a new controller", async () => {
        const { controller, clock, progress, a, b } = await parkedInB();
        const published = progress.length;

        controller.setProject(project([a, b, track("c", clip(0.4), { startAt: 2 })]));
        // Spans come from the document, so the length is exact at once…
        expect(controller.spans.at(-1)).toEqual({ id: "c", index: 2, startFrame: 20, endFrame: 23 });
        expect(controller.totalFrames).toBe(24);
        expect(clock.duration).toBeCloseTo(2.4, 6);
        // …while what the new track needs is found behind the paint.
        expect(controller.precomp.tracks[2].discovered).toBe(false);

        await settle(controller);
        expect(controller.precomp.tracks[2].discovered).toBe(true);
        expect(progress.length).toBeGreaterThan(published);
    });

    it("loads what the swapped-in clip adds, then paints, then resolves whenReplaced", async () => {
        const { controller, storage, rc, a } = await parkedInB();
        const paintsAtLoad: number[] = [];
        const load = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            if (key === "new.png") paintsAtLoad.push(rc.renderCount);
            return load(key, record);
        };
        const renders = rc.renderCount;

        controller.setProject(project([a, track("b", clip(1, { fill: Fills.image("new.png") }), { startAt: 1 })]));
        expect(rc.renderCount).toBe(renders);

        await controller.whenReplaced();
        expect(paintsAtLoad[0]).toBe(renders);
        expect(rc.renderCount).toBe(renders + 1);
    });

    it("loads what a patched clip adds before painting, rebuilding only the node it changed", async () => {
        const { registry, log } = probeRegistry();
        const trio = (fill?: string) => comp([
            node("p", "probe", { width: 10, height: 10, ...(fill && { fill: Fills.image(fill) }) }),
            node("q", "probe", { width: 10, height: 10 }),
            node("r", "probe", { width: 10, height: 10 }),
        ], [1]);
        const { controller, storage, rc } = openController(project([track("a", trio())]), { registry });
        await controller.seek(5);
        const loadedAt: number[] = [];
        const load = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            if (key === "new.png") loadedAt.push(rc.renderCount);
            return load(key, record);
        };
        const renders = rc.renderCount;

        controller.setProject(project([track("a", trio("new.png"))]));
        expect(controller.precomp.assets.has("new.png")).toBe(true);
        // The track was patched, not rebuilt: one node is new.
        expect(log.constructed).toEqual(["p", "q", "r", "p"]);

        await controller.whenReplaced();
        expect(loadedAt).toEqual([renders]);
        expect(rc.renderCount).toBe(renders + 1);
        controller.dispose();
    });

    it("a seek during the swap supersedes its paint", async () => {
        const { controller, clock, storage, rc, a } = await parkedInB();

        // Park only the swap's load; the seek's own must resolve or it hangs.
        let releaseLoad!: () => void;
        const gate = new Promise<void>((resolve) => { releaseLoad = resolve; });
        const realLoad = storage.loadAsset.bind(storage);
        let gated = false;
        storage.loadAsset = (key, record) => {
            realLoad(key, record);
            if (!gated) { gated = true; return gate; }
            return Promise.resolve();
        };

        controller.setProject(project([a, track("b", clip(1, { fill: Fills.image("new.png") }), { startAt: 1 })]));

        await controller.seek(2);
        const rendersAfterSeek = rc.renderCount;

        releaseLoad();
        await controller.whenReplaced();
        await flush();

        expect(gated).toBe(true);
        expect(rc.renderCount).toBe(rendersAfterSeek);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.2, 6);
    });
});
