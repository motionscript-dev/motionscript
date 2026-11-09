import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";
import type { AudioRequest } from "@/attributes/audio/request";
import { AudioBus, SoundNode } from "@/components/builtins/audio/audio";
import { ClipInstance } from "@/runtime/clip-instance";
import { precompFor, project, runtimeScope, track } from "@/runtime/document.fixtures";

import { AUDIO_ROOT_ID, loweredAudioDocument } from "../audio";
import { Registry } from "../registry";
import { documentDuration, type AudioDocument, type CommandSpec, type TimedNodeSpec } from "../types";
import { validateDocument } from "../validate";

const SRC = "vo.mp3";
const VIEWPORT = { width: 100, height: 100 };
const FPS = 30;

// The vocabulary this file's documents compile against. An engine builds
// one of these; a test builds its own, and nothing is shared between files.
const registry = new Registry();

function catalog(): ManifestAssetCatalog {
    const manifest: AssetManifest = {
        image: {}, video: {}, font: {},
        audio: { [SRC]: { duration: 10, sizeBytes: 0, src: SRC } },
    };
    return new ManifestAssetCatalog(manifest);
}

const row = (id: string, type: string, parentId: string | null, props: Record<string, unknown> = {}, startAt?: number): TimedNodeSpec =>
    ({ id, type, parentId, layerOrder: 0, props, ...(startAt !== undefined && { startAt }) });

const audio = (nodes: TimedNodeSpec[], commands: CommandSpec[] = []): AudioDocument =>
    ({ kind: "audio", nodes, commands });

/** The live clip an audio document lowers to, at its first frame. */
function clipOf(doc: AudioDocument) {
    const assets = catalog();
    const clip = new ClipInstance(doc, 4, runtimeScope({ registry, viewport: VIEWPORT, fps: FPS, assets }));
    clip.build();
    clip.attach(0);
    clip.evaluateAt(0);
    return { clip, assets };
}

/** What the clip schedules, as the runtime has it: a sound plays from its `play`. */
function requestsOf(doc: AudioDocument): AudioRequest[] {
    return precompFor(project([track("a", doc, { duration: 4 })]), { registry, viewport: VIEWPORT, fps: FPS, assets: catalog() }).run().tracks[0].audioRequests;
}

describe("lowering", () => {
    it("gives the clip a canvas root that draws nothing", () => {
        const lowered = loweredAudioDocument(audio([]));
        expect(lowered.kind).toBe("composition");
        expect(lowered.nodes[0]).toMatchObject({ id: "", type: "canvas2d", parentId: null });
    });

    it("synthesizes a root bus when the document leaves it out", () => {
        const lowered = loweredAudioDocument(audio([row("s", "sound", null, { src: SRC })]));
        const buses = lowered.nodes.filter((n) => n.type === "audioBus");
        expect(buses).toHaveLength(1);
        expect(buses[0].id).toBe(AUDIO_ROOT_ID);
    });

    it("rewrites the authored root bus rather than adding a second one", () => {
        const lowered = loweredAudioDocument(audio([
            row("", "audioBus", null, { volume: 0.5 }),
            row("s", "sound", null, { src: SRC }),
        ]));
        const { nodes } = lowered;
        expect(nodes.filter((n) => n.type === "audioBus")).toHaveLength(1);
        const bus = nodes.find((n) => n.type === "audioBus")!;
        expect(bus.id).toBe(AUDIO_ROOT_ID);
        expect(bus.props).toEqual({ volume: 0.5 });
        // And the clip hangs off it, not off the canvas.
        expect(nodes.find((n) => n.type === "sound")!.parentId).toBe(AUDIO_ROOT_ID);
    });

    it("keeps a sound's span through the lowering", () => {
        const lowered = loweredAudioDocument(audio([{ ...row("s", "sound", null, { src: SRC }, 1), endAt: 3 }]));
        expect(lowered.nodes.find((n) => n.id === "s")).toMatchObject({ startAt: 1, endAt: 3 });
    });

    it("points a `targetId: null` command at the root bus", () => {
        const lowered = loweredAudioDocument(audio(
            [row("", "audioBus", null)],
            [{ id: "duck", type: "set", targetId: null, at: 1, args: { mute: true } }],
        ));
        expect(lowered.commands.find((c) => c.id === "duck")!.targetId).toBe(AUDIO_ROOT_ID);
    });

    it("carries duration and variables through", () => {
        const variables = [{ id: "level", value: 0.5 }];
        const lowered = loweredAudioDocument({ ...audio([]), duration: 7, variables });
        expect(lowered.duration).toBe(7);
        expect(lowered.variables).toEqual(variables);
    });

    it("takes its length from the last thing that happens, like a composition", () => {
        const doc = audio(
            [row("s", "sound", null, { src: SRC })],
            [{ id: "f", type: "set", targetId: "s", at: 3, args: { mute: true } }],
        );
        expect(documentDuration(doc)).toBe(3);
        expect(documentDuration(loweredAudioDocument(doc))).toBe(3);
        expect(documentDuration(audio([{ ...row("s", "sound", null, { src: SRC }), endAt: 5 }]))).toBe(5);
    });
});

