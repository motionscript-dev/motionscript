import { describe, it, expect, vi } from "vitest";
import type { AssetScope } from "@/assets/scope";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { PlaybackController } from "@/runtime/playback-controller";
import { SETTLE_PASSES } from "@/runtime/settle";
import { comp, node, openController, probeRegistry, project, still, track } from "@/runtime/document.fixtures";
import { FakeAudioSink, FakeMeasureContext, FakeRenderContext } from "@/runtime/runtime.fixtures";
import { generated } from "@/components/factory/tests/generated.fixtures";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Let background discovery finish, so a later adoption cannot land mid-test. */
async function settle(controller: PlaybackController): Promise<void> {
    for (let i = 0; i < 20 && !controller.precomp.complete; i++) await flush();
}

const probe = (id = "p") => node(id, "probe", { width: 10, height: 10, key: id });
/** Half a second of `vo.mp3`, from the row's start. */
const voiceover = () => node("vo", "sound", { src: "vo.mp3", trimEnd: 0.5 });

/** One track of one second — ten frames at the fixture's rate — holding a probe. */
function makeController(onDeclare?: (assets: AssetScope, call: number) => void) {
    const { registry, log } = probeRegistry(onDeclare);
    return { ...openController(project([track("a", comp([probe()], [1]))]), { registry }), log };
}

describe("PlaybackController – construction", () => {
    it("derives spans and totals, and configures the clock duration", () => {
        const { controller, clock } = makeController();
        expect(controller.spans).toEqual([{ id: "a", index: 0, startFrame: 0, endFrame: 9 }]);
        expect(controller.totalFrames).toBe(10);
        expect(controller.totalDuration).toBeCloseTo(1, 6);
        expect(clock.duration).toBeCloseTo(1, 6);
    });

    it("runs as far as the furthest track reaches, gaps included", () => {
        const { controller, clock } = openController(project([
            track("a", still(), { duration: 1 }),
            track("b", still(), { startAt: 2, duration: 0.5 }),
        ]));
        expect(controller.spans.map(s => [s.startFrame, s.endFrame])).toEqual([[0, 9], [20, 24]]);
        expect(controller.totalFrames).toBe(25);
        expect(clock.duration).toBeCloseTo(2.5, 6);
    });

    it("reports currentFrame as clock time × fps", () => {
        const { controller, clock } = makeController();
        clock.setTime(0.5);
        expect(controller.currentFrame).toBe(5);
    });
});

describe("PlaybackController – seek", () => {
    it("pauses, seeks the clock, and renders the frame", async () => {
        const { controller, clock, rc, log } = makeController();
        await controller.seek(5);

        expect(clock.isPlaying).toBe(false);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.5, 6);
        expect(rc.renderCount).toBeGreaterThanOrEqual(1);
        expect(log.renderTimes.at(-1)).toBeCloseTo(0.5);
    });

    it("clamps a negative target to frame 0", async () => {
        const { controller, clock } = makeController();
        await controller.seek(-3);
        expect(clock.seekCalls.at(-1)).toBe(0);
    });

    it("clamps a target past the end to totalFrames", async () => {
        const { controller, clock } = makeController();
        await controller.seek(99999);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(1, 6);
    });

    it("a superseded seek does not render after a newer seek resolves", async () => {
        // Fast scrub: seek(5) parks on the warm re-render loop while seek(2) runs
        // to completion. When seek(5) wakes, its generation is stale, so it must
        // bail before re-rendering — otherwise frame 5 would paint over frame 2.
        const { controller, clock, storage, rc } = makeController();

        let releaseWarm!: (more: boolean) => void;
        storage.warmGate = new Promise<boolean>((res) => { releaseWarm = res; });

        const stale = controller.seek(5);
        await flush();
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.5, 6);

        storage.warmGate = null;
        await controller.seek(2);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.2, 6);
        const rendersAfterCurrentSeek = rc.renderCount;

        releaseWarm(true);
        await stale;

        expect(rc.renderCount).toBe(rendersAfterCurrentSeek);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.2, 6);
    });

    it("of two seeks issued back to back, only the newer paints", async () => {
        const { controller, clock, rc, log } = makeController();
        await controller.seek(8);
        const renders = rc.renderCount;
        const drawn = log.renders;

        const stale = controller.seek(5);
        const winner = controller.seek(2);
        await Promise.all([stale, winner]);

        expect(rc.renderCount).toBe(renders + 1);
        expect(log.renders).toBe(drawn + 1);
        expect(log.renderTimes.at(-1)).toBeCloseTo(0.2);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.2, 6);
    });
});

