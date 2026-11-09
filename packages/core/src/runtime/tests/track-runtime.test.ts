import { describe, expect, it } from "vitest";
import type { AudioDocument } from "@/document/types";
import { Rect } from "@/components/builtins/geometry/geometry";
import {
    comp,
    evaluatorFor,
    node,
    openController,
    precompFor,
    probeRegistry,
    project,
    still,
    track,
} from "@/runtime/document.fixtures";
import { FakeRenderContext } from "@/runtime/runtime.fixtures";
import { generated } from "@/components/factory/tests/generated.fixtures";

const probe = (id = "p") => node(id, "probe", { width: 10, height: 10 });
const fade = (target: string) => ({ target, args: { opacity: 0.5 }, duration: 1 });

const music: AudioDocument = {
    kind: "audio",
    duration: 1,
    nodes: [{ id: "m", type: "sound", parentId: null, layerOrder: 0, props: { src: "music.mp3" } }],
    commands: [],
};

describe("StateEvaluator over a project", () => {
    it("draws a track on its own clock, wherever it sits", () => {
        const { registry, log } = probeRegistry();
        const evaluator = evaluatorFor(project([track("a", comp([probe()], [fade("p")]), { startAt: 1 })]), { registry });
        evaluator.stateAt(15);
        evaluator.render(new FakeRenderContext());
        expect(log.renderTimes.at(-1)).toBeCloseTo(0.5);
    });

    it("keeps a track's tree when only its placement changes", () => {
        const clip = comp([probe()], [fade("p")]);
        const evaluator = evaluatorFor(project([track("a", clip)]), { registry: probeRegistry().registry });
        evaluator.stateAt(0);
        const built = evaluator.currentCanvas;

        evaluator.setProject(project([track("a", clip, { startAt: 0.5 })]));
        evaluator.stateAt(5);
        expect(evaluator.currentCanvas).toBe(built);
    });

    it("keeps a track's tree for an equal clip, and builds afresh for an edit it cannot patch", () => {
        const { registry, log } = probeRegistry();
        const evaluator = evaluatorFor(project([track("a", comp([probe()], [fade("p")]))]), { registry });
        evaluator.stateAt(0);
        const built = evaluator.currentCanvas;

        evaluator.setProject(project([track("a", comp([probe()], [fade("p")]))]));
        evaluator.stateAt(0);
        expect(evaluator.currentCanvas).toBe(built);
        expect(log.constructed).toEqual(["p"]);

        // A clip theme: colours resolve against it as props are written, so nothing built under another patches.
        evaluator.setProject(project([track("a", { ...comp([probe()], [fade("p")]), theme: { typography: { header: { fontSize: 48 } } } })]));
        evaluator.stateAt(0);
        expect(evaluator.currentCanvas).not.toBe(built);
        expect(log.constructed).toEqual(["p", "p"]);
    });

    it("draws reordered tracks in their new order without rebuilding either", () => {
        const { registry } = probeRegistry();
        const a = track("a", comp([probe()], [fade("p")]));
        const b = track("b", comp([probe()], [fade("p")]));
        const evaluator = evaluatorFor(project([a, b]), { registry });
        evaluator.stateAt(0);
        const top = evaluator.currentCanvas;

        evaluator.setProject(project([b, a]));
        evaluator.stateAt(0);
        expect(evaluator.activeTrackIds).toEqual(["b", "a"]);
        expect(evaluator.currentTrackId).toBe("a");
        evaluator.setProject(project([a, b]));
        evaluator.stateAt(0);
        expect(evaluator.currentCanvas).toBe(top);
    });

    it("drops a removed track and moves the editor to what is left", () => {
        const evaluator = evaluatorFor(project([
            track("a", comp([probe()], [fade("p")])),
            track("b", comp([probe()], [fade("p")])),
        ]), { registry: probeRegistry().registry });
        evaluator.stateAt(0);
        expect(evaluator.currentTrackId).toBe("b");

        evaluator.setProject(project([track("a", comp([probe()], [fade("p")]))]));
        evaluator.stateAt(0);
        expect(evaluator.activeTrackIds).toEqual(["a"]);
        expect(evaluator.currentTrackId).toBe("a");
    });

    it("draws nothing for a track that fails to build, and leaves the reason to discovery", () => {
        const { registry, log } = probeRegistry();
        registry.addNode("boom", class extends generated(Rect) {
            constructor(props: ConstructorParameters<typeof Rect>[0]) {
                super(props);
                throw new Error("boom");
            }
        } as never);
        const doc = project([track("a", comp([probe()], [fade("p")])), track("b", still(node("x", "boom")))]);

        const evaluator = evaluatorFor(doc, { registry });
        evaluator.stateAt(0);
        evaluator.render(new FakeRenderContext());
        expect(log.renders).toBe(1);
        expect(evaluator.currentTrackId).toBe("b");
        expect(evaluator.currentCanvas).toBeNull();

        const errors = precompFor(doc, { registry }).run().buildErrors;
        expect(errors).toEqual([expect.objectContaining({ trackId: "b", message: "boom" })]);
    });

    it("never puts the editor on an audio clip, even the topmost", () => {
        const evaluator = evaluatorFor(project([track("pic", comp([probe()], [fade("p")])), track("music", music)]), {
            registry: probeRegistry().registry,
        });
        evaluator.stateAt(0);
        expect(evaluator.activeTrackIds).toEqual(["pic", "music"]);
        expect(evaluator.currentTrackId).toBe("pic");
    });
});

