import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetIndex } from "@/assets/asset-index";
import { ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";
import type { AssetRecord } from "@/assets/record";
import type { AssetScope } from "@/assets/scope";
import { declareMembers, property } from "@/attributes/properties/decorator";
import { Fills } from "@/attributes/shape/fill/chain";
import { Registry } from "@/document/registry";
import { documentDuration, type ClipDocument, type CompositionDocument, type NodeSpec, type TimedNodeSpec } from "@/document/types";
import { Node2D, type Node2DProps, type NodeConfig } from "@/components/trees/2d/node2d";
import { refineAssets, type RefineResult } from "@/runtime/asset-refine";
import { ClipInstance } from "@/runtime/clip-instance";
import { comp, node, precompFor, probeRegistry, project, runtimeScope, still, track } from "@/runtime/document.fixtures";
import { trackFrameCount } from "@/runtime/placement";
import { walkedAssetRecords } from "@/runtime/asset-walk.fixtures";
import { makeCommand } from "@/tween/command";

const FPS = 10;
const VIEWPORT = { width: 200, height: 200 };
const IMAGES = ["a.png", "b.png", "c.png", "d.png", "e.png", "pic.png", "mid.png", "img.png"];

const catalog = () => new ManifestAssetCatalog({
    image: Object.fromEntries(IMAGES.map((src) => [src, { src, width: 64, height: 48, sizeBytes: 0 }])),
    video: { "clip.mp4": { src: "clip.mp4", width: 320, height: 240, duration: 10, sizeBytes: 0 } },
    audio: {},
    font: {},
} satisfies AssetManifest);

// ─── Test nodes ───────────────────────────────────────────────────────────────

const declared = { slides: 0, picture: 0 };

interface SlidesProps extends Node2DProps { slides: string[]; index: number }

/** Shows one of `slides`, picked by a tweened index. */
class Slides extends Node2D<SlidesProps> {
    declare readonly slides: string[];
    declare readonly index: number;

    constructor(props?: NodeConfig<Slides, SlidesProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }

    override declareAssets(assets: AssetScope): void {
        super.declareAssets(assets);
        declared.slides++;
        assets.image(this.slides[Math.round(this.index)] ?? "");
    }
}

declareMembers(Slides, {
    slides: property({ default: [] }),
    index: property({ default: 0 }),
});

interface PictureProps extends Node2DProps { src: string }

class Picture extends Node2D<PictureProps> {
    declare readonly src: string;

    constructor(props?: NodeConfig<Picture, PictureProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }

    override declareAssets(assets: AssetScope): void {
        super.declareAssets(assets);
        declared.picture++;
        assets.image(this.src);
    }
}

declareMembers(Picture, {
    src: property({ default: "" }),
});

/** Holds a src it never paints, for a binding to read. */
class Holder extends Node2D<PictureProps> {
    declare readonly src: string;

    constructor(props?: NodeConfig<Holder, PictureProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }
}

declareMembers(Holder, {
    src: property({ default: "" }),
});

/** Builds a picture of its own in its constructor, the way a composite does. */
class Panel extends Node2D {
    constructor(props?: NodeConfig<Panel, Node2DProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
        this.add(new Picture({ src: "b.png" }));
    }
}

/**
 * Declarations that break the rule, one class each: the warning is once per class
 * name for the life of the module, so a class cannot be reused across tests.
 */
function misbehaving(kind: "write" | "clock") {
    return class extends Node2D {
        override declareAssets(assets: AssetScope): void {
            super.declareAssets(assets);
            if (kind === "write") this.set({ opacity: 0.5 });
            else void this.time.total;
            assets.image("a.png");
        }
    };
}
class WriteDeclarer extends misbehaving("write") { }
class ClockDeclarer extends misbehaving("clock") { }
class QuietWriteDeclarer extends misbehaving("write") { }
class QuietClockDeclarer extends misbehaving("clock") { }

class LayoutReader extends Node2D {
    override declareAssets(assets: AssetScope): void {
        super.declareAssets(assets);
        if (this.layoutBounds.width > 1000) assets.image("a.png");
    }
}

function registry(): Registry {
    const r = new Registry({
        nodes: {
            slides: Slides as never,
            picture: Picture as never,
            holder: Holder as never,
            layoutReader: LayoutReader as never,
            panel: Panel as never,
            writeDeclarer: WriteDeclarer as never,
            clockDeclarer: ClockDeclarer as never,
            quietWriteDeclarer: QuietWriteDeclarer as never,
            quietClockDeclarer: QuietClockDeclarer as never,
        },
    });
    // Swaps its target's fill through `srcs`, one per equal slice of its duration.
    r.addCommand("flipbook", (target, args, duration, easing) => {
        const srcs = args.srcs as string[];
        return makeCommand(
            target as never,
            (t) => ({ fill: Fills.image(srcs[Math.min(srcs.length - 1, Math.floor(t * srcs.length))]) }),
            duration,
            easing,
        ) as never;
    });
    r.addCommand("noop", (_target, _args, duration) => makeCommand({ set: () => { } }, () => ({}), duration) as never);
    return r;
}

afterEach(() => {
    declared.slides = 0;
    declared.picture = 0;
    vi.restoreAllMocks();
});

// ─── Harness ──────────────────────────────────────────────────────────────────

type Windows = Record<string, [number, number]>;

function windowsOf(records: ReadonlyMap<string, AssetRecord>): Windows {
    return Object.fromEntries([...records].map(([key, r]) => [key, [r.startFrame, r.endFrame]]));
}

function scopeFor(reg: Registry) {
    return runtimeScope({ fps: FPS, viewport: VIEWPORT, assets: catalog(), registry: reg });
}

function refine(doc: ClipDocument, reg = registry()): { result: RefineResult; records: ReadonlyMap<string, AssetRecord> } {
    const scope = scopeFor(reg);
    const duration = documentDuration(doc);
    const frameCount = trackFrameCount(duration, FPS);
    const instance = new ClipInstance(doc, duration, scope);
    try {
        instance.build();
        const sweep = refineAssets(instance, { fps: FPS, frameCount, catalog: scope.assets });
        let step = sweep.next();
        while (!step.done) step = sweep.next();
        const index = new AssetIndex(frameCount);
        for (const owner of step.value.owners.values()) {
            if (!owner.error) index.setOwner(owner.ownerKey, owner.segments);
        }
        return { result: step.value, records: index.records() };
    } finally {
        instance.dispose();
    }
}

/** Run the sweep with options of its own, rather than the whole-clip defaults of {@link refine}. */
function sweep(doc: ClipDocument, options: Partial<Parameters<typeof refineAssets>[1]> = {}, reg = registry()): RefineResult {
    const scope = scopeFor(reg);
    const duration = documentDuration(doc);
    const frameCount = trackFrameCount(duration, FPS);
    const instance = new ClipInstance(doc, duration, scope);
    try {
        instance.build();
        const run = refineAssets(instance, { fps: FPS, frameCount, catalog: scope.assets, ...options });
        let step = run.next();
        while (!step.done) step = run.next();
        return step.value;
    } finally {
        instance.dispose();
    }
}

function walked(doc: ClipDocument, reg = registry(), duration = documentDuration(doc)): Windows {
    return windowsOf(walkedAssetRecords(doc, duration, scopeFor(reg)));
}

/** Refinement must reproduce the frame walk exactly, key for key. */
function expectExact(doc: ClipDocument, reg = registry()): Windows {
    const got = windowsOf(refine(doc, reg).records);
    expect(got).toEqual(walked(doc, reg));
    return got;
}

const at = (spec: NodeSpec, span: { startAt?: number; endAt?: number }): TimedNodeSpec => ({ ...spec, ...span });

// ─── Documents ────────────────────────────────────────────────────────────────

function crossFade(): CompositionDocument {
    return comp([node("card", "rect", { width: 100, height: 100, fill: "#ff0000" })],
        [1, { target: "card", args: { fill: Fills.image("pic.png") }, duration: 1 }], 3);
}

function fadeOut(): CompositionDocument {
    return comp([at(node("card", "rect", { width: 100, height: 100, fill: Fills.image("pic.png") }), { endAt: 2.5 })],
        [1, { target: "card", args: { fill: "#ff0000" }, duration: 1 }], 3);
}

function removed(): CompositionDocument {
    return comp([at(node("card", "rect", { width: 100, height: 100, fill: Fills.image("pic.png") }), { endAt: 1 })], [3]);
}

const SLIDES = ["a.png", "b.png", "c.png", "d.png", "e.png"];

describe("refineAssets – exact windows", () => {
    it("cross-fades an image in", () => {
        expect(expectExact(crossFade())).toMatchObject({ "pic.png": [11, 29] });
    });

    it("fades an image out, then removes its node", () => {
        expect(expectExact(fadeOut())).toEqual({ "pic.png": [0, 19] });
    });

    it("closes a removed node's window where it goes", () => {
        expect(expectExact(removed())).toEqual({ "pic.png": [0, 9] });
    });

    it("follows a keyframe command that swaps a src five times over its span", () => {
        const doc = comp([node("card", "rect", { width: 100, height: 100 })],
            [0.5, { target: "card", type: "flipbook", args: { srcs: SLIDES }, duration: 1 }], 2);
        const windows = expectExact(doc);
        expect(Object.keys(windows).sort()).toEqual(SLIDES);
        expect(windows["a.png"][0]).toBe(5);
        expect(windows["e.png"][1]).toBe(19);
    });

    it("follows slides[Math.round(index)] through to({ index: 4 })", () => {
        const doc = comp([node("show", "slides", { slides: SLIDES })],
            [{ target: "show", args: { index: 4 }, duration: 2 }], 3);
        expect(Object.keys(expectExact(doc)).sort()).toEqual(SLIDES);
    });

    it("follows a numeric variable driving the index", () => {
        const doc: CompositionDocument = {
            ...comp([node("show", "slides", { slides: SLIDES, index: "=[g]" })], [], 3),
            variables: [{ id: "g", value: 0 }],
            commands: [{ id: "g-up", type: "variableTo", targetId: "g", at: 0.5, duration: 2, args: { value: 4 } }],
        };
        expect(Object.keys(expectExact(doc)).sort()).toEqual(SLIDES);
    });

    it("picks a step variable up for a node arriving part-way through its command", () => {
        const doc: CompositionDocument = {
            ...comp([at(node("pic", "picture", { src: "=[src]" }), { startAt: 1.5 })], [], 4),
            variables: [{ id: "src", value: "a.png", lerp: "step" }],
            commands: [{ id: "swap", type: "variableTo", targetId: "src", at: 1, duration: 1.5, args: { value: "c.png" } }],
        };
        expect(expectExact(doc)).toEqual({ "a.png": [15, 24], "c.png": [25, 39] });
    });

    it("applies two overlapping writers of one variable", () => {
        const doc: CompositionDocument = {
            ...comp([node("show", "slides", { slides: SLIDES, index: "=[g]" })], [], 3),
            variables: [{ id: "g", value: 0 }],
            commands: [
                { id: "long", type: "variableTo", targetId: "g", at: 0, duration: 2, args: { value: 4 } },
                { id: "short", type: "variableTo", targetId: "g", at: 0.8, duration: 0.6, args: { value: 0 } },
            ],
        };
        expectExact(doc);
    });

    it("follows a [card.src] binding onto a card that arrives later", () => {
        const doc = comp([
            node("viewer", "picture", { src: "=[card.src]" }),
            { ...at(node("card", "holder", { src: "b.png" }), { startAt: 1, endAt: 3.5 }), key: "card" },
        ], [2.5, { target: "card", type: "set", args: { src: "d.png" } }], 4);
        expect(expectExact(doc)).toEqual({ "b.png": [10, 24], "d.png": [25, 34] });
    });

    it("declares an owner a command writes nothing to once", () => {
        const doc = comp([node("pic", "picture", { src: "a.png" })],
            [{ target: "pic", type: "noop", args: {}, duration: 2 }], 3);
        refine(doc);
        expect(declared.picture).toBe(1);
        expect(expectExact(doc)).toEqual({ "a.png": [0, 29] });
    });

    it("tracks a text family change and a run's own face", () => {
        const doc = comp([
            node("title", "text", { text: "hello", fontFamily: "Inter" }),
            node("styled", "text", { text: "hello world", fontFamily: "Inter", runs: [{ start: 6, end: 11, fontFamily: "Serif" }] }),
        ], [1, { target: "title", type: "set", args: { fontFamily: "Mono" } }], 2);
        expect(expectExact(doc)).toEqual({ Inter: [0, 19], Mono: [10, 19], Serif: [0, 19] });
    });

    it("keeps a video fill's trim", () => {
        const doc = comp([node("v", "rect", { width: 100, height: 100, fill: Fills.video("clip.mp4", { trimStart: 1, trimEnd: 3 }) })],
            [1, { target: "v", args: { fill: "#000" }, duration: 0.5 }], 2);
        const { records } = refine(doc);
        expect(windowsOf(records)).toEqual(walked(doc));
        expect(records.get("clip.mp4")).toMatchObject({ type: "video", trimStart: 1, trimEnd: 3 });
    });
});

describe("refineAssets – declaration counts", () => {
    const declares = (doc: CompositionDocument) => {
        const { registry: reg, log } = probeRegistry();
        refine(doc, reg);
        return log.declares;
    };
    const probe = (id: string, props: Record<string, unknown> = {}) => node(id, "probe", { width: 10, height: 10, ...props });

    it("declares each owner of a static document once", () => {
        expect(declares(comp([probe("p"), probe("q")], [2]))).toBe(2);
    });

    it("does not redeclare for transform and opacity tweens", () => {
        expect(declares(comp([probe("p")], [{ target: "p", args: { x: 50, y: 20, opacity: 0.5 }, duration: 1 }, 1]))).toBe(1);
    });

    it("redeclares a colour tween at most once per frame it runs", () => {
        const count = declares(comp([probe("p", { fill: "#ff0000" })], [1, { target: "p", args: { fill: "#00ff00" }, duration: 1 }, 1]));
        // Arrival, then frames 10..20 and the first frame after: a resolved fill is a
        // fresh array every frame, so nothing inside the tween reuses a declaration.
        expect(count).toBe(1 + 11 + 1);
    });

    it("declares a held step variable once per value, however long it is held", () => {
        const held = (hold: number) => {
            const doc: CompositionDocument = {
                ...comp([node("pic", "picture", { src: "=[src]" })], [], 1 + hold),
                variables: [{ id: "src", value: "a.png", lerp: "step" }],
                commands: [
                    { id: "b", type: "variableSet", targetId: "src", at: 0.5, args: { value: "b.png" } },
                    { id: "c", type: "variableTo", targetId: "src", at: 1, duration: 0.5, args: { value: "c.png" } },
                ],
            };
            declared.picture = 0;
            refine(doc);
            return declared.picture;
        };
        expect(held(1)).toBe(3);
        expect(held(20)).toBe(3);
    });
});

describe("refineAssets – owners", () => {
    it("attributes a throwing declaration to its owner and carries on with the rest", () => {
        const doc = still(node("bad", "picture", { src: "missing.png" }), node("ok", "picture", { src: "a.png" }));
        const { result, records } = refine(doc);
        const bad = result.owners.get("bad")!;
        expect(bad.error?.message).toContain("missing.png");
        expect(bad.error?.prop).toBe("bad.src");
        expect(bad.segments).toEqual([]);
        expect([...records.keys()]).toEqual(["a.png"]);
    });

    it("reports what each owner read, and who reads each slot", () => {
        const doc: CompositionDocument = {
            ...comp([node("show", "slides", { slides: SLIDES, index: "=[g]" })], [], 1),
            variables: [{ id: "g", value: 0 }],
        };
        const { result } = refine(doc);
        const labels = [...result.owners.get("show")!.deps].map((slot) => slot._name);
        expect(labels).toEqual(expect.arrayContaining(["slides", "index", "var:g"]));
        const variable = [...result.readers.keys()].find((slot) => slot._name === "var:g")!;
        expect([...result.readers.get(variable)!]).toEqual(["show"]);
    });

    it("limits a sweep to the owners asked for, from their frame on", () => {
        const doc = comp([node("show", "slides", { slides: SLIDES }), node("pic", "picture", { src: "a.png" })],
            [{ target: "show", args: { index: 4 }, duration: 2 }], 3);
        const scope = scopeFor(registry());
        const instance = new ClipInstance(doc, 3, scope);
        instance.build();
        const sweep = refineAssets(instance, { fps: FPS, frameCount: 30, catalog: scope.assets, owners: new Map([["show", 12]]) });
        let step = sweep.next();
        while (!step.done) step = sweep.next();
        instance.dispose();

        expect([...step.value.owners.keys()]).toEqual(["show"]);
        const segments = step.value.owners.get("show")!.segments;
        expect(Math.min(...segments.map((s) => s.startFrame))).toBe(12);
        expect(segments.map((s) => s.key)).not.toContain("a.png");
    });

    it("warns once when a declaration reads layout", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        refine(comp([node("r", "layoutReader"), node("s", "layoutReader")], [1]));
        expect(warn.mock.calls.filter(([m]) => String(m).includes("layoutBounds"))).toHaveLength(1);
    });

    it("re-declares a reader from where a command starts writing a slot compile never saw it write", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const reg = registry();
        // Its end state writes only `width`, so compile records nothing a picture reads.
        reg.addCommand("sneak", (target, _args, duration) =>
            makeCommand<Record<string, unknown>>(target as never, (t) => (t < 0.5 ? { src: "b.png" } : { width: 10 }), duration) as never);
        const doc: CompositionDocument = {
            kind: "composition",
            duration: 3,
            nodes: [node("pic", "picture", { src: "a.png" }), node("fader", "rect", { width: 10, height: 10, fill: "#ff0000" })],
            commands: [
                { id: "sneak", type: "sneak", targetId: "pic", at: 1, duration: 1, args: {} },
                // Evaluates frames inside the sneak, first at frame 12 — after it began writing.
                { id: "fade", type: "to", targetId: "fader", at: 1.2, duration: 1, args: { fill: "#00ff00" } },
            ],
        };
        expect(expectExact(doc, reg)).toEqual({ "a.png": [0, 29], "b.png": [10, 14] });
        expect(warn.mock.calls.some(([m]) => String(m).includes("Command sneak wrote pic.src"))).toBe(true);
    });
});