describe("PlaybackController – render paths load before they paint", () => {
    // Every paint waits for the frame's assets. Reaching for an unloaded one
    // throws rather than skipping the layer, so a path that painted first and
    // loaded after is not merely showing a worse frame — it is broken.
    it("screenshot loads before it captures", async () => {
        const { controller, rc } = makeController();
        const rendersBefore = rc.renderCount;
        const url = await controller.screenshot();
        expect(rc.renderCount).toBe(rendersBefore + 1);
        expect(url).toBe("data:image/png;base64,FAKE");
    });

    it("a seek loads the frame's assets before it paints, and prefetches after", async () => {
        const { controller, storage, rc } = makeController((assets) => assets.image("img.png"));
        const paintsAtLoad: number[] = [];
        const load = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            if (key === "img.png") paintsAtLoad.push(rc.renderCount);
            return load(key, record);
        };

        const before = rc.renderCount;
        await controller.seek(4);
        expect(paintsAtLoad).toEqual([before, before + 1]);
    });

    it("a clock tick renders once its assets resolve, with no extra yield", async () => {
        const { clock, rc } = makeController();
        const rendersBefore = rc.renderCount;
        await clock.simulateTick(0.3);
        expect(rc.renderCount).toBe(rendersBefore + 1);
    });

    it("a clock tick discovers the track it lands in before loading its frame", async () => {
        const { registry } = probeRegistry((assets) => assets.image("late.png"));
        const { controller, clock, storage } = openController(project([
            track("a", still(node("box", "rect", { width: 10, height: 10 })), { duration: 1 }),
            track("b", comp([probe()], [1]), { startAt: 1 }),
        ]), { registry });
        expect(controller.precomp.tracks[1].discovered).toBe(false);

        const tick = clock.simulateTick(1.2);
        expect(controller.precomp.tracks[1].discovered).toBe(true);
        await tick;
        expect(storage.loadAssetCalls.map(c => c.key)).toContain("late.png");
    });

    // A cold seek can land on a video timestamp not decoded yet; the seek warms
    // it and paints again, a bounded number of times.
    it("a seek repaints while video is still warming, at most SETTLE_PASSES times", async () => {
        const settled = makeController();
        const before = settled.rc.renderCount;
        await settled.controller.seek(4);
        expect(settled.storage.warmPendingVideoCalls).toBe(1);
        expect(settled.rc.renderCount).toBe(before + 1);

        const warming = makeController();
        warming.storage.warmGate = Promise.resolve(true);
        await warming.controller.seek(4);
        expect(warming.storage.warmPendingVideoCalls).toBe(SETTLE_PASSES);
        expect(warming.rc.renderCount).toBe(SETTLE_PASSES);
    });
});

describe("PlaybackController – render issues", () => {
    it("reports typed issues once per kind, feature and node, and bare strings as shader issues", async () => {
        const { controller, rc } = makeController();
        const seen: number[] = [];
        controller.onRenderError = (errors) => seen.push(errors.length);
        rc.takeRenderIssues = () => [
            { kind: "missing", feature: "blend:color-dodge", nodeId: "p", message: "color-dodge is not drawn" },
            { kind: "missing", feature: "blend:color-dodge", nodeId: "p", message: "color-dodge is not drawn" },
            { kind: "missing", feature: "blend:color-dodge", nodeId: "q", message: "color-dodge is not drawn" },
            "A shader that does not compile",
        ];
        await controller.seek(1);
        await controller.seek(2);

        const issues = controller.buildErrors.map((e) => e.issue);
        expect(issues).toEqual([
            { kind: "missing", feature: "blend:color-dodge", nodeId: "p", message: "color-dodge is not drawn" },
            { kind: "missing", feature: "blend:color-dodge", nodeId: "q", message: "color-dodge is not drawn" },
            { kind: "shader", message: "A shader that does not compile" },
        ]);
        expect(controller.buildErrors[0].nodeId).toBe("p");
        expect(seen).toEqual([1, 2, 3]);
    });
});

describe("PlaybackController – play / pause wiring", () => {
    it("starts the clock and forwards play to the audio device", () => {
        const { controller, clock, audio } = makeController();
        clock.setTime(0);
        controller.play(2, true);

        expect(clock.isPlaying).toBe(true);
        expect(audio.playCalls.at(-1)).toEqual({ time: 0, speed: 2, reverse: true });
    });

    it("stops audio on pause and fires user pause listeners", () => {
        const { controller, audio } = makeController();
        const onPause = vi.fn();
        controller.onPause(onPause);
        controller.pause();

        expect(audio.stopCount).toBeGreaterThanOrEqual(1);
        expect(onPause).toHaveBeenCalled();
    });

    it("restarts from the beginning when play() is called at the end", async () => {
        const { controller, clock } = makeController();
        clock.setTime(1);
        controller.play();
        await flush();
        expect(clock.seekCalls).toContain(0);
    });

    it("forwards time updates to user onTime listeners", () => {
        const { controller, clock } = makeController();
        const onTime = vi.fn();
        controller.onTime(onTime);
        clock.setTime(0.3);
        expect(onTime).toHaveBeenCalledWith(0.3);
    });
});

