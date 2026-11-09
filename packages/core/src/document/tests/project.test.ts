import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { Rect } from "@/components/builtins/geometry/geometry";
import type { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { component2d } from "@/components/factory/component2d";
import { evaluatorFor, precompFor } from "@/runtime/document.fixtures";
import { FakeRenderContext } from "@/runtime/runtime.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import { Registry } from "../registry";
import { asProjectDocument, isProjectDocument, type ProjectDocument, type Track } from "../project";
import type { AudioDocument, ClipDocument, CompositionDocument, StillDocument } from "../types";
import { documentDuration } from "../types";
import { assertValidProjectDocument, validateProjectDocument } from "../validate";

const FPS = 30;
const VIEWPORT = { width: 200, height: 200 };
const MANIFEST = {
    image: {}, video: {}, font: {},
    audio: { "music.mp3": { src: "music.mp3", duration: 30, sizeBytes: 1 } },
};
const catalog = () => new ManifestAssetCatalog(MANIFEST);

// The vocabulary this file's documents compile against. An engine builds
// one of these; a test builds its own, and nothing is shared between files.
const registry = new Registry();

/** A still holding one rect at `x`. */
function still(x: number): StillDocument {
    return {
        kind: "still",
        nodes: [{ id: "box", type: "rect", parentId: null, layerOrder: 0, props: { width: 10, height: 10, x } }],
    };
}

/** A composition sliding one node of `type` 0 → 100 over `seconds`. */
function slide(seconds: number, type = "rect"): CompositionDocument {
    return {
        kind: "composition",
        nodes: [{ id: "box", type, parentId: null, layerOrder: 0, props: { width: 10, height: 10, x: 0 } }],
        commands: [
            { id: "t", type: "to", targetId: "box", at: 0, duration: seconds, args: { x: 100 } },
        ],
    };
}

/** An audio clip: one sound under the implicit root bus. */
function bed(): AudioDocument {
    return {
        kind: "audio",
        nodes: [{ id: "music", type: "sound", parentId: null, layerOrder: 0, props: { src: "music.mp3" } }],
        commands: [],
    };
}

function track(id: string, clip: ClipDocument, rest: Partial<Track> = {}): Track {
    return { id, clip, duration: 1, ...rest };
}

function project(tracks: Track[]): ProjectDocument {
    return { kind: "project", name: "Test", fps: FPS, viewport: VIEWPORT, tracks };
}

/** AssetTimeline a project, then an evaluator over it. */
function runtimeFor(doc: ProjectDocument, vocabulary = registry) {
    const precomp = precompFor(doc, { registry: vocabulary, assets: catalog() }).run();
    expect(precomp.buildErrors).toEqual([]);
    const evaluator = evaluatorFor(doc, { registry: vocabulary, assets: catalog() });
    return { precomp, evaluator };
}

/** The single rect in the topmost track's tree. */
function box(evaluator: StateEvaluator): Rect {
    return evaluator.currentCanvas!.children.find((c): c is Rect => c instanceof Rect)!;
}

describe("placement", () => {
    it("places each track at its own second, and array position is paint order", () => {
        const { precomp, evaluator } = runtimeFor(project([
            track("bg", still(0), { duration: 5 }),
            track("mid", slide(1), { startAt: 2 }),
            track("top", still(5), { startAt: 4 }),
        ]));

        expect(precomp.tracks.map((t) => [t.id, t.startFrame])).toEqual([
            ["bg", 0],
            ["mid", 2 * FPS],
            ["top", 4 * FPS],
        ]);

        evaluator.stateAt(Math.round(2.5 * FPS));
        expect(evaluator.activeTrackIds).toEqual(["bg", "mid"]);
        evaluator.stateAt(Math.round(4.5 * FPS));
        expect(evaluator.activeTrackIds).toEqual(["bg", "top"]);
    });

    it("takes the project's length from the furthest track, not the sum", () => {
        // Two 1s clips overlapping by half: 1.5s total, where a sequence would be 2s.
        const { precomp } = runtimeFor(project([
            track("a", slide(1)),
            track("b", slide(1), { startAt: 0.5 }),
        ]));
        expect(precomp.totalFrames).toBe(Math.round(1.5 * FPS));
    });
});

describe("overlap", () => {
    it("evaluates two clips over the same second, each at its own local time", () => {
        // Only the topmost tree is exposed, so the rects report what they draw.
        const drawn: number[] = [];
        const Tracer = component2d({ key: "tracer", render: (_ctx, state) => { drawn.push(state.x); } });
        const { evaluator } = runtimeFor(project([
            track("a", slide(2, "tracer"), { duration: 2 }),
            track("b", slide(2, "tracer"), { startAt: 1, duration: 2 }),
        ]), new Registry({ nodes: { tracer: Tracer.node as never } }));

        evaluator.stateAt(Math.round(1.5 * FPS));
        evaluator.render(new FakeRenderContext());
        // `a` is 1.5s into its own 2s slide; `b` is only 0.5s into its.
        // A component's render also runs when the node probes its own outline, so each tree reports more than once.
        expect([...new Set(drawn.map((x) => Math.round(x * 1000) / 1000))]).toEqual([75, 25]);
    });
});

describe("duration", () => {
    it("holds a still for the length the track declares", () => {
        const { precomp } = runtimeFor(project([track("bg", still(0), { duration: 3 })]));
        expect(precomp.totalFrames).toBe(3 * FPS);
    });

    it("cuts a composition short, and holds one that outlives its document", () => {
        const short = runtimeFor(project([track("a", slide(2), { duration: 1 })]));
        expect(short.precomp.totalFrames).toBe(1 * FPS);

        const long = runtimeFor(project([track("a", slide(1), { duration: 2 })]));
        expect(long.precomp.totalFrames).toBe(2 * FPS);
        // Past its own end the clip holds its last frame, not its authored one.
        long.evaluator.stateAt(Math.round(1.5 * FPS));
        expect(box(long.evaluator).x).toBeCloseTo(100, 3);
    });

    it("never takes a clip's length from its media", () => {
        // The whole point of requiring it: `music.mp3` is 30s, and a bed placed
        // on a 2s edit must not stretch the render to half a minute.
        const { precomp } = runtimeFor(project([
            track("v", slide(2), { duration: 2 }),
            track("a", bed(), { duration: 2 }),
        ]));
        expect(precomp.totalFrames).toBe(2 * FPS);
    });

    it("is a pure function of time, forwards and backwards", () => {
        // The property the whole model rests on: a frame depends on its second
        // and on nothing about how the playhead reached it. Asserted on a
        // placed clip because placement is the arithmetic most likely to
        // accumulate — a running offset would fail this and a declared start
        // cannot.
        const { evaluator } = runtimeFor(project([
            track("a", slide(2), { startAt: 0.5, duration: 2 }),
        ]));
        const at = (f: number) => { evaluator.stateAt(f); return box(evaluator).x; };

        const forward = at(40);
        at(80);
        expect(at(40)).toBe(forward);
    });
});

describe("passes", () => {
    it("measures on a tree of its own, so a pass never disposes the one on screen", () => {
        const doc = project([track("a", slide(1))]);
        const { evaluator } = runtimeFor(doc);
        evaluator.stateAt(Math.round(0.5 * FPS));
        const shown = box(evaluator);

        precompFor(doc, { registry, assets: catalog() }).run();
        evaluator.invalidate();
        evaluator.stateAt(Math.round(0.5 * FPS));
        expect(box(evaluator)).toBe(shown);
        expect(shown.x).toBeCloseTo(50, 3);
    });
});

describe("compositing", () => {
    const rootOf = (evaluator: StateEvaluator): Canvas2D => evaluator.currentCanvas!;

    /** A still whose scene root carries `props`. */
    const withRoot = (props: Record<string, unknown>): StillDocument => ({
        ...still(0),
        nodes: [{ id: "", type: "canvas2d", parentId: null, layerOrder: 0, props }, ...still(0).nodes],
    });

    it("takes a clip's composite from its own root — there is no track-level opacity", () => {
        const bg = track("bg", still(0));
        const wm = track("wm", withRoot({ opacity: 0.35, blend: "screen" }));
        const { evaluator } = runtimeFor(project([bg, wm]));
        evaluator.stateAt(0);

        expect(rootOf(evaluator).opacity).toBe(0.35);
        expect(rootOf(evaluator).blend).toBe("screen");

        // Only the topmost tree is exposed, so bring `bg` up to read its root.
        evaluator.setProject(project([wm, bg]));
        evaluator.stateAt(0);
        expect(evaluator.currentTrackId).toBe("bg");
        expect(rootOf(evaluator).opacity).toBe(1);
    });

    it("keeps that opacity across frames — it is a baseline, not a multiply", () => {
        const doc = slide(1);
        const { evaluator } = runtimeFor(project([
            track("a", {
                ...doc,
                nodes: [
                    { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: { opacity: 0.5 } },
                    ...doc.nodes,
                ],
            }),
        ]));

        for (const frame of [0, 10, 20]) {
            evaluator.stateAt(frame);
            expect(rootOf(evaluator).opacity).toBe(0.5);
        }
    });

    it("lets a command animate the root opacity over its authored value", () => {
        const doc = slide(1);
        const { evaluator } = runtimeFor(project([
            track("a", {
                ...doc,
                nodes: [
                    { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: { opacity: 0.8 } },
                    ...doc.nodes,
                ],
                commands: [
                    ...doc.commands,
                    { id: "fade", type: "to", targetId: null, at: 0, duration: 1, args: { opacity: 0 } },
                ],
            }),
        ]));

        evaluator.stateAt(0);
        expect(rootOf(evaluator).opacity).toBeCloseTo(0.8, 3);
        evaluator.stateAt(Math.round(0.5 * FPS));
        expect(rootOf(evaluator).opacity).toBeCloseTo(0.4, 3);
    });
});

describe("audio tracks", () => {
    it("places sound on the same list as picture", () => {
        const { precomp } = runtimeFor(project([
            track("v", slide(1)),
            track("a", bed(), { startAt: 0.5 }),
        ]));

        expect(precomp.tracks.map((t) => [t.id, t.startFrame])).toEqual([["v", 0], ["a", Math.round(0.5 * FPS)]]);
        expect(precomp.tracks[1].audioRequests.map((r) => r.src)).toEqual(["music.mp3"]);
    });

    it("renders an audio-only project", () => {
        const { precomp } = runtimeFor(project([track("a", bed(), { duration: 4 })]));
        expect(precomp.totalFrames).toBe(4 * FPS);
        expect(precomp.tracks[0].audioRequests).toHaveLength(1);
    });
});

describe("validation", () => {
    const issues = (doc: unknown) => validateProjectDocument(doc).issues.map((i) => `${i.path}: ${i.message}`);

    it("accepts a well-formed project", () => {
        expect(validateProjectDocument(project([track("a", still(0))]))).toEqual({ valid: true, issues: [] });
    });

    it("accepts a project of nothing but audio", () => {
        expect(validateProjectDocument(project([track("a", bed())]))).toEqual({ valid: true, issues: [] });
    });

    it("accepts a project with no tracks yet", () => {
        expect(validateProjectDocument(project([]))).toEqual({ valid: true, issues: [] });
    });

    it("reports duplicate track ids", () => {
        expect(issues(project([track("a", still(0)), track("a", still(1))]))[0])
            .toMatch(/duplicate track id "a"/);
    });

    it("requires a duration on every track", () => {
        const doc = project([track("a", still(0))]);
        delete (doc.tracks[0] as Partial<Track>).duration;
        expect(issues(doc)[0]).toMatch(/tracks\[0\]\.duration: duration is required/);
    });

    it("prefixes a nested clip's issues with the track that carries it", () => {
        const bad: StillDocument = {
            kind: "still",
            nodes: [{ id: "box", type: "rect", parentId: "nope", layerOrder: 0, props: {} }],
        };
        expect(issues(project([track("a", bad)]))[0])
            .toMatch(/tracks\[0\]\.clip\.nodes\[0\]\.parentId: parentId "nope" is not a node/);
    });

    it("reports a negative startAt", () => {
        expect(issues(project([track("a", still(0), { startAt: -1 })]))[0]).toMatch(/startAt must be/);
    });
});

describe("documentDuration", () => {
    it("reads a still as having no length", () => {
        expect(documentDuration(still(0))).toBe(0);
    });

    it("ends a composition at its last command", () => {
        expect(documentDuration(slide(1.5))).toBe(1.5);
    });

    it("prefers a declared duration", () => {
        expect(documentDuration({ ...slide(1), duration: 4 })).toBe(4);
        expect(documentDuration({ ...bed(), duration: 2 })).toBe(2);
    });
});

describe("asProjectDocument", () => {
    it("passes a project through untouched", () => {
        const doc = project([track("a", still(0))]);
        expect(asProjectDocument(doc)).toBe(doc);
    });

    it("wraps a lone document as the only track, lifting its theme", () => {
        const theme = { colors: { bg: "#000" } };
        const clip = { ...slide(2), theme };
        const wrapped = asProjectDocument(clip, { fps: FPS, viewport: VIEWPORT });

        expect(wrapped).toMatchObject({ kind: "project", fps: FPS, viewport: VIEWPORT, theme });
        expect(wrapped.tracks).toEqual([{ id: "clip", clip, duration: 2 }]);
        expect(validateProjectDocument(wrapped)).toEqual({ valid: true, issues: [] });
    });

    it("gives a still the zero duration a backdrop has", () => {
        expect(asProjectDocument(still(0)).tracks[0].duration).toBe(0);
    });
});

describe("validation of the project shell", () => {
    const shell = (over: Record<string, unknown> = {}): Record<string, unknown> =>
        ({ kind: "project", name: "Reel", tracks: [], ...over });
    const found = (doc: unknown) => validateProjectDocument(doc).issues;
    const at = (doc: unknown) => found(doc).map((i) => i.path);

    it("must be an object, of kind project", () => {
        for (const doc of [null, undefined, [], "project", 4]) {
            expect(found(doc)).toEqual([{ path: "", message: "document must be an object." }]);
        }
        expect(found(shell({ kind: "composition" }))).toEqual([
            { path: "kind", message: 'kind must be "project" (got "composition").' },
        ]);
        expect(at({ name: "Reel", tracks: [] })).toEqual(["kind"]);
    });

    it("wants a name that is a non-empty string", () => {
        expect(at(shell({ name: undefined }))).toEqual(["name"]);
        expect(at(shell({ name: "" }))).toEqual(["name"]);
        expect(at(shell({ name: 12 }))).toEqual(["name"]);
        expect(at(shell({ name: "x" }))).toEqual([]);
    });

    it("takes a positive fps, or none", () => {
        expect(at(shell())).toEqual([]);
        expect(at(shell({ fps: 24 }))).toEqual([]);
        expect(at(shell({ fps: 29.97 }))).toEqual([]);
        for (const fps of [0, -30, "30", null, Number.NaN]) expect(at(shell({ fps }))).toEqual(["fps"]);
        expect(found(shell({ fps: 0 }))[0].message).toBe("fps must be a positive number when present.");
    });

    it("wants tracks to be an array, and stops there", () => {
        for (const tracks of [undefined, {}, "a", 3]) {
            expect(found(shell({ tracks }))).toEqual([{ path: "tracks", message: "tracks must be an array." }]);
        }
        // The shell's other mistakes are still reported alongside.
        expect(at({ kind: "project", tracks: {} })).toEqual(["name", "tracks"]);
    });

    it("lets a project have no tracks at all", () => {
        expect(validateProjectDocument(shell())).toEqual({ valid: true, issues: [] });
    });

    it("reports a project's retired fields by name, saying where each went", () => {
        const retired = ["visualTracks", "audioTracks", "backgrounds", "overlays", "commands", "constants"];
        const issues = found(shell(Object.fromEntries(retired.map((field) => [field, []]))));
        expect(issues.map((i) => i.path)).toEqual(retired);
        expect(issues[0].message).toMatch(/merged into `tracks`/);
    });

    it("reports a project whose fps is Infinity", () => {
        expect(at(shell({ fps: Infinity }))).toEqual(["fps"]);
    });
});

describe("validation of a track", () => {
    const clip: StillDocument = { kind: "still", nodes: [] };
    const doc = (...tracks: unknown[]) => ({ kind: "project", name: "Reel", tracks });
    const found = (...tracks: unknown[]) => validateProjectDocument(doc(...tracks)).issues;
    const at = (...tracks: unknown[]) => found(...tracks).map((i) => i.path);
    const ok = { id: "a", duration: 1, clip };

    it("must be an object, and each one is reported at its own index", () => {
        expect(found(5, null, [])).toEqual([
            { path: "tracks[0]", message: "track must be an object." },
            { path: "tracks[1]", message: "track must be an object." },
            { path: "tracks[2]", message: "track must be an object." },
        ]);
        expect(at(ok, 7)).toEqual(["tracks[1]"]);
    });

    it("needs an id that is a non-empty string", () => {
        expect(at({ duration: 1, clip })).toEqual(["tracks[0].id"]);
        expect(at({ id: "", duration: 1, clip })).toEqual(["tracks[0].id"]);
        expect(at({ id: 4, duration: 1, clip })).toEqual(["tracks[0].id"]);
    });

    it("names the second of two tracks sharing an id", () => {
        expect(found(ok, { ...ok })).toEqual([{ path: "tracks[1].id", message: 'duplicate track id "a".' }]);
    });

    it("does not count a track with no usable id as a duplicate of the next", () => {
        expect(at({ duration: 1, clip }, { duration: 1, clip })).toEqual(["tracks[0].id", "tracks[1].id"]);
    });

    it("takes a name only as a string", () => {
        expect(at({ ...ok, name: "Intro" })).toEqual([]);
        expect(at({ ...ok, name: 5 })).toEqual(["tracks[0].name"]);
    });

    it("takes a start that is a time", () => {
        expect(at({ ...ok, startAt: 0 }, { ...ok, id: "b", startAt: 2.5 })).toEqual([]);
        for (const startAt of [-1, Infinity, "1", null]) expect(at({ ...ok, startAt })).toEqual(["tracks[0].startAt"]);
    });

    it("needs a duration that is a time, zero included", () => {
        expect(at({ ...ok, duration: 0 })).toEqual([]);
        for (const duration of [undefined, -1, Infinity, "2", Number.NaN]) {
            expect(at({ ...ok, duration })).toEqual(["tracks[0].duration"]);
        }
    });

    it("needs a clip, and reports its absence at the clip", () => {
        expect(found({ id: "a", duration: 1 })).toEqual([
            { path: "tracks[0].clip", message: "clip is required — a track places a clip document inline." },
        ]);
    });

    it("reports a clip that is not an object, or of an unknown kind, at the clip", () => {
        expect(found({ ...ok, clip: 5 })).toEqual([{ path: "tracks[0].clip", message: "document must be an object." }]);
        expect(at({ ...ok, clip: { kind: "movie" } })).toEqual(["tracks[0].clip.kind"]);
    });

    it("reports a track's own mistakes together with its clip's", () => {
        const bad = { id: "a", duration: -1, clip: { kind: "still", nodes: [{ id: 3 }] } };
        const paths = at(bad);
        expect(paths).toContain("tracks[0].duration");
        expect(paths).toContain("tracks[0].clip.nodes[0].id");
    });

    it("reports the same clip issues in every track that carries the clip", () => {
        const shared: StillDocument = { kind: "still", nodes: [{ id: "n", type: "rect", parentId: "ghost", layerOrder: 0, props: {} }] };
        const first = found({ ...ok, clip: shared }).map((i) => i.path);
        const second = found({ ...ok, id: "b", clip: shared }).map((i) => i.path);
        expect(first).toEqual(["tracks[0].clip.nodes[0].parentId"]);
        expect(second).toEqual(first);
    });
});

describe("isProjectDocument", () => {
    it("recognises the project kind and nothing else", () => {
        expect(isProjectDocument(project([]))).toBe(true);
        expect(isProjectDocument({ kind: "project" })).toBe(true);
        expect(isProjectDocument(still(0))).toBe(false);
        expect(isProjectDocument(slide(1))).toBe(false);
        expect(isProjectDocument(bed())).toBe(false);
    });

    it("is false for what is not even an object", () => {
        for (const value of [null, undefined, 0, "project", [], () => ({ kind: "project" })]) {
            expect(isProjectDocument(value)).toBe(false);
        }
    });

    it("looks at the kind alone, so it is a guess that validation then checks", () => {
        expect(isProjectDocument({ kind: "project", tracks: "nope" })).toBe(true);
        expect(validateProjectDocument({ kind: "project", tracks: "nope" }).valid).toBe(false);
    });
});

describe("assertValidProjectDocument", () => {
    it("returns quietly for a valid project", () => {
        expect(assertValidProjectDocument(project([track("a", still(0))]))).toBeUndefined();
    });

    it("throws listing every issue, one to a line, under the project heading", () => {
        let message = "";
        try {
            assertValidProjectDocument({ kind: "project", fps: 0, tracks: [{ clip: 5 }] });
        } catch (error) {
            message = (error as Error).message;
        }
        const lines = message.split("\n");
        expect(lines[0]).toBe("Invalid project document:");
        expect(lines).toContain("  name: name must be a non-empty string.");
        expect(lines).toContain("  fps: fps must be a positive number when present.");
        expect(lines).toContain("  tracks[0].id: id must be a non-empty string.");
        expect(lines).toContain("  tracks[0].clip: document must be an object.");
    });

    it("names the root when the path is empty", () => {
        expect(() => assertValidProjectDocument(null)).toThrow(/ {2}<root>: document must be an object\./);
    });
});
