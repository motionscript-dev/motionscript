import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";
import { AudioEffects, resolveAudioEffects } from "@/attributes/audio/effects/chain";
import type { AudioRequest } from "@/attributes/audio/request";
import type { ProjectDocument } from "@/document/project";
import type { AudioDocument, TimedNodeSpec } from "@/document/types";
import { comp, node, openController, precompFor, project, track } from "@/runtime/document.fixtures";

const VO = "vo.mp3";
const BED = "bed.mp3";
const CLIP = "clip.mp4";

const catalog = () => new ManifestAssetCatalog({
    image: {}, font: {},
    audio: {
        [VO]: { src: VO, duration: 6, sizeBytes: 0 },
        [BED]: { src: BED, duration: 20, sizeBytes: 0 },
    },
    video: { [CLIP]: { src: CLIP, width: 80, height: 60, duration: 5, sizeBytes: 0 } },
} satisfies AssetManifest);

// ─── Harness ──────────────────────────────────────────────────────────────────

type Requests = AudioRequest[][];

const audioOf = (doc: ProjectDocument): Requests =>
    precompFor(doc, { assets: catalog() }).run().tracks.map((t) => t.audioRequests);

/** What a request plays — everything but how it is identified and attributed. */
function played(tracks: Requests) {
    return tracks.map((requests) => requests
        .map((r) => ({
            src: r.src,
            startAt: r.startAt,
            endAt: r.endAt,
            trimStart: r.trimStart,
            volume: r.volume,
            speed: r.speed ?? 1,
            loop: r.loop,
            open: r.open === true,
            mediaDuration: r.open ? r.mediaDuration : undefined,
            effects: r.effects ?? [],
            bus: r.bus ?? [],
        }))
        .sort((a, b) => a.startAt - b.startAt || a.src.localeCompare(b.src) || a.trimStart - b.trimStart));
}

type Played = ReturnType<typeof played>[number][number];

/** A request as `played` spells it, defaults filled in. */
const plays = (over: Partial<Played> & Pick<Played, "src" | "startAt" | "endAt">): Played => ({
    trimStart: 0, volume: 1, speed: 1, loop: false, open: false, mediaDuration: undefined, effects: [], bus: [], ...over,
});

/** What the sampled `prepareRender` hooks played, pinned when they were retired. */
function expectPlays(doc: ProjectDocument, expected: Played[][]): Requests {
    const declared = audioOf(doc);
    expect(played(declared)).toEqual(expected);
    return declared;
}

const sound = (id: string, props: Record<string, unknown>, parentId: string | null = null, layerOrder = 0): TimedNodeSpec =>
    node(id, "sound", props, parentId, layerOrder);
const video = (id: string, props: Record<string, unknown>, layerOrder = 0): TimedNodeSpec =>
    node(id, "video", { width: 80, height: 60, src: CLIP, ...props }, null, layerOrder);

// ─── Equivalence ──────────────────────────────────────────────────────────────