describe("PlaybackController – tick loop", () => {
    it("syncs audio and renders on each tick within the timeline", async () => {
        const { clock, audio, rc } = makeController();
        const before = rc.renderCount;
        await clock.simulateTick(0.5);

        expect(audio.syncToCalls).toContain(0.5);
        expect(rc.renderCount).toBeGreaterThan(before);
        expect(clock.isPlaying).toBe(false);
    });

    it("pauses automatically once a tick reaches the final frame", async () => {
        const { controller, clock, audio } = makeController();
        controller.play();
        expect(clock.isPlaying).toBe(true);
        await clock.simulateTick(1.0);

        expect(clock.isPlaying).toBe(false);
        expect(audio.syncToCalls).toContain(1.0);
    });
});

describe("PlaybackController – audio", () => {
    it("schedules the audio in reach of the frame, placed on the project timeline", async () => {
        const { controller, audio, storage } = openController(project([
            track("a", comp([voiceover()], [1])),
            track("b", comp([voiceover()], [1]), { startAt: 1 }),
        ]));
        await settle(controller);

        // `a`'s clip ended half a second before the playhead; `b`'s is under it.
        await controller.seek(12);
        expect(audio.scheduleCalls.at(-1)!.map(r => [r.src, r.startAt, r.endAt])).toEqual([["vo.mp3", 1, 1.5]]);
        expect(storage.fetchAudioCalls).toEqual(["vo.mp3"]);

        const scheduled = audio.scheduleCalls.length;
        await controller.seek(13);
        expect(audio.scheduleCalls).toHaveLength(scheduled);
    });
});

describe("PlaybackController – screenshot & introspection", () => {
    it("returns the render context screenshot", async () => {
        const { controller, rc } = makeController();
        expect(await controller.screenshot()).toBe(rc.screenshotValue);
    });

    it("builds the current track's tree state, with node lifespans", async () => {
        const { controller } = openController(project([
            track("a", comp([node("child", "rect", { width: 10, height: 10 })], [1])),
        ]));
        expect(controller.getTreeState()).toBeNull();
        await controller.seek(0);

        expect(controller.getTreeState()).toEqual({
            id: expect.any(String),
            path: "",
            type: "Canvas2D",
            startFrame: 0,
            endFrame: 9,
            children: [{ id: expect.any(String), path: "0", type: "Rect", startFrame: 0, endFrame: 9, children: [] }],
        });
    });

    // Lifespans are shifted onto the project timeline; waveform times stay in
    // the clip's own seconds, as they always have.
    it("places the track on screen's lifespans on the project timeline, and its waveforms on their nodes", async () => {
        const { controller } = openController(project([
            track("a", still(node("box", "rect", { width: 10, height: 10 })), { duration: 1 }),
            track("b", comp([voiceover()], [1]), { startAt: 1 }),
        ]));
        await controller.seek(15);

        const tree = controller.getTreeState()!;
        expect(tree).toMatchObject({ startFrame: 10, endFrame: 19 });
        expect(tree.children[0]).toMatchObject({
            startFrame: 10,
            endFrame: 19,
            waveform: [{ src: "vo.mp3", startTime: 0, endTime: 0.5 }],
        });
    });

    it("returns a node state for a known id", async () => {
        const { controller } = openController(project([
            track("a", still(node("child", "rect", { width: 10, height: 10 })), { duration: 1 }),
        ]));
        await controller.seek(0);
        const id = controller.getTreeState()!.children[0].id;
        expect(controller.getNodeState(id)).toMatchObject({ id, type: "Rect", properties: { width: 10, height: 10 } });
    });

    it("returns null for an unknown node id", async () => {
        const { controller } = makeController();
        await controller.seek(0);
        expect(controller.getNodeState("does-not-exist")).toBeNull();
    });
});