describe("AssetTimeline – refined windows against the frame walk", () => {
    function removingRow(): CompositionDocument {
        return comp([
            node("row", "rect", { width: "hug", height: "fill", flow: "horizontal", gap: 24, align: "centerLeft" }),
            node("first", "rect", { width: 120, height: 120 }, "row", 0),
            node("label", "text", { text: "A", fontFamily: "Inter" }, "first", 0),
            at(node("mid", "rect", { width: 120, height: 120, fill: Fills.image("mid.png") }, "row", 1), { endAt: 0.5 }),
            node("last", "rect", { width: 120, height: 120 }, "row", 2),
        ], [1]);
    }

    const stillPictures = () => still(
        node("v", "rect", { width: 512, height: 512, fill: Fills.video("clip.mp4") }),
        node("pic", "rect", { width: 512, height: 512, fill: Fills.image("img.png") }),
    );

    const fixtures: [string, ClipDocument][] = [
        ["cross-fade", crossFade()],
        ["fade-out", fadeOut()],
        ["removed", removed()],
        ["removing row", removingRow()],
        ["still media", stillPictures()],
    ];

    it.each(fixtures)("%s: the walk's windows", (_name, doc) => {
        const reg = registry();
        const clip = track("a", doc, doc.kind === "still" ? { duration: 1 } : {});
        const proj = project([clip], { viewport: VIEWPORT });
        const scope = scopeFor(reg);
        const refined = windowsOf(precompFor(proj, { assets: scope.assets, registry: reg }).run().tracks[0].assetRecords);

        expect(refined).toEqual(walked(doc, reg, clip.duration));
    });
});