describe("declared audio plays what sampled audio played", () => {
    it("a sound at the scene root, left open", () => {
        const [[req]] = expectPlays(project([track("a", comp([sound("s", { src: VO })], [], 4))]), [[
            plays({ src: VO, startAt: 0, endAt: 4, open: true, mediaDuration: 6 }),
        ]]);
        expect(req).toMatchObject({ startAt: 0, endAt: 4, open: true, mediaDuration: 6 });
    });

    it("sounds under nested buses with ids", () => {
        const doc: AudioDocument = {
            kind: "audio",
            duration: 4,
            nodes: [
                { id: "", type: "audioBus", parentId: null, layerOrder: 0, props: { volume: 0.5 } },
                { id: "sfx", type: "audioBus", parentId: "", layerOrder: 0, props: { effects: resolveAudioEffects(AudioEffects.lowpass(800)) } },
                sound("hit", { src: VO, trimEnd: 2, volume: 0.25 }, "sfx"),
                sound("vo", { src: VO, trimStart: 1 }, "", 1),
            ],
            commands: [],
        };
        const master = { id: "bus:@bus", volume: 0.5, pan: 0, mute: false, startAt: 0, endAt: 4 };
        const [requests] = expectPlays(project([track("a", doc)]), [[
            plays({
                src: VO, startAt: 0, endAt: 2, volume: 0.25,
                bus: [{ id: "bus:sfx", volume: 1, pan: 0, mute: false, effects: [{ type: "lowpass", frequency: 800 }], startAt: 0, endAt: 4 }, master],
            }),
            plays({ src: VO, startAt: 0, endAt: 4, trimStart: 1, open: true, mediaDuration: 5, bus: [master] }),
        ]]);
        expect(requests.find((r) => r.ownerId === "hit")!.bus!.map((s) => s.id)).toEqual(["bus:sfx", "bus:@bus"]);
    });

    it("a video playing, entering late, sped up and routed to a bus", () => {
        expectPlays(project([track("a", comp([
            node("dialogue", "audioBus", { volume: 0.4 }),
            { ...video("v", { speed: 2, volume: 0.5, bus: "dialogue" }, 1), startAt: 0.5 },
        ], [], 4))]), [[
            plays({
                src: CLIP, startAt: 0.5, endAt: 3, volume: 0.5, speed: 2,
                bus: [{ id: "bus:dialogue", volume: 0.4, pan: 0, mute: false, startAt: 0, endAt: 4 }],
            }),
        ]]);
    });

    it("a video muted, one paused, and one looping", () => {
        const [requests] = expectPlays(project([track("a", comp([
            video("muted", { muted: true }),
            video("paused", { playing: false }, 1),
            video("looping", { loop: "forward" }, 2),
        ], [], 4))]), [[
            plays({ src: CLIP, startAt: 0, endAt: 4, loop: true, open: true }),
        ]]);
        expect(requests.map((r) => r.ownerId)).toEqual(["looping"]);
    });

    it("a video on a two-segment schedule with its own speed and volume", () => {
        const [requests] = expectPlays(project([track("a", comp([video("v", {
            volume: 0.8,
            audioEffects: resolveAudioEffects(AudioEffects.highpass(200)),
            segments: [
                { at: 0, from: 0, duration: 1, speed: 2 },
                { at: 2.5, from: 2, duration: Infinity, volume: 0.3 },
            ],
        })], [], 6))]), [[
            plays({
                src: CLIP, startAt: 0, endAt: 1, volume: 0.8, speed: 2,
                effects: [{ type: "highpass", frequency: 200 }],
            }),
            plays({ src: CLIP, startAt: 2.5, endAt: 5.5, trimStart: 2, volume: 0.3, effects: [{ type: "highpass", frequency: 200 }] }),
        ]]);
        expect(requests.map((r) => [r.startAt, r.trimStart])).toEqual([[0, 0], [2.5, 2]]);
    });

    it("an open bed continuing into the next track", () => {
        const [[bed]] = expectPlays(project([
            track("a", comp([sound("bed", { src: BED })], [], 2)),
            track("b", comp([node("box", "rect", { width: 10, height: 10 })], [], 3), { startAt: 2 }),
        ]), [[plays({ src: BED, startAt: 0, endAt: 5, open: true, mediaDuration: 20 })], []]);
        expect(bed).toMatchObject({ open: true, endAt: 5 });
    });

    it("a sped-up, trimmed sound ending early", () => {
        const [[req]] = expectPlays(project([track("a", comp([
            sound("s", { src: VO, trimStart: 1, trimEnd: 5, speed: 2 }),
        ], [], 4))]), [[
            plays({ src: VO, startAt: 0, endAt: 2, trimStart: 1, speed: 2 }),
        ]]);
        expect(req.endAt).toBeCloseTo(2, 9);
    });
});

// ─── Intended differences ─────────────────────────────────────────────────────