describe("building", () => {
    it("puts the bus tree under the scene root", () => {
        const { clip } = clipOf(audio([row("", "audioBus", null), row("s", "sound", null, { src: SRC })]));

        const [bus] = clip.canvas.childrenAudio;
        expect(bus).toBeInstanceOf(AudioBus);
        expect(bus.childrenAudio[0]).toBeInstanceOf(SoundNode);
        // Nothing visual: the canvas has no 2D children at all.
        expect(clip.canvas.children).toHaveLength(0);
    });

    it("schedules the clip, through its bus", () => {
        const [req] = requestsOf(audio([
            row("", "audioBus", null, { volume: 0.25 }),
            row("s", "sound", null, { src: SRC }),
        ]));
        expect(req.src).toBe(SRC);
        expect(req.bus?.[0].volume).toBe(0.25);
    });

    /**
     * The container model end to end: a bus's chain is identified by its own row's
     * id, so nesting one inside another is two chains rather than a merge — and
     * the identity survives a rebuild, which a UUID could not.
     */
    it("keys each bus's chain by its row id", () => {
        const [req] = requestsOf(audio([
            row("", "audioBus", null),
            row("sfx", "audioBus", ""),
            row("s", "sound", "sfx", { src: SRC }),
        ]));
        expect(req.bus?.map((s) => s.id)).toEqual(["bus:sfx", `bus:${AUDIO_ROOT_ID}`]);
    });

    it("starts a clip entering later at the second it enters", () => {
        const doc = audio([row("s", "sound", null, { src: SRC }, 2)]);
        const reqs = precompFor(
            project([track("a", doc, { duration: 4 })], { fps: FPS, viewport: VIEWPORT }),
            { registry, assets: catalog() },
        ).run().tracks[0].audioRequests;
        expect(reqs).toHaveLength(1);
        expect(reqs[0].startAt).toBeCloseTo(2, 3);
    });
});

describe("validation", () => {
    const issues = (doc: unknown) => validateDocument(doc).issues.map((i) => `${i.path}: ${i.message}`);

    it("accepts a well-formed audio document", () => {
        expect(validateDocument(audio([row("s", "sound", null, { src: SRC })])))
            .toEqual({ valid: true, issues: [] });
    });

    it("requires the root row to be an audioBus", () => {
        expect(issues(audio([row("", "canvas2d", null)]))[0])
            .toMatch(/must be `\{ type: "audioBus", parentId: null \}`/);
    });

    it("still names canvas2d for a scene", () => {
        expect(issues({ kind: "composition", nodes: [row("", "audioBus", null)], commands: [] })[0])
            .toMatch(/must be `\{ type: "canvas2d", parentId: null \}`/);
    });

    it("names audio among the kinds", () => {
        expect(issues({ kind: "nope", commands: [] })[0]).toMatch(/"still", "composition" or "audio"/);
    });

    it("applies the composition rules — a command cannot precede its target", () => {
        expect(issues(audio(
            [row("s", "sound", null, { src: SRC }, 2)],
            [{ id: "m", type: "set", targetId: "s", at: 0, args: { mute: true } }],
        ))[0]).toMatch(/is not present until 2s/);
    });
});