describe("refineAssets – warnings", () => {
    const messages = (spy: ReturnType<typeof vi.spyOn>): string[] => spy.mock.calls.map(([m]: unknown[]) => String(m));

    it("warns when a declaration writes a prop, naming the type and the slot, once per slot however often it is declared", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        refine(comp([node("w1", "writeDeclarer")], [{ target: "w1", args: { x: 40 }, duration: 1 }], 2));

        const found = messages(warn).filter((m) => m.includes("WriteDeclarer wrote"));
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("w1.opacity");
        expect(found[0]).toContain("while declaring its assets");
    });

    it("warns for each distinct slot a type writes, since the key is the type and the slots", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        refine(still(node("w2", "writeDeclarer"), node("w3", "writeDeclarer")));

        const found = messages(warn).filter((m) => m.includes("WriteDeclarer wrote"));
        expect(found.some((m) => m.includes("w2.opacity"))).toBe(true);
        expect(found.some((m) => m.includes("w3.opacity"))).toBe(true);
    });

    it("warns once when a declaration reads the node's clock", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        refine(still(node("c1", "clockDeclarer"), node("c2", "clockDeclarer")));

        const found = messages(warn).filter((m) => m.includes("ClockDeclarer.declareAssets read time"));
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("re-run only when a prop they read changes");
    });

    it("keeps what a misbehaving declaration declared, however it misbehaved", () => {
        vi.spyOn(console, "warn").mockImplementation(() => { });
        const { result } = refine(still(node("w", "writeDeclarer"), node("c", "clockDeclarer")));
        for (const id of ["w", "c"]) {
            expect(result.owners.get(id)?.error).toBeUndefined();
            expect(result.owners.get(id)?.segments.map((segment) => segment.key)).toEqual(["a.png"]);
        }
    });

    it("says nothing about either in production", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        vi.stubEnv("NODE_ENV", "production");
        try {
            refine(still(node("w", "quietWriteDeclarer"), node("c", "quietClockDeclarer")));
        } finally {
            vi.unstubAllEnvs();
        }
        expect(messages(warn).filter((m) => m.includes("[assets]"))).toEqual([]);
    });

    describe("re-queued past the cap", () => {
        /** A document of `count` commands that each write `pic.src` at run time and a width at compile time. */
        function sneaking(count: number, picId: string): { doc: CompositionDocument; reg: Registry } {
            const reg = registry();
            reg.addCommand("sneak", (target, _args, duration) =>
                makeCommand<Record<string, unknown>>(target as never, (t) => (t < 0.5 ? { src: "b.png" } : { width: 10 }), duration) as never);
            const doc: CompositionDocument = {
                kind: "composition",
                duration: 3,
                nodes: [node(picId, "picture", { src: "a.png" }), node("fader", "rect", { width: 10, height: 10, fill: "#ff0000" })],
                commands: [
                    ...Array.from({ length: count }, (_, i) => ({
                        id: `sneak${i}`, type: "sneak", targetId: picId, at: 1, duration: 1, args: {},
                    })),
                    // Forces the first frame evaluated inside the sneaks to be past where they start.
                    { id: "fade", type: "to", targetId: "fader", at: 1.2, duration: 1, args: { fill: "#00ff00" } },
                ],
            };
            return { doc, reg };
        }

        it("warns once when an owner has been re-queued three times and a fourth command arrives", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
            const { doc, reg } = sneaking(4, "capped");
            refine(doc, reg);

            const capped = messages(warn).filter((m) => m.includes("capped was re-queued 3 times"));
            expect(capped).toHaveLength(1);
            expect(capped[0]).toContain("(last by command sneak3)");
            expect(capped[0]).toContain("its asset windows may be incomplete");
        });

        it("does not warn at three", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
            const { doc, reg } = sneaking(3, "withinCap");
            refine(doc, reg);
            expect(messages(warn).filter((m) => m.includes("was re-queued"))).toEqual([]);
        });

        it("keeps the windows it has, rather than dropping the owner or throwing", () => {
            vi.spyOn(console, "warn").mockImplementation(() => { });
            const { doc, reg } = sneaking(4, "kept");
            const { result, records } = refine(doc, reg);

            expect(result.owners.get("kept")?.error).toBeUndefined();
            // The declared picture holds for the whole clip; what the capped command would
            // have added is the part that may be missing.
            expect(windowsOf(records)["a.png"]).toEqual([0, 29]);
        });
    });
});