describe("PlaybackController – direct manipulation", () => {
    /** A 100×60 card holding a 20×20 child, tweening to x 200 over a second, then holding half a second. */
    function makeCardController() {
        return openController(project([track("a", comp([
            node("card", "rect", { width: 100, height: 60 }),
            node("inner", "rect", { width: 20, height: 20 }, "card"),
        ], [{ target: "card", args: { x: 200 }, duration: 1 }, 0.5]))], { viewport: { width: 800, height: 600 } }));
    }

    const cardId = (controller: PlaybackController) => controller.getTreeState()!.children[0].id;

    it("exposes a structural path on every tree node", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);
        const tree = controller.getTreeState()!;
        expect(tree.path).toBe("");
        expect(tree.children[0].path).toBe("0");
        expect(tree.children[0].children[0].path).toBe("0.0");
    });

    it("getNodeBox resolves a path to an on-screen box", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);

        const box = controller.getNodeBox("0")!;
        expect(box.id).toBe(cardId(controller));
        expect(box.type).toBe("Rect");
        expect(box.width).toBe(100);
        expect(box.height).toBe(60);
        expect(box.center.x).toBeCloseTo(0, 6);
        expect(box.center.y).toBeCloseTo(0, 6);
        expect(controller.getNodeBox("0.0")!.width).toBe(20);
    });

    it("getNodeBox returns null for a path the tree does not have", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);
        expect(controller.getNodeBox("7")).toBeNull();
        expect(controller.getNodeBox("0.9.3")).toBeNull();
    });

    it("getNodeBoxes walks the whole track in draw order", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);
        expect(controller.getNodeBoxes().map(b => b.path)).toEqual(["0", "0.0"]);
    });

    it("pickNode finds the node under a viewport point, and the topmost one", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);

        expect(controller.pickNode({ x: 0, y: 0 })!.path).toBe("0.0");
        expect(controller.pickNode({ x: 40, y: 0 })!.id).toBe(cardId(controller));
        expect(controller.pickNode({ x: 300, y: 0 })).toBeNull();
    });

    it("setNodeOverride moves the live node and survives a seek away and back", async () => {
        const { controller } = makeCardController();
        await controller.seek(10);
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(200, 6);

        controller.setNodeOverride("0", { x: -150 });
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(-150, 6);

        // Every evaluation rewrites `x`; the override is re-applied after each.
        await controller.seek(3);
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(-150, 6);
        await controller.seek(10);
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(-150, 6);
    });

    it("merges successive overrides for the same node", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);
        controller.setNodeOverride("0", { x: 40 });
        controller.setNodeOverride("0", { y: 25 });
        const center = controller.getNodeBox("0")!.center;
        expect(center.x).toBeCloseTo(40, 6);
        expect(center.y).toBeCloseTo(25, 6);
    });

    it("clearNodeOverrides restores the document's value", async () => {
        const { controller } = makeCardController();
        await controller.seek(10);
        controller.setNodeOverride("0", { x: -150 });
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(-150, 6);

        controller.clearNodeOverrides();
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(200, 6);
    });

    it("clearNodeOverrides(path) drops only that node", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);
        controller.setNodeOverride("0", { x: 40 });
        controller.setNodeOverride("0.0", { x: 10 });

        controller.clearNodeOverrides("0.0");
        expect(controller.getNodeBox("0")!.center.x).toBeCloseTo(40, 6);
        // The child is back on its parent's centre (its own x reset to 0).
        expect(controller.getNodeBox("0.0")!.center.x).toBeCloseTo(40, 6);
    });

    it("setEditorStates repaints the frame with the node hidden, and again once cleared", async () => {
        const { controller, rc, log } = makeController();
        await controller.seek(3);
        const renders = rc.renderCount;
        const drawn = log.renders;

        controller.setEditorStates("a", { p: { hidden: true } });
        expect(rc.renderCount).toBe(renders + 1);
        expect(log.renders).toBe(drawn);

        controller.setEditorStates("a", undefined);
        expect(log.renders).toBe(drawn + 1);
    });

    it("repaint renders the current frame without advancing it", async () => {
        const { controller, rc, clock } = makeCardController();
        await controller.seek(4);
        const before = rc.renderCount;
        const time = clock.currentTime;

        controller.repaint();

        expect(rc.renderCount).toBe(before + 1);
        expect(clock.currentTime).toBe(time);
        expect(controller.currentFrame).toBe(4);
    });

    // A host adjusts the surface and the view the moment its container measures,
    // which is before the mount seek has loaded anything. Painting there drew a
    // frame with no pixels behind its media fills — an AssetNotLoadedError on
    // open, about an asset that was loading fine. The seek in flight is the first
    // real frame; there is nothing for a repaint to preserve until it lands.
    it("repaint draws nothing until a frame has been rendered", async () => {
        const { controller, rc } = makeCardController();
        expect(rc.renderCount).toBe(0);

        controller.repaint();
        controller.repaint();

        expect(rc.renderCount).toBe(0);

        await controller.seek(0);
        const after = rc.renderCount;
        controller.repaint();
        expect(rc.renderCount).toBe(after + 1);
    });

    it("an override on a stale path is silently ignored", async () => {
        const { controller } = makeCardController();
        await controller.seek(0);
        expect(() => controller.setNodeOverride("9.9", { x: 1 })).not.toThrow();
        expect(controller.getNodeBox("0")!.center.x).toBe(0);
    });
});

describe("PlaybackController – errors", () => {
    it("reports a clip that fails to build against its track", () => {
        const { registry } = probeRegistry();
        registry.addNode("broken", class extends generated(Rect) {
            constructor(...args: ConstructorParameters<typeof Rect>) {
                super(...args);
                throw new Error("cannot build");
            }
        } as never);
        const { controller } = openController(project([track("bad", comp([node("x", "broken")], [1]))]), { registry });
        expect(controller.buildErrors).toEqual([
            expect.objectContaining({ trackId: "bad", message: expect.stringContaining("cannot build") }),
        ]);
        controller.dispose();
    });

    it("reports a frame that throws while drawing once, against the track on screen", async () => {
        class Throwing extends FakeRenderContext {
            override execute(): void {
                this.renderCount++;
                throw new Error("boom");
            }
        }
        const rc = new Throwing();
        const { controller } = openController(project([track("a", comp([probe()], [1]))]), {
            registry: probeRegistry().registry,
            renderContext: rc,
        });
        const reports: number[] = [];
        controller.onRenderError = (errors) => reports.push(errors.length);

        await controller.seek(2);
        await controller.seek(3);

        // One bad frame does not stop the next from being attempted.
        expect(rc.renderCount).toBe(2);
        expect(controller.buildErrors).toEqual([expect.objectContaining({ trackId: "a", message: "boom" })]);
        expect(reports).toEqual([1]);
    });
});

