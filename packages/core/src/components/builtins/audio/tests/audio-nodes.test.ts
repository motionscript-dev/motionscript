import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";
import type { AudioRequest } from "@/attributes/audio/request";
import { AudioEffects } from "@/attributes/audio/effects/chain";
import { isRamp, ramp } from "@/attributes/audio/ramp";
import { Registry } from "@/document/registry";
import type { TimedNodeSpec } from "@/document/types";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { comp, node, precompFor, project, track } from "@/runtime/document.fixtures";

import { AudioBus, SoundNode } from "@/components/builtins/audio/audio";

const SRC = "vo.mp3";
const CLIP = "clip.mp4";

function catalog(): ManifestAssetCatalog {
    const manifest: AssetManifest = {
        image: {}, font: {},
        video: { [CLIP]: { width: 80, height: 60, duration: 10, sizeBytes: 0, src: CLIP } },
        audio: { [SRC]: { duration: 10, sizeBytes: 0, src: SRC } },
    };
    return new ManifestAssetCatalog(manifest);
}

/**
 * The audio requests a clip of these rows schedules. A sound or a video plays
 * from its `play` command; a row with none gets one over its span.
 */
function requestsOf(rows: TimedNodeSpec[]): AudioRequest[] {
    return precompFor(project([track("a", comp(rows, [], 8))]), { registry: new Registry(), assets: catalog() }).run().tracks[0].audioRequests;
}

const sound = (id: string, props: Record<string, unknown> = {}, parentId: string | null = null): TimedNodeSpec =>
    node(id, "sound", { src: SRC, ...props }, parentId);
const bus = (id: string, props: Record<string, unknown> = {}, parentId: string | null = null): TimedNodeSpec =>
    node(id, "audioBus", props, parentId);

describe("the audio dimension", () => {
    it("answers 'audio', from the prototype", () => {
        expect(new AudioBus().dimension).toBe("audio");
        expect(new SoundNode().dimension).toBe("audio");
        // A getter, not a field: readable before a constructor has run.
        expect(Object.create(SoundNode.prototype).dimension).toBe("audio");
    });

    it("refuses to sit in the 2D tree, and says where it goes", () => {
        expect(() => new Rect({}).add(new SoundNode({ src: SRC })))
            .toThrow(/cannot hold .*Put audio nodes under an AudioBus/s);
    });

    it("is a leaf at the clip, a group at the bus", () => {
        expect(() => new SoundNode({ src: SRC }).add(new AudioBus())).toThrow(/cannot hold/);
        const bus = new AudioBus();
        bus.add(new SoundNode({ src: SRC }));
        expect(bus.childrenAudio).toHaveLength(1);
    });

    it("hangs off the scene root without entering layout or render", () => {
        const canvas = new Canvas2D({});
        canvas.add(new Rect({ width: 10, height: 10 }));
        canvas.add(new SoundNode({ src: SRC }));

        // `Node2D.children` filters, so the layout and render walks never see it.
        expect(canvas.children).toHaveLength(1);
        expect(canvas.childrenAudio).toHaveLength(1);
        expect(canvas._allChildren).toHaveLength(2);
    });
});