describe("refineAssets – limited sweeps", () => {
    const doc = () => comp([
        node("show", "slides", { slides: SLIDES }),
        node("panel", "panel"),
        node("pic", "picture", { src: "a.png" }),
    ], [{ target: "show", args: { index: 4 }, duration: 2 }], 3);

    it("limits a sweep to the owners built below a row, from the frame given", () => {
        const result = sweep(doc(), { below: new Map([["panel", 5]]) });

        expect([...result.owners.keys()]).toEqual(["panel/0"]);
        const segments = result.owners.get("panel/0")!.segments;
        expect(segments.map((segment) => segment.key)).toEqual(["b.png"]);
        expect(segments[0].startFrame).toBe(5);
        // Open-ended: the index clamps it to the clip's last frame.
        expect(segments[0].endFrame).toBe(Infinity);
    });

    it("leaves out the row itself: below means the owners a composite built", () => {
        const result = sweep(doc(), { below: new Map([["panel", 0]]) });
        expect(result.owners.has("panel")).toBe(false);
    });

    it("combines owners and below, each from its own frame, and an earlier frame wins for an owner named by both", () => {
        const result = sweep(doc(), { owners: new Map([["pic", 20], ["panel/0", 25]]), below: new Map([["panel", 10]]) });

        expect([...result.owners.keys()].sort()).toEqual(["panel/0", "pic"]);
        expect(result.owners.get("pic")!.segments[0].startFrame).toBe(20);
        expect(result.owners.get("panel/0")!.segments[0].startFrame).toBe(10);
    });

    it("sweeps nothing for an empty limit", () => {
        const result = sweep(doc(), { owners: new Map(), below: new Map() });
        expect(result.owners.size).toBe(0);
        expect(declared.picture).toBe(0);
    });

    it("sweeps nothing when the earliest frame asked for is past the end of the clip", () => {
        const result = sweep(doc(), { owners: new Map([["pic", 500]]) });
        // Nothing was walked, but the owner asked for still answers, empty.
        expect([...result.owners.keys()]).toEqual(["pic"]);
        expect(result.owners.get("pic")).toEqual({ ownerKey: "pic", nodeId: undefined, segments: [], deps: new Set() });
    });

    it("answers an owner that no longer exists with an empty result instead of leaving it out", () => {
        const result = sweep(doc(), { owners: new Map([["gone", 0], ["pic", 0]]) });

        expect(result.owners.get("gone")).toEqual({ ownerKey: "gone", nodeId: undefined, segments: [], deps: new Set() });
        // So that a caller replacing an owner's segments wholesale drops the ones it had.
        expect(result.owners.get("pic")!.nodeId).toBe("pic");
        expect(result.owners.get("pic")!.segments.map((segment) => segment.key)).toEqual(["a.png"]);
    });

    it("declares nothing at all with declare: false, and still reports each owner once on arrival", () => {
        const arrived: { key: string; frame: number; id: string }[] = [];
        const result = sweep(doc(), {
            declare: false,
            onArrive: (arrivingNode, key, _span, frame) => { arrived.push({ key, frame, id: arrivingNode.id }); },
        });

        expect(declared.slides).toBe(0);
        expect(declared.picture).toBe(0);
        for (const owner of result.owners.values()) {
            expect(owner.segments).toEqual([]);
            expect(owner.deps.size).toBe(0);
        }
        const keys = arrived.map((entry) => entry.key);
        expect(keys).toEqual(expect.arrayContaining(["", "show", "panel", "panel/0", "pic"]));
        expect(new Set(keys).size).toBe(keys.length);
        expect(arrived.every((entry) => entry.frame === 0)).toBe(true);
    });

    it("reports a row's span and the frame it arrived on to onArrive", () => {
        const arrivals = new Map<string, { start: number; end: number; frame: number }>();
        sweep(comp([{ ...node("late", "picture", { src: "a.png" }), startAt: 1, endAt: 2 }], [], 3), {
            declare: false,
            onArrive: (_node, key, span, frame) => { arrivals.set(key, { start: span.start, end: span.end, frame }); },
        });
        expect(arrivals.get("late")).toEqual({ start: 1, end: 2, frame: 10 });
    });

    it("runs the phase hook around evaluation and declaration", () => {
        const phases: string[] = [];
        sweep(still(node("pic", "picture", { src: "a.png" })), { onPhase: (phase) => phases.push(phase) });
        expect(phases[0]).toBe("evaluate");
        expect(phases).toContain("declare");
    });
});