describe("PlaybackController – dispose", () => {
    it("tears down the clock, the audio device, and the tracks' trees", async () => {
        const { controller, clock, audio } = makeController();
        await controller.seek(0);
        expect(controller.getTreeState()).not.toBeNull();

        controller.dispose();
        expect(clock.disposeCount).toBe(1);
        expect(audio.stopCount).toBeGreaterThanOrEqual(1);
        expect(controller.getTreeState()).toBeNull();
    });

    it("does not render when an in-flight seek resolves after dispose", async () => {
        // StrictMode double-mount / HMR: a seek() started on a controller that is
        // then disposed must not render into the now-freed surface.
        const { controller, rc } = makeController();
        const renders = rc.renderCount;

        const pending = controller.seek(5);
        controller.dispose();
        await pending;

        expect(rc.renderCount).toBe(renders);
    });

    it("seek is a no-op once disposed", async () => {
        const { controller, rc } = makeController();
        controller.dispose();
        const renders = rc.renderCount;
        await controller.seek(3);
        expect(rc.renderCount).toBe(renders);
    });

    it("does not render on a tick that completes after dispose", async () => {
        const { controller, clock, rc } = makeController();
        const renders = rc.renderCount;
        const tick = clock.simulateTick(0.5);
        controller.dispose();
        await tick;
        expect(rc.renderCount).toBe(renders);
    });
});

// ─── Lifecycle options, supersession and the editor surface ───────────────────

describe("PlaybackController – seekWhilePlaying", () => {
    it("moves the clock to the frame, in seconds, without pausing it", () => {
        const { controller, clock, audio } = makeController();
        controller.play();
        const stopped = audio.stopCount;

        controller.seekWhilePlaying(6);

        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.6, 9);
        expect(controller.isPlaying).toBe(true);
        expect(audio.stopCount).toBe(stopped);
    });

    it("clamps to the start and to the end of the timeline", () => {
        const { controller, clock } = makeController();
        controller.seekWhilePlaying(-4);
        expect(clock.seekCalls.at(-1)).toBe(0);
        controller.seekWhilePlaying(5000);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(1, 9);
    });

    it("does not paint: the next tick does", async () => {
        const { controller, clock, rc } = makeController();
        const renders = rc.renderCount;

        controller.seekWhilePlaying(4);
        expect(rc.renderCount).toBe(renders);

        await clock.simulateTick(0.4);
        expect(rc.renderCount).toBe(renders + 1);
    });

    it("invalidates a paused seek still on its way, so that seek cannot paint over the live position", async () => {
        const { controller, clock, storage, rc } = makeController();
        let releaseWarm!: (more: boolean) => void;
        storage.warmGate = new Promise<boolean>((res) => { releaseWarm = res; });

        const stale = controller.seek(5);
        await flush();
        storage.warmGate = null;
        controller.seekWhilePlaying(2);
        const renders = rc.renderCount;

        releaseWarm(true);
        await stale;

        expect(rc.renderCount).toBe(renders);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.2, 9);
    });

    it("is not the pause a paused seek does: a paused seek stops the clock first", async () => {
        const { controller, clock } = makeController();
        controller.play();
        await controller.seek(3);
        expect(clock.isPlaying).toBe(false);
    });
});

describe("PlaybackController – screenshot supersession", () => {
    it("returns undefined for a screenshot a newer seek overtook while its decodes were settling", async () => {
        const { controller, storage, rc } = makeController();
        let releaseWarm!: (more: boolean) => void;
        storage.warmGate = new Promise<boolean>((res) => { releaseWarm = res; });

        const shot = controller.screenshot();
        await flush();
        storage.warmGate = null;
        await controller.seek(3);
        const renders = rc.renderCount;

        releaseWarm(true);

        expect(await shot).toBeUndefined();
        expect(rc.renderCount).toBe(renders);
    });

    it("returns undefined for a screenshot overtaken before it began to settle", async () => {
        const { controller } = makeController();
        const shot = controller.screenshot();
        const seek = controller.seek(2);
        await Promise.all([shot, seek]);
        expect(await shot).toBeUndefined();
    });

    it("returns the capture when nothing overtakes it", async () => {
        const { controller, rc } = makeController();
        rc.screenshotValue = "data:image/png;base64,CAPTURED";
        expect(await controller.screenshot()).toBe("data:image/png;base64,CAPTURED");
    });

    it("waits for the upgrades a preview paints behind, since a capture is kept", async () => {
        const { controller, storage } = makeController();
        storage.pendingUpgrades = true;

        await controller.screenshot();

        expect(storage.warmPendingUpgradesCalls).toBeGreaterThanOrEqual(1);
        expect(storage.pendingUpgrades).toBe(false);
    });
});