describe("where declared audio deliberately differs", () => {
    it("starts a sound entering late at the second it enters, not at zero", () => {
        const doc = project([track("a", comp([{ ...sound("s", { src: VO }), startAt: 1.5 }], [], 4))]);
        expect(audioOf(doc)[0][0].startAt).toBe(1.5);
    });

    it("cuts a sound where its row ends", () => {
        const doc = project([track("a", comp([{ ...sound("s", { src: VO }), endAt: 2 }], [], 4))]);
        const [[req]] = audioOf(doc);
        expect(req.endAt).toBe(2);
        expect(req.open).toBeUndefined();
    });

    it("cuts a video's sound with its picture", () => {
        const doc = project([track("a", comp([{ ...video("v", {}), endAt: 1 }], [], 4))]);
        expect(audioOf(doc)[0][0].endAt).toBe(1);
    });

    /**
     * What a curve on a bus runs over: the bus's own presence, as a sound's runs
     * over the sound's. A bus nothing removes is present until its clip ends.
     */
    it("stamps each bus stop with the bus's span, not the clip's", () => {
        const doc = project([track("a", comp([
            node("mix", "audioBus", { volume: 0.5 }),
            { ...node("dialogue", "audioBus", {}, "mix"), startAt: 1, endAt: 3 },
            { ...sound("vo", { src: VO, trimEnd: 1 }, "dialogue"), startAt: 1.5 },
        ], [], 4))]);
        const [[req]] = audioOf(doc);
        expect(req.startAt).toBe(1.5);
        expect(req.bus!.map((s) => [s.id, s.startAt, s.endAt])).toEqual([
            ["bus:dialogue", 1, 3],
            ["bus:mix", 0, 4],
        ]);
    });

    it("stamps a video's named bus with that bus's span", () => {
        const doc = project([track("a", comp([
            { ...node("dialogue", "audioBus", {}), startAt: 0.25 },
            { ...video("v", { bus: "dialogue" }, 1), startAt: 1 },
        ], [], 4))]);
        const [[req]] = audioOf(doc);
        expect(req.bus!.map((s) => [s.startAt, s.endAt])).toEqual([[0.25, 4]]);
    });
});

// ─── Identity and attribution ─────────────────────────────────────────────────

describe("declared request ids", () => {
    it("are the same across a rebuild", () => {
        const doc = project([track("a", comp([
            sound("s", { src: VO }),
            { ...sound("t", { src: VO, trimEnd: 1 }, null, 1), startAt: 1 },
        ], [], 3))]);
        const ids = () => audioOf(doc)[0].map((r) => r.id);
        expect(ids()).toEqual(["s|vo.mp3|0|0", "t|vo.mp3|1|0"]);
        expect(ids()).toEqual(ids());
    });

    it("do not depend on where the node sits among its siblings", () => {
        const withSibling = project([track("a", comp([
            node("box", "rect", { width: 10, height: 10 }),
            { ...sound("s", { src: VO }, null, 1), startAt: 1 },
        ], [], 3))]);
        const alone = project([track("a", comp([{ ...sound("s", { src: VO }), startAt: 1 }], [], 3))]);
        expect(audioOf(withSibling)[0].map((r) => r.id))
            .toEqual(audioOf(alone)[0].map((r) => r.id));
    });
});

describe("waveforms", () => {
    it("land on the row that declared them, wherever it sits in the tree now", async () => {
        const { controller } = openController(project([track("a", comp([
            { ...node("box", "rect", { width: 10, height: 10 }), endAt: 0.5 },
            sound("s", { src: VO, trimEnd: 2 }, null, 1),
            video("v", {}, 2),
        ], [], 3))]), { assets: catalog() });
        await controller.seek(0);
        const before = controller.getTreeState()!;
        expect(before.children.map((c) => [c.id, c.waveform?.length ?? 0])).toEqual([["box", 0], ["s", 1], ["v", 1]]);

        // `box` has left, so `s` and `v` have each moved up an index.
        await controller.seek(10);
        const after = controller.getTreeState()!;
        expect(after.children.map((c) => [c.id, c.waveform?.map((w) => w.src)])).toEqual([["s", [VO]], ["v", [CLIP]]]);
        controller.dispose();
    });
});