describe("declaring a clip", () => {
    it("emits one request, started where its row starts", () => {
        const [req] = requestsOf([{ ...sound("s"), startAt: 1 }]);
        expect(req.src).toBe(SRC);
        expect(req.startAt).toBe(1);
    });

    it("names its buses source-adjacent first", () => {
        const [req] = requestsOf([bus("mix"), bus("dialogue", {}, "mix"), sound("s", {}, "dialogue")]);
        expect(req.bus?.map((s) => s.id)).toEqual(["bus:dialogue", "bus:mix"]);
    });

    /**
     * The container model: two bus nodes are two buses, whatever they are called.
     * The merge a shared `key` used to perform is gone — `key` is now the unique
     * handle an expression names a node by, and one handle cannot mean two nodes.
     */
    it("keeps two buses apart even when they share a key", () => {
        const rows = ["a", "b"].flatMap((id) => [bus(id, { key: "music" }), sound(`s${id}`, {}, id)]);
        expect(requestsOf(rows).map((r) => r.bus?.[0].id)).toEqual(["bus:a", "bus:b"]);
    });

    it("carries each bus's own level, so a group gain is one edit", () => {
        const reqs = requestsOf([bus("mix", { volume: 0.5 }), sound("a", {}, "mix"), sound("b", { trimStart: 1 }, "mix")]);
        expect(reqs).toHaveLength(2);
        // One bus, one id: the platform builds a single chain both clips feed.
        const ids = reqs.map((r) => r.bus?.[0].id);
        expect(ids[0]).toBe(ids[1]);
        expect(reqs[0].bus?.[0].volume).toBe(0.5);
    });

    /**
     * A bus id reaches `AssetManager.stableKey`, so one that changed on a rebuild
     * would re-fetch and re-schedule every clip on the bus.
     */
    it("keeps a bus id across a rebuild", () => {
        const build = () => requestsOf([bus("sfx"), sound("s", {}, "sfx")])[0].bus?.[0].id;
        expect(build()).toBe(build());
        expect(build()).toBe("bus:sfx");
    });

    it("carries a ramped level as the request's volume", () => {
        const [req] = requestsOf([sound("s", { volume: ramp(1, 0, 1) })]);
        expect(isRamp(req.volume)).toBe(true);
        expect(req.effects).toBeUndefined();
    });

    it("keeps a clip's own effects apart from its level", () => {
        const [req] = requestsOf([sound("s", { effects: AudioEffects.lowpass(800), volume: 0.5 })]);
        expect(req.effects?.map((f) => f.type)).toEqual(["lowpass"]);
        expect(req.volume).toBe(0.5);
    });

    it("reads a row's ramps, speed and transitions as parsed JSON", () => {
        const props = JSON.parse(JSON.stringify({
            volume: { keys: [{ at: 0, value: 1 }, { before: 0, value: 0.2 }] },
            speed: 2,
            effects: [{ type: "lowpass", frequency: { keys: [{ at: 0, value: 8000 }, { before: 0, value: 400 }] } }],
            transitionIn: { duration: 0.5 },
            transitionOut: { duration: 1, curve: { kind: "out", args: "quad" } },
        }));
        const [req] = requestsOf([sound("s", props)]);
        expect(isRamp(req.volume)).toBe(true);
        expect(req.speed).toBe(2);
        expect(isRamp((req.effects?.[0] as { frequency: unknown }).frequency)).toBe(true);
        expect(req.transitionIn).toEqual({ duration: 0.5 });
        expect(req.transitionOut).toEqual({ duration: 1, curve: { kind: "out", args: "quad" } });
    });

    it("carries a bus's transitions on its stop", () => {
        const [req] = requestsOf([bus("sfx", { transitionOut: { duration: 2 } }), sound("s", {}, "sfx")]);
        expect(req.bus?.[0].transitionOut).toEqual({ duration: 2 });
    });

    it("plays only while its row is present", () => {
        const [req] = requestsOf([{ ...sound("s"), startAt: 2, endAt: 3 }]);
        expect([req.startAt, req.endAt]).toEqual([2, 3]);
    });
});

/**
 * A `Video` cannot be parented under a bus — its audio is welded to a picture that
 * has to stay in the 2D tree — so it names one. By node id, the same id a
 * `SoundNode` under that bus writes as its `parentId`.
 */
describe("routing a video into a bus", () => {
    const rowsWith = (target: string | undefined, id: string): TimedNodeSpec[] => [
        bus(id, { volume: 0.4 }),
        sound("s", {}, id),
        node("v", "video", { width: 20, height: 20, src: CLIP, bus: target }),
    ];

    it("puts the video's sound on the bus its id names", () => {
        const reqs = requestsOf(rowsWith("dialogue", "dialogue"));
        const video = reqs.find((r) => r.src === CLIP)!;
        const sound = reqs.find((r) => r.src === SRC)!;
        // One chain, named the same way from either side.
        expect(video.bus?.[0].id).toBe("bus:dialogue");
        expect(video.bus?.[0].id).toBe(sound.bus?.[0].id);
        expect(video.bus?.[0].volume).toBe(0.4);
    });

    it("declares a video's own sound as optional, and a sound's as asked for", () => {
        const reqs = requestsOf(rowsWith("dialogue", "dialogue"));
        // A file with no audio track is a silent video; a sound that names one is a failure.
        expect(reqs.find((r) => r.src === CLIP)!.optional).toBe(true);
        expect(reqs.find((r) => r.src === SRC)!.optional).toBeUndefined();
    });

    it("goes straight to the master when the id matches no bus", () => {
        const video = requestsOf(rowsWith("nope", "dialogue")).find((r) => r.src === CLIP)!;
        expect(video.bus).toBeUndefined();
    });

    it("no longer resolves a bus by its key", () => {
        const video = requestsOf([
            bus("b1", { key: "dialogue" }),
            node("v", "video", { width: 20, height: 20, src: CLIP, bus: "dialogue" }),
        ]).find((r) => r.src === CLIP)!;
        expect(video.bus).toBeUndefined();
    });
});

describe("levels are ramps, not tweens", () => {
    it("refuses a tween on volume, naming what does work", () => {
        const bus = new AudioBus();
        new Canvas2D({}).add(bus);
        expect(() => bus._prepareStep({ volume: 0 }, 1))
            .toThrow(/"volume" cannot be tweened.*ramp\(1, 0, 1\)/s);
    });

    it("refuses one on pan too", () => {
        const bus = new AudioBus();
        new Canvas2D({}).add(bus);
        expect(() => bus._prepareStep({ pan: 1 }, 1)).toThrow(/"pan" cannot be tweened/);
    });

    it("refuses one on a sound's speed", () => {
        const s = new SoundNode({ src: SRC });
        new Canvas2D({}).add(s);
        expect(() => s._prepareStep({ speed: 2 } as never, 1)).toThrow(/"speed" cannot be tweened/);
    });

    it("leaves every other prop tweenable", () => {
        const bus = new AudioBus();
        new Canvas2D({}).add(bus);
        expect(() => bus._prepareStep({ solo: true } as never, 1)).not.toThrow();
    });
});