describe("PlaybackController – onFramePainted", () => {
    it("is told each frame it paints, as a whole frame number, after the draw", async () => {
        const { controller, rc } = makeController();
        const painted: { frame: number; renders: number }[] = [];
        controller.onFramePainted = (frame) => painted.push({ frame, renders: rc.renderCount });

        await controller.seek(4);
        await controller.seek(7);

        expect(painted.map((p) => p.frame)).toEqual([4, 7]);
        // Called after the draw, not before it.
        expect(painted[0].renders).toBeGreaterThanOrEqual(1);
    });

    it("tells it the whole frame a fractional position lies in", async () => {
        const { controller, clock } = makeController();
        const painted: number[] = [];
        controller.onFramePainted = (frame) => painted.push(frame);

        await clock.simulateTick(0.37);

        expect(painted).toEqual([3]);
    });

    it("logs a listener that throws and carries on rather than failing the frame", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => { });
        try {
            const { controller } = makeController();
            const calls: number[] = [];
            controller.onFramePainted = (frame) => {
                calls.push(frame);
                throw new Error("listener broke");
            };

            await expect(controller.seek(2)).resolves.toBeUndefined();
            await expect(controller.seek(3)).resolves.toBeUndefined();

            // It was not unsubscribed by failing, and each failure was reported.
            expect(calls).toEqual([2, 3]);
            expect(error).toHaveBeenCalledTimes(2);
            expect(String(error.mock.calls[0][0])).toContain("onFramePainted listener threw");
            expect(controller.buildErrors).toEqual([]);
        } finally {
            error.mockRestore();
        }
    });

    it("does not mistake a throwing listener for a render failure: no render error is reported", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => { });
        try {
            const { controller } = makeController();
            const reported = vi.fn();
            controller.onRenderError = reported;
            controller.onFramePainted = () => { throw new Error("listener broke"); };

            await controller.seek(2);

            expect(reported).not.toHaveBeenCalled();
        } finally {
            error.mockRestore();
        }
    });

    it("is still told of a frame whose draw failed, since the frame has landed", async () => {
        class Throwing extends FakeRenderContext {
            override execute(): void {
                this.renderCount++;
                throw new Error("boom");
            }
        }
        const { controller } = openController(project([track("a", comp([probe()], [1]))]), {
            registry: probeRegistry().registry,
            renderContext: new Throwing(),
        });
        const painted: number[] = [];
        controller.onFramePainted = (frame) => painted.push(frame);

        await controller.seek(2);

        expect(painted).toEqual([2]);
    });
});

describe("PlaybackController – setMuted and clearRenderErrors", () => {
    it("setMuted reaches the audio device", () => {
        class MuteRecorder extends FakeAudioSink {
            calls: boolean[] = [];
            override setMuted(muted: boolean): void { this.calls.push(muted); }
        }
        const audio = new MuteRecorder();
        const { controller } = openController(project([track("a", comp([probe()], [1]))]), {
            registry: probeRegistry().registry,
            audioDevice: audio,
        });

        controller.setMuted(true);
        controller.setMuted(false);

        expect(audio.calls).toEqual([true, false]);
    });

    function failingController() {
        class Throwing extends FakeRenderContext {
            fail = true;
            override execute(draw: () => void): void {
                this.renderCount++;
                if (this.fail) throw new Error("boom");
                draw();
            }
        }
        const rc = new Throwing();
        const opened = openController(project([track("a", comp([probe()], [1]))]), {
            registry: probeRegistry().registry,
            renderContext: rc,
        });
        return { ...opened, rc };
    }

    it("forgets the errors a draw reported, and tells the host the list that is left", async () => {
        const { controller } = failingController();
        const reports: number[] = [];
        controller.onRenderError = (errors) => reports.push(errors.length);
        await controller.seek(2);
        expect(controller.buildErrors).toHaveLength(1);

        controller.clearRenderErrors();

        expect(controller.buildErrors).toEqual([]);
        expect(reports).toEqual([1, 0]);
    });

    it("leaves the errors discovery found alone", async () => {
        const { registry } = probeRegistry();
        registry.addNode("broken", class extends generated(Rect) {
            constructor(...args: ConstructorParameters<typeof Rect>) {
                super(...args);
                throw new Error("cannot build");
            }
        } as never);
        const { controller } = openController(project([track("bad", comp([node("x", "broken")], [1]))]), { registry });
        const before = controller.buildErrors;

        controller.clearRenderErrors();

        expect(controller.buildErrors).toEqual(before);
        expect(controller.buildErrors).toHaveLength(1);
        controller.dispose();
    });

    it("says nothing when there was nothing to forget", () => {
        const { controller } = makeController();
        const onRenderError = vi.fn();
        controller.onRenderError = onRenderError;

        controller.clearRenderErrors();

        expect(onRenderError).not.toHaveBeenCalled();
    });

    it("lets the same failure be reported again afterwards, since reports are deduplicated by message", async () => {
        const { controller } = failingController();
        await controller.seek(2);
        await controller.seek(3);
        expect(controller.buildErrors).toHaveLength(1);

        controller.clearRenderErrors();
        await controller.seek(4);

        expect(controller.buildErrors).toHaveLength(1);
        expect(controller.buildErrors[0].message).toBe("boom");
    });

    it("is what a document swap does, so errors about the old document do not outlive it", async () => {
        const { controller } = failingController();
        await controller.seek(2);
        expect(controller.buildErrors).toHaveLength(1);

        controller.setProject(project([track("a", comp([probe()], [1]))]));

        expect(controller.buildErrors).toEqual([]);
    });
});