describe("AssetTimeline over a project", () => {
    it("discovers only the tracks covering a frame", () => {
        const precomp = precompFor(project([
            track("a", comp([probe()], [fade("p")])),
            track("b", comp([probe()], [fade("p")]), { startAt: 5 }),
        ]), { registry: probeRegistry().registry });

        const result = precomp.ensureCovering(0);
        expect(result.tracks.map(t => t.discovered)).toEqual([true, false]);
        expect(result.complete).toBe(false);
        expect(result.totalFrames).toBe(60);
    });

    it("keeps a pass when its track only moves, and redoes it when its length changes", () => {
        const { registry, log } = probeRegistry();
        const clip = comp([probe()], [fade("p")]);
        const precomp = precompFor(project([track("a", clip)]), { registry });
        precomp.run();
        const prepared = log.declares;

        const moved = precomp.setProject(project([track("a", clip, { startAt: 2 })]));
        expect(moved.complete).toBe(true);
        expect(moved.tracks[0].startFrame).toBe(20);
        expect(log.declares).toBe(prepared);

        expect(precomp.setProject(project([track("a", clip, { duration: 2 })])).complete).toBe(false);
        precomp.run();
        expect(log.declares).toBeGreaterThan(prepared);
    });

    it("drops a pass whose track changed while it was parked, and discovers the new clip", async () => {
        const { registry } = probeRegistry();
        // Two intervals, so the pass yields between them and can be caught parked.
        const twoSteps = comp([probe()], [fade("p"), { target: "p", args: { opacity: 1 }, duration: 1 }]);
        const precomp = precompFor(project([track("a", twoSteps)]), { registry });

        const done = precomp.runAsync({ budgetMs: 0 });
        precomp.setProject(project([track("a", comp([probe("p"), probe("q")], [fade("p")]))]));
        const result = await done;

        expect(result.complete).toBe(true);
        expect(result.tracks[0].frameCount).toBe(10);
    });
});

describe("PlaybackController over a project", () => {
    it("clearing an override restores a node nothing animates", async () => {
        const { controller } = openController(project([track("a", still(node("box", "rect", { width: 10, height: 10, x: 5 })))]));
        await controller.seek(0);

        controller.setNodeOverride("0", { x: 50 });
        expect(controller.getNodePropsAt("0")).toMatchObject({ x: 50 });

        controller.clearNodeOverrides();
        expect(controller.getNodePropsAt("0")).toMatchObject({ x: 5 });
        controller.dispose();
    });
});