describe("PlaybackController – trimming built trees around the playhead", () => {
    /** Five seconds, so the playhead has room to travel several seconds' worth of frames. */
    const makeController = () => openController(
        project([track("a", comp([probe()], [5]))]), { registry: probeRegistry().registry },
    );
    const trimSpy = (controller: PlaybackController) =>
        vi.spyOn((controller as unknown as { store: { trim: (frame: number, horizon: number) => void } }).store, "trim");

    it("does not trim for movement of less than a second's worth of frames", async () => {
        const { controller } = makeController();
        const trim = trimSpy(controller);

        await controller.seek(3);
        await controller.seek(9);

        expect(trim).not.toHaveBeenCalled();
    });

    it("trims once the playhead has moved a full fps frames from where it last trimmed", async () => {
        const { controller } = makeController();
        const trim = trimSpy(controller);

        await controller.seek(10);

        expect(trim).toHaveBeenCalledTimes(1);
        // The frame, and thirty seconds of horizon in frames (the fixture runs at 10 fps).
        expect(trim).toHaveBeenCalledWith(10, 300);
    });

    it("measures the next stretch from the last trim, not from the last frame", async () => {
        const { controller } = makeController();
        const trim = trimSpy(controller);

        await controller.seek(10);
        await controller.seek(14);
        await controller.seek(19);
        expect(trim).toHaveBeenCalledTimes(1);

        await controller.seek(20);
        expect(trim).toHaveBeenCalledTimes(2);
    });

    it("trims after movement in either direction", async () => {
        const { controller } = makeController();
        await controller.seek(10);
        const trim = trimSpy(controller);

        await controller.seek(0);

        expect(trim).toHaveBeenCalledTimes(1);
        expect(trim).toHaveBeenCalledWith(0, 300);
    });

    it("trims from a clock tick as well, by the same rule", async () => {
        const { controller, clock } = makeController();
        const trim = trimSpy(controller);

        await clock.simulateTick(0.5);
        expect(trim).not.toHaveBeenCalled();
        await clock.simulateTick(1);
        expect(trim).toHaveBeenCalledTimes(1);
        await clock.simulateTick(1.4);
        expect(trim).toHaveBeenCalledTimes(1);
        await clock.simulateTick(2);
        expect(trim).toHaveBeenCalledTimes(2);
    });

    it("trims by the whole frame a fractional position lies in", async () => {
        const { controller, clock } = makeController();
        const trim = trimSpy(controller);

        await clock.simulateTick(1.07);

        expect(trim).toHaveBeenCalledWith(10, 300);
    });
});

describe("PlaybackController – text layout, 3D projection and plane points", () => {
    /** A scope that keeps a caret model: four characters, ten wide each, on one line. */
    class CaretMeasurer extends FakeMeasureContext {
        layoutTextBlock() {
            return { lines: [{ start: 0, end: 4, top: -10, bottom: 10, carets: [-20, -10, 0, 10, 20] }], width: 40, height: 20 };
        }
    }

    const viewport = { width: 800, height: 600 };

    describe("getTextLayout", () => {
        const withText = (measurer: FakeMeasureContext) => openController(
            project([track("a", comp([
                node("title", "text", { text: "abcd", x: 100, y: 50 }),
                node("box", "rect", { width: 10, height: 10 }),
            ], [1]))], { viewport }),
            { measurer },
        );

        it("reports a text node's caret slots, one more than it has characters", async () => {
            const { controller } = withText(new CaretMeasurer());
            await controller.seek(0);

            const layout = controller.getTextLayout("0");

            expect(layout).not.toBeNull();
            expect(layout!.path).toBe("0");
            expect(layout!.text).toBe("abcd");
            expect(layout!.carets.map((c) => c.offset)).toEqual([0, 1, 2, 3, 4]);
        });

        it("places the slots around the node in viewport space", async () => {
            const { controller } = withText(new CaretMeasurer());
            await controller.seek(0);

            const carets = controller.getTextLayout("0")!.carets;
            // Block-local x carries straight across, offset by the node's own x.
            expect(carets[0].top.x).toBeCloseTo(80, 6);
            expect(carets[4].top.x).toBeCloseTo(120, 6);
        });

        it("is null for a node that is not text", async () => {
            const { controller } = withText(new CaretMeasurer());
            await controller.seek(0);
            expect(controller.getTextLayout("1")).toBeNull();
        });

        it("is null for a path the tree does not have", async () => {
            const { controller } = withText(new CaretMeasurer());
            await controller.seek(0);
            expect(controller.getTextLayout("9")).toBeNull();
            expect(controller.getTextLayout("0.4.2")).toBeNull();
        });

        it("is null when the measurer keeps no glyph positions", async () => {
            const { controller } = withText(new FakeMeasureContext());
            await controller.seek(0);
            expect(controller.getTextLayout("0")).toBeNull();
        });

        it("is null before any frame has been built", () => {
            const { controller } = withText(new CaretMeasurer());
            expect(controller.getTextLayout("0")).toBeNull();
        });
    });

    describe("projectNode3D", () => {
        const view3d = () => openController(
            project([track("a", comp([
                node("view", "canvas3d", { width: 400, height: 300 }),
                node("cam", "camera3d", { position: [0, 0, 10], lookAt: 0 }, "view", 0),
                node("cube", "box3d", { width: 2 }, "view", 1),
                node("label", "text", { text: "hi" }, "view", 2),
            ], [1]))], { viewport }),
        );

        it("projects a mesh's origin to the middle of the viewport it sits in front of", async () => {
            const { controller } = view3d();
            await controller.seek(0);

            const frame = controller.projectNode3D("0.1", [], []);

            expect(frame).not.toBeNull();
            expect(frame!.origin!.x).toBeCloseTo(0, 6);
            expect(frame!.origin!.y).toBeCloseTo(0, 6);
            expect(frame!.parentPoints).toEqual([]);
            expect(frame!.localPoints).toEqual([]);
        });

        it("projects the points asked for, moving +X in the scene to +X on screen", async () => {
            const { controller } = view3d();
            await controller.seek(0);

            const frame = controller.projectNode3D("0.1", [{ x: 1, y: 0, z: 0 }], [{ x: 0, y: 1, z: 0 }])!;

            expect(frame.parentPoints[0]!.x).toBeGreaterThan(frame.origin!.x);
            expect(frame.localPoints[0]!.y).toBeGreaterThan(frame.origin!.y);
        });

        it("is null for a path that names a 2D node, an unknown path, or the viewport itself", async () => {
            const { controller } = view3d();
            await controller.seek(0);

            expect(controller.projectNode3D("0.2", [], [])).toBeNull();
            expect(controller.projectNode3D("0.9", [], [])).toBeNull();
            expect(controller.projectNode3D("0", [], [])).toBeNull();
        });

        it("is null before any frame has been built", () => {
            const { controller } = view3d();
            expect(controller.projectNode3D("0.1", [], [])).toBeNull();
        });
    });

    describe("parentPlanePoint", () => {
        const nested = () => openController(
            project([track("a", comp([
                node("card", "rect", { width: 200, height: 100, x: 100, y: 40 }),
                node("inner", "rect", { width: 20, height: 20 }, "card"),
            ], [1]))], { viewport }),
        );

        it("maps a viewport point onto the plane of the node's parent, centred on the parent", async () => {
            const { controller } = nested();
            await controller.seek(0);

            // The card is centred at (100, 40) in the viewport and holds the inner node.
            const point = controller.parentPlanePoint("0.0", { x: 130, y: 70 })!;
            expect(point.x).toBeCloseTo(30, 6);
            expect(point.y).toBeCloseTo(30, 6);
        });

        it("is the viewport frame itself for a top-level node, whose parent is the root", async () => {
            const { controller } = nested();
            await controller.seek(0);

            const point = controller.parentPlanePoint("0", { x: 130, y: 70 })!;
            expect(point.x).toBeCloseTo(130, 6);
            expect(point.y).toBeCloseTo(70, 6);
        });

        it("gives two points that differ by exactly the move that carries a node from one to the other", async () => {
            const { controller } = nested();
            await controller.seek(0);

            const from = controller.parentPlanePoint("0.0", { x: 100, y: 40 })!;
            const to = controller.parentPlanePoint("0.0", { x: 150, y: 90 })!;
            expect(to.x - from.x).toBeCloseTo(50, 6);
            expect(to.y - from.y).toBeCloseTo(50, 6);
        });

        it("is null for the root, an unknown path, and before any frame is built", async () => {
            const { controller } = nested();
            expect(controller.parentPlanePoint("0", { x: 0, y: 0 })).toBeNull();

            await controller.seek(0);
            expect(controller.parentPlanePoint("", { x: 0, y: 0 })).toBeNull();
            expect(controller.parentPlanePoint("7", { x: 0, y: 0 })).toBeNull();
        });
    });
});
