import { afterEach, describe, expect, it, vi } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { AssetNotLoadedError } from "@/assets/errors";
import { AssetManager } from "@/assets/manager";
import type { AssetScope } from "@/assets/scope";
import { declareMembers, property } from "@/attributes/properties/decorator";
import type { Size2D } from "@/attributes/layout/size";
import { Fills } from "@/attributes/shape/fill/chain";
import type { ProjectDocument } from "@/document/project";
import { Registry } from "@/document/registry";
import type { CompositionDocument, TimedNodeSpec } from "@/document/types";
import { Node2D, type Node2DProps, type NodeConfig } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import type { MeasureContext2D } from "@/render/measure-context";
import { ClipInstance, type RuntimeScope } from "@/runtime/clip-instance";
import { countingRegistry } from "@/runtime/clip-snapshot.fixtures";
import { ClipStore, type StoreUpdate } from "@/runtime/clip-store";
import { comp, node, openController, probeRegistry, project, runtimeScope, track } from "@/runtime/document.fixtures";
import { AssetTimeline, type AssetTimelineResult, type TrackAssets } from "@/runtime/asset-timeline";
import { FakeStorageAdapter, asStorage } from "@/runtime/runtime.fixtures";
import { StateEvaluator } from "@/runtime/state-evaluator";
import { generated } from "@/components/factory/tests/generated.fixtures";

const IMAGES = ["a.png", "b.png", "c.png", "d.png", "e.png"];

const catalog = () => new ManifestAssetCatalog({
    image: Object.fromEntries(IMAGES.map((src) => [src, { src, width: 64, height: 48, sizeBytes: 0 }])),
    video: {},
    audio: {
        "a.mp3": { src: "a.mp3", duration: 2, sizeBytes: 0 },
        "b.mp3": { src: "b.mp3", duration: 2, sizeBytes: 0 },
    },
    font: {},
});

// ─── Test nodes ───────────────────────────────────────────────────────────────

/** Every owner that declared, in order — one entry per declaration. */
const declaredBy: string[] = [];

afterEach(() => {
    declaredBy.length = 0;
    vi.restoreAllMocks();
});

class Pic extends generated(Rect) {
    override declareAssets(assets: AssetScope): void {
        declaredBy.push(this.id);
        super.declareAssets(assets);
    }
}

interface HolderProps extends Node2DProps { src: string }

/** Holds a src it never paints. */
class Holder extends Node2D<HolderProps> {
    declare readonly src: string;

    constructor(props?: NodeConfig<Holder, HolderProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }
}

declareMembers(Holder, {
    src: property({ default: "" }),
});

/** Declares the src of every holder among its children. */
class Gallery extends Node2D {
    override declareAssets(assets: AssetScope): void {
        declaredBy.push(this.id);
        super.declareAssets(assets);
        for (const child of this.children) if (child instanceof Holder) assets.image(child.src);
    }
}

/** A node whose draw reaches for a picture nothing declared. */
class Late extends Node2D {
    protected override renderSelf(): void {
        throw new AssetNotLoadedError("image", "late.png");
    }
}

const vocabulary = () => new Registry({
    nodes: { pic: Pic as never, holder: Holder as never, gallery: Gallery as never, late: Late as never },
});

// ─── Harness ──────────────────────────────────────────────────────────────────

const pic = (id: string, src: string, props: Record<string, unknown> = {}): TimedNodeSpec =>
    node(id, "pic", { width: 10, height: 10, fill: Fills.image(src), ...props });

function discovered(doc: ProjectDocument, scope: RuntimeScope = runtimeScope({ registry: vocabulary(), assets: catalog() })) {
    const store = new ClipStore(doc, scope);
    for (const t of doc.tracks) store.discover(t.id);
    declaredBy.length = 0;
    return { store, scope };
}

interface Windows {
    records: Record<string, [string, number, number]>;
    audio: string[];
    gates: string[] | undefined;
}

function windowsOf(found: TrackAssets): Windows {
    return {
        records: Object.fromEntries([...found.assetRecords].map(([key, r]) => [key, [r.type, r.startFrame, r.endFrame]])),
        audio: found.audioRequests.map((r) => `${r.src}@${r.startAt}-${r.endAt}x${r.volume}`).sort(),
        gates: found.layoutGates,
    };
}

/**
 * Take `next` into `store`, and require every track to hold exactly what a fresh
 * store refines for `next`. Returns what the update did, and who declared during it.
 */
function edit(store: ClipStore, scope: RuntimeScope, next: ProjectDocument): { update: StoreUpdate; declared: string[] } {
    declaredBy.length = 0;
    const update = store.setProject(next);
    const declared = [...declaredBy];
    for (const t of next.tracks) store.discover(t.id);

    const fresh = new ClipStore(next, scope);
    for (const t of next.tracks) {
        fresh.discover(t.id);
        expect(windowsOf(store.trackAssets(t.id)!), `track ${t.id}`).toEqual(windowsOf(fresh.trackAssets(t.id)!));
    }
    fresh.dispose();
    declaredBy.length = 0;
    return { update, declared };
}

/** Three pictures over three seconds, the first sliding. */
function slides(options: { x?: number; firstX?: number; firstSrc?: string } = {}): CompositionDocument {
    return comp([
        pic("p1", options.firstSrc ?? "a.png", options.firstX === undefined ? {} : { x: options.firstX }),
        pic("p2", "b.png"),
        pic("p3", "c.png"),
    ], [{ target: "p1", args: { x: options.x ?? 40 }, duration: 1 }], 3);
}

function completion() {
    let resolve!: (result: AssetTimelineResult) => void;
    const done = new Promise<AssetTimelineResult>((r) => { resolve = r; });
    return { done, onPrecompProgress: (result: AssetTimelineResult) => { if (result.complete) resolve(result); } };
}

// ─── One build per track ──────────────────────────────────────────────────────

describe("ClipStore – one build per track", () => {
    const probed = (id: string) => comp([node(id, "probe", { width: 10, height: 10 })], [1]);

    it("builds each track once across the first paint, background discovery and seeks", async () => {
        const { registry, log } = probeRegistry();
        const { done, onPrecompProgress } = completion();
        const { controller } = openController(project([
            track("a", probed("pa")),
            track("b", probed("pb"), { startAt: 1 }),
            track("c", probed("pc"), { startAt: 2 }),
        ]), { registry, precompBudgetMs: 0, onPrecompProgress });

        await done;
        for (const frame of [0, 15, 25, 5, 29]) await controller.seek(frame);
        expect([...log.constructed].sort()).toEqual(["pa", "pb", "pc"]);
        controller.dispose();
    });

    it("builds each track once when an export's discovery and evaluator share a store", () => {
        const { registry, log } = probeRegistry();
        const doc = project([track("a", probed("pa")), track("b", probed("pb"), { startAt: 0.5 })]);
        const scope = runtimeScope({ registry });
        const store = new ClipStore(doc, scope);
        const precomp = new AssetTimeline(doc, scope, { store }).run();
        const evaluator = new StateEvaluator(doc, scope, store);
        for (let frame = 0; frame < precomp.totalFrames; frame++) {
            evaluator.stateAt(frame);
            evaluator.layout();
        }
        expect(log.constructed).toEqual(["pa", "pb"]);
        evaluator.dispose();
        store.dispose();
    });

    it("drains a parked build for a seek rather than starting another", async () => {
        const { registry, log } = probeRegistry();
        const doc = project([track("a", comp([node("p", "probe", { width: 10, height: 10 })], [
            { target: "p", args: { fill: "#ff0000" }, duration: 1 },
        ]))]);
        const scope = runtimeScope({ registry });
        const store = new ClipStore(doc, scope);
        let polls = 0;
        await store.runAsync({ budgetMs: 0, isCancelled: () => ++polls > 3 });
        expect(store.isDiscovered("a")).toBe(false);
        expect(log.constructed).toEqual(["p"]);

        const evaluator = new StateEvaluator(doc, scope, store);
        evaluator.stateAt(5);
        expect(log.constructed).toEqual(["p"]);
        expect(store.isDiscovered("a")).toBe(true);
        expect(evaluator.currentCanvas).toBe(store.instanceOf("a")!.canvas);
        store.dispose();
    });

    it("keeps what discovery found across releasing a tree, and builds it again without refining", () => {
        const { registry, log } = probeRegistry();
        const doc = project([track("a", comp([node("p", "probe", { width: 10, height: 10, fill: Fills.image("a.png") })], [1]))]);
        const store = new ClipStore(doc, runtimeScope({ registry, assets: catalog() }));
        store.discover("a");
        const found = store.trackAssets("a");
        const declares = log.declares;

        store.trim(100, 10);
        expect(store.instanceOf("a")).toBeNull();
        expect(store.trackAssets("a")).toBe(found);
        expect(store.ensureBuilt("a")).not.toBeNull();
        expect(log.constructed).toEqual(["p", "p"]);
        expect(log.declares).toBe(declares);
        store.dispose();
    });
});

// ─── Layout gates ─────────────────────────────────────────────────────────────

/** Measures a face at twice the width once it has loaded. */
class FaceMeasurer implements MeasureContext2D {
    constructor(private readonly _storage: FakeStorageAdapter) { }

    measureText(text: string, fontSize: number, fontFamily: string): Size2D {
        return { width: text.length * (this._storage.isLoaded(fontFamily) ? 20 : 10), height: fontSize };
    }
}

function gated(readsLayout: boolean) {
    const { registry, constructed } = countingRegistry();
    const storage = new FakeStorageAdapter();
    const title = node("t", "text", {
        text: "hello", fontFamily: "Inter", fontSize: 10,
        // Positioned against its own box, so the slide's `from` is read off the laid-out width.
        ...(readsLayout && { topLeft: { x: 0, y: 0 } }),
    });
    const doc = project([track("a", comp([title], [{ target: "t", args: { x: 40 }, duration: 1 }]))]);
    const { controller } = openController(doc, { registry, storageAdapter: asStorage(storage), measurer: new FaceMeasurer(storage) });
    return { controller, constructed, storage };
}

describe("ClipStore – layout gates", () => {
    it("loads a face, then rebuilds a compile that measured without it — once", async () => {
        const { controller, constructed, storage } = gated(true);
        expect(constructed).toEqual(["t"]);
        const builtAtLoad: number[] = [];
        const load = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            if (key === "Inter") builtAtLoad.push(constructed.length);
            return load(key, record);
        };

        await controller.seek(0);
        expect(builtAtLoad[0]).toBe(1);
        expect(constructed).toEqual(["t", "t"]);
        // topLeft at 0 puts the centre half a width right: 5 glyphs at 20 each.
        expect(controller.getNodePropsAt("0")!.x).toBeCloseTo(50);

        await controller.seek(5);
        await controller.seek(0);
        expect(constructed).toEqual(["t", "t"]);
        controller.dispose();
    });

    it("rebuilds a compile that measured without the face even when no command read layout — once", async () => {
        // A node may keep what it measured; only a fresh tree drops the fallback's metrics.
        const { controller, constructed, storage } = gated(false);
        await controller.seek(0);
        expect(storage.isLoaded("Inter")).toBe(true);
        expect(constructed).toEqual(["t", "t"]);

        await controller.seek(5);
        await controller.seek(0);
        expect(constructed).toEqual(["t", "t"]);
        controller.dispose();
    });
});

// ─── Incremental asset index ──────────────────────────────────────────────────

describe("ClipStore – an edit re-declares only what it reached", () => {
    it("declares nothing for a tween nobody's declaration reads", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        const version = store.version;
        const { update, declared } = edit(store, scope, project([track("a", slides({ x: 80 }))]));
        expect(declared).toEqual([]);
        expect(update.deltas.size).toBe(0);
        expect(update.rebuilt).toEqual([]);
        expect(store.version).toBe(version);
        store.dispose();
    });

    it("declares nothing for a moved node, though the edit rebuilt it", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        const { declared, update } = edit(store, scope, project([track("a", slides({ firstX: 25 }))]));
        expect(declared).toEqual([]);
        expect(update.deltas.size).toBe(0);
        store.dispose();
    });

    it("re-declares only the node whose fill changed, and reports both sources", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        const { declared, update } = edit(store, scope, project([track("a", slides({ firstSrc: "d.png" }))]));
        expect(declared).toEqual(["p1"]);
        expect([...update.deltas.get("a")!].sort()).toEqual(["a.png", "d.png"]);
        store.dispose();
    });

    it("re-declares only the nodes bound to a variable whose value changed", () => {
        const bound = (src: string): CompositionDocument => ({
            ...comp([pic("p1", "a.png", { fill: "=[g]" }), pic("p2", "b.png"), pic("p3", "c.png")], [], 3),
            variables: [{ id: "g", value: Fills.image(src) }],
        });
        const { store, scope } = discovered(project([track("a", bound("a.png"))]));
        const { declared, update } = edit(store, scope, project([track("a", bound("e.png"))]));
        expect(declared).toEqual(["p1"]);
        expect([...update.deltas.get("a")!].sort()).toEqual(["a.png", "e.png"]);
        store.dispose();
    });

    it("re-declares only a retimed fill tween's target", () => {
        const swapped = (at: number): CompositionDocument => ({
            kind: "composition",
            duration: 3,
            nodes: [pic("p1", "a.png"), pic("p2", "b.png"), pic("p3", "c.png")],
            commands: [{ id: "swap", type: "to", targetId: "p1", at, duration: 0.5, args: { fill: Fills.image("e.png") } }],
        });
        const { store, scope } = discovered(project([track("a", swapped(1))]));
        const { declared } = edit(store, scope, project([track("a", swapped(1.5))]));
        expect(declared.length).toBeGreaterThan(0);
        expect(new Set(declared)).toEqual(new Set(["p1"]));
        store.dispose();
    });

    it("re-declares whoever read a removed node's place in the tree", () => {
        const gallery = (holders: string[]) => comp([
            node("g", "gallery", { width: 50, height: 50 }),
            ...holders.map((src, i) => node(`h${i}`, "holder", { src }, "g", i)),
            pic("p1", "c.png"),
            pic("p2", "d.png"),
        ], [], 3);
        const { store, scope } = discovered(project([track("a", gallery(["a.png", "b.png"]))]));
        const { declared, update } = edit(store, scope, project([track("a", gallery(["a.png"]))]));
        expect(declared).toEqual(["g"]);
        expect([...update.deltas.get("a")!]).toEqual(["b.png"]);
        store.dispose();
    });

    it("re-declares whoever read a node that now leaves sooner", () => {
        const mirrored = (cardEnd: number) => comp([
            { ...pic("card", "a.png"), key: "card", endAt: cardEnd },
            pic("m", "b.png", { fill: "=[card.fill]" }),
            pic("p3", "c.png"),
        ], [], 3);
        const { store, scope } = discovered(project([track("a", mirrored(2))]));
        const { declared } = edit(store, scope, project([track("a", mirrored(1))]));
        // The card's own declaration reads what it read before, so it comes back from the memo; its window still
        // closes sooner (`edit` compares every window with a fresh build).
        expect(new Set(declared)).toEqual(new Set(["m"]));
        store.dispose();
    });

    it("re-declares a sound whose level changed, and its audio matches a fresh build", () => {
        const mix = (volume: number) => comp([
            node("s1", "sound", { src: "a.mp3", volume }),
            node("s2", "sound", { src: "b.mp3" }),
            pic("p1", "c.png"),
        ], [], 2);
        const { store, scope } = discovered(project([track("a", mix(0.5))]));
        edit(store, scope, project([track("a", mix(1))]));
        expect(store.trackAssets("a")!.audioRequests.find((r) => r.src === "a.mp3")!.volume).toBe(1);
        store.dispose();
    });

    it("re-declares the sounds under a bus whose span changed, though theirs did not", () => {
        const mix = (busEnd: number) => comp([
            { ...node("bus", "audioBus", {}), endAt: busEnd },
            { ...node("s1", "sound", { src: "a.mp3" }, "bus"), startAt: 0.5, endAt: 1 },
            pic("p1", "c.png"),
        ], [], 3);
        const { store, scope } = discovered(project([track("a", mix(2.5))]));
        const { update } = edit(store, scope, project([track("a", mix(2))]));
        expect(update.rebuilt).toEqual([]);
        const [req] = store.trackAssets("a")!.audioRequests;
        expect(req.bus?.map((s) => [s.startAt, s.endAt])).toEqual([[0, 2]]);
        store.dispose();
    });

    it("patches a one-picture clip rather than starting it again", () => {
        const single = (src: string, x = 0) => comp([pic("p1", src, { x })], [], 3);
        const { store, scope } = discovered(project([track("a", single("a.png"))]));

        const moved = edit(store, scope, project([track("a", single("a.png", 40))]));
        expect(moved.update.rebuilt).toEqual([]);
        expect(moved.declared).toEqual([]);

        const swapped = edit(store, scope, project([track("a", single("d.png", 40))]));
        expect(swapped.update.rebuilt).toEqual([]);
        expect(swapped.declared).toEqual(["p1"]);
        expect([...swapped.update.deltas.get("a")!].sort()).toEqual(["a.png", "d.png"]);
        store.dispose();
    });

    it("re-declares the background when the root row's fill changes, without starting the track again", () => {
        const staged = (background: string) => comp([
            node("", "canvas2d", { fill: Fills.image(background), zoom: 1.2 }),
            pic("p1", "a.png"),
        ], [{ target: null, args: { zoom: 2 }, duration: 1 }], 3);
        const { store, scope } = discovered(project([track("a", staged("b.png"))]));
        const { update, declared } = edit(store, scope, project([track("a", staged("c.png"))]));
        expect(update.rebuilt).toEqual([]);
        expect(declared).toEqual([]);
        expect([...update.deltas.get("a")!].sort()).toEqual(["b.png", "c.png"]);
        store.dispose();
    });

    it("keeps an edit incremental after the tree was rebuilt, since dependencies outlive the instance", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        store.rebuild("a");
        store.ensureBuilt("a");
        declaredBy.length = 0;
        const { declared } = edit(store, scope, project([track("a", slides({ firstSrc: "d.png" }))]));
        expect(declared).toEqual(["p1"]);
        store.dispose();
    });

    it("starts every track again when the project's theme changes", () => {
        const { registry, log } = probeRegistry();
        const clip = comp([node("p", "probe", { width: 10, height: 10 })], [1]);
        const doc = project([track("a", clip)]);
        const { store } = discovered(doc, runtimeScope({ registry }));

        const update = store.setProject({ ...doc, theme: { typography: { header: { fontSize: 48 } } } });
        expect(update.rebuilt).toEqual(["a"]);
        expect(store.isDiscovered("a")).toBe(false);
        store.discover("a");
        expect(log.constructed).toEqual(["p", "p"]);
        store.dispose();
    });
});

describe("PlaybackController – incremental asset updates", () => {
    it("republishes nothing for an edit no declaration read, and still paints it", async () => {
        const setPrecomp = vi.spyOn(AssetManager.prototype, "setPrecomp");
        const { controller, rc } = openController(project([track("a", slides())]), { registry: vocabulary(), assets: catalog() });
        await controller.seek(5);
        declaredBy.length = 0;
        setPrecomp.mockClear();
        const published = controller.precomp;

        controller.setProject(project([track("a", slides({ x: 80 }))]));
        const renders = rc.renderCount;
        await controller.whenReplaced();

        expect(declaredBy).toEqual([]);
        expect(setPrecomp).not.toHaveBeenCalled();
        expect(controller.precomp).toBe(published);
        expect(rc.renderCount).toBe(renders + 1);
        expect(controller.getNodePropsAt("0")!.x).toBeCloseTo(40);
        controller.dispose();
    });

    it("republishes once for an edit that changed a source, and loads it before the paint", async () => {
        const setPrecomp = vi.spyOn(AssetManager.prototype, "setPrecomp");
        const { controller, storage, rc } = openController(project([track("a", slides())]), { registry: vocabulary(), assets: catalog() });
        await controller.seek(5);
        declaredBy.length = 0;
        setPrecomp.mockClear();
        const loadedAt: number[] = [];
        const load = storage.loadAsset.bind(storage);
        storage.loadAsset = (key, record) => {
            if (key === "d.png") loadedAt.push(rc.renderCount);
            return load(key, record);
        };
        const renders = rc.renderCount;

        controller.setProject(project([track("a", slides({ firstSrc: "d.png" }))]));
        expect(declaredBy).toEqual(["p1"]);
        expect(setPrecomp).toHaveBeenCalledTimes(1);
        expect(controller.precomp.assets.has("a.png")).toBe(false);

        await controller.whenReplaced();
        expect(loadedAt[0]).toBe(renders);
        controller.dispose();
    });

    it("learns an asset a node's draw found missing into that node's window", async () => {
        const { controller } = openController(project([track("a", comp([
            pic("p1", "a.png"),
            node("l", "late", { width: 10, height: 10 }),
        ], [1]))]), { registry: vocabulary(), assets: catalog() });

        await controller.seek(4);
        expect(controller.precomp.tracks[0].assetRecords.get("late.png")).toMatchObject({ startFrame: 4, endFrame: 4 });
        controller.dispose();
    });
});

// ─── An update that cannot be applied ─────────────────────────────────────────

describe("ClipStore – an update that cannot be applied starts the track again", () => {
    /** What a fresh, playable track looks like after the update. */
    function expectFreshAndPlayable(store: ClipStore, update: StoreUpdate, scope: RuntimeScope, next: ProjectDocument): void {
        expect(update.rebuilt).toEqual(["a"]);
        expect(update.deltas.size).toBe(0);
        expect(store.isDiscovered("a")).toBe(false);
        expect(store.failed("a")).toBe(false);

        store.discover("a");
        expect(store.instanceOf("a")).not.toBeNull();
        const fresh = new ClipStore(next, scope);
        fresh.discover("a");
        expect(windowsOf(store.trackAssets("a")!)).toEqual(windowsOf(fresh.trackAssets("a")!));
        fresh.dispose();
    }

    it("when the planner throws", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        const next = project([track("a", slides({ firstSrc: "d.png" }))]);
        vi.spyOn(ClipInstance.prototype, "planUpdate").mockImplementation(() => { throw new Error("planner exploded"); });

        const update = store.setProject(next);
        vi.restoreAllMocks();

        expectFreshAndPlayable(store, update, scope, next);
        expect(store.trackAssets("a")!.assetRecords.has("d.png")).toBe(true);
        store.dispose();
    });

    it("when applying the plan throws, disposing the tree it left unusable", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        const old = store.instanceOf("a")!;
        const disposed = vi.spyOn(old, "dispose");
        const next = project([track("a", slides({ firstSrc: "d.png" }))]);
        vi.spyOn(ClipInstance.prototype, "applyUpdate").mockImplementation(() => { throw new Error("half applied"); });

        const update = store.setProject(next);
        vi.restoreAllMocks();

        expect(disposed).toHaveBeenCalledTimes(1);
        expectFreshAndPlayable(store, update, scope, next);
        store.dispose();
    });

    it("when the planner asks for a rebuild, which is not an error", () => {
        const { store, scope } = discovered(project([track("a", slides())]));
        const stillClip = { kind: "still" as const, nodes: [pic("p1", "a.png")] };
        const next = project([track("a", stillClip, { duration: 3 })]);

        const update = store.setProject(next);

        expectFreshAndPlayable(store, update, scope, next);
        store.dispose();
    });

    it("leaves the other tracks of the project as they were", () => {
        const { store } = discovered(project([track("a", slides()), track("b", slides({ firstSrc: "e.png" }), { startAt: 3 })]));
        const kept = store.instanceOf("b");
        const found = store.trackAssets("b");
        vi.spyOn(ClipInstance.prototype, "planUpdate").mockImplementationOnce(() => { throw new Error("planner exploded"); });

        const update = store.setProject(project([track("a", slides({ firstSrc: "d.png" })), track("b", slides({ firstSrc: "e.png" }), { startAt: 3 })]));

        expect(update.rebuilt).toEqual(["a"]);
        expect(store.instanceOf("b")).toBe(kept);
        expect(store.trackAssets("b")).toBe(found);
        store.dispose();
    });
});

// ─── A track's length changing ────────────────────────────────────────────────

describe("ClipStore – the same clip over a different length", () => {
    const clip = () => comp([pic("p1", "a.png"), { ...pic("p2", "b.png"), startAt: 1 }], [], 3);
    const withLength = (seconds: number) => project([track("a", clip(), { duration: seconds })]);

    it("clips the index of a shorter track and republishes it, without refining again", () => {
        const { store } = discovered(withLength(3));
        const before = store.trackAssets("a")!;
        expect(before.frameCount).toBe(30);
        expect(before.assetRecords.get("a.png")).toMatchObject({ startFrame: 0, endFrame: 29 });
        const version = store.version;

        const update = store.setProject(withLength(2));

        expect(update.rebuilt).toEqual([]);
        expect(store.isDiscovered("a")).toBe(true);
        const after = store.trackAssets("a")!;
        expect(after).not.toBe(before);
        expect(after.frameCount).toBe(20);
        expect(after.assetRecords.get("a.png")).toMatchObject({ startFrame: 0, endFrame: 19 });
        expect(after.assetRecords.get("b.png")).toMatchObject({ startFrame: 10, endFrame: 19 });
        expect(store.version).toBeGreaterThan(version);
        // The result already handed out is left as it was.
        expect(before.assetRecords.get("a.png")).toMatchObject({ endFrame: 29 });
        expect(declaredBy).toEqual([]);
        store.dispose();
    });

    it("drops a window that falls wholly past the new end", () => {
        const { store } = discovered(withLength(3));
        store.setProject(withLength(0.5));
        const records = store.trackAssets("a")!.assetRecords;
        expect(records.get("a.png")).toMatchObject({ startFrame: 0, endFrame: 4 });
        expect(records.has("b.png")).toBe(false);
        store.dispose();
    });

    it("discovers a longer track again, since the frames past its old end were never swept", () => {
        const { store } = discovered(withLength(2));
        expect(store.trackAssets("a")!.assetRecords.get("a.png")).toMatchObject({ endFrame: 19 });
        const version = store.version;

        const update = store.setProject(withLength(3));

        expect(update.rebuilt).toEqual([]);
        expect(store.isDiscovered("a")).toBe(false);
        expect(store.version).toBeGreaterThan(version);

        store.discover("a");
        expect(store.trackAssets("a")!.frameCount).toBe(30);
        expect(store.trackAssets("a")!.assetRecords.get("a.png")).toMatchObject({ endFrame: 29 });
        store.dispose();
    });

    it("keeps the built tree through a length change, telling it the new length", () => {
        const { store } = discovered(withLength(3));
        const instance = store.instanceOf("a")!;

        store.setProject(withLength(2));

        expect(store.instanceOf("a")).toBe(instance);
        expect(instance.duration).toBe(2);
        store.dispose();
    });

    it("does nothing at all when the length is the same", () => {
        const { store } = discovered(withLength(3));
        const found = store.trackAssets("a");
        const version = store.version;

        store.setProject(withLength(3));

        expect(store.trackAssets("a")).toBe(found);
        expect(store.version).toBe(version);
        store.dispose();
    });

    it("lengthens a track that was never refined without discovering anything", () => {
        const store = new ClipStore(withLength(2), runtimeScope({ registry: vocabulary(), assets: catalog() }));
        store.setProject(withLength(3));
        expect(store.isDiscovered("a")).toBe(false);
        store.discover("a");
        expect(store.trackAssets("a")!.frameCount).toBe(30);
        store.dispose();
    });

    it("starts again when the length changes under a build parked between slices", async () => {
        const { registry } = probeRegistry();
        const doc = (seconds: number) => project([track("a", comp([node("p", "probe", { width: 10, height: 10 })], [
            { target: "p", args: { fill: "#ff0000" }, duration: 1 },
        ]), { duration: seconds })]);
        const store = new ClipStore(doc(1), runtimeScope({ registry }));
        let polls = 0;
        await store.runAsync({ budgetMs: 0, isCancelled: () => ++polls > 2 });
        expect(store.isDiscovered("a")).toBe(false);

        const update = store.setProject(doc(2));

        expect(update.rebuilt).toEqual(["a"]);
        store.discover("a");
        expect(store.trackAssets("a")!.frameCount).toBe(20);
        store.dispose();
    });
});

describe("ClipInstance.update", () => {
    const scope = () => runtimeScope({ registry: vocabulary(), assets: catalog() });

    it("returns true for the same clip, only recording the new length", () => {
        const clip = slides();
        const instance = new ClipInstance(clip, 3, scope());
        instance.build();

        expect(instance.update(clip, 2)).toBe(true);

        expect(instance.duration).toBe(2);
        expect(instance.clip).toBe(clip);
        instance.dispose();
    });

    it("returns true and plays the new clip when the difference can be patched", () => {
        const instance = new ClipInstance(slides(), 3, scope());
        instance.build();
        const next = slides({ x: 80 });

        expect(instance.update(next, 3)).toBe(true);

        expect(instance.clip).toBe(next);
        instance.dispose();
    });

    it("returns false, leaving the tree and the clip alone, when only a fresh instance will do", () => {
        const clip = slides();
        const instance = new ClipInstance(clip, 3, scope());
        instance.build();
        const before = instance.node("p1");

        // A composition cannot become a still in place.
        expect(instance.update({ kind: "still", nodes: [pic("p1", "a.png")] }, 1)).toBe(false);

        expect(instance.clip).toBe(clip);
        expect(instance.duration).toBe(3);
        expect(instance.node("p1")).toBe(before);
        instance.dispose();
    });
});

// ─── Running, caching and tearing down ────────────────────────────────────────

describe("ClipStore.runAsync", () => {
    it("discovers the earliest-starting track first, whatever order the document lists them in", async () => {
        const { registry, log } = probeRegistry();
        const clip = (id: string) => comp([node(id, "probe", { width: 10, height: 10 })], [1]);
        const store = new ClipStore(project([
            track("late", clip("pLate"), { startAt: 2 }),
            track("early", clip("pEarly")),
            track("middle", clip("pMiddle"), { startAt: 1 }),
        ]), runtimeScope({ registry }));

        await store.runAsync({ budgetMs: 0 });

        expect(log.constructed).toEqual(["pEarly", "pMiddle", "pLate"]);
        expect(["late", "early", "middle"].every((id) => store.isDiscovered(id))).toBe(true);
        store.dispose();
    });

    it("reports progress once per track that lands", async () => {
        const store = new ClipStore(project([track("a", slides()), track("b", slides(), { startAt: 3 })]),
            runtimeScope({ registry: vocabulary(), assets: catalog() }));
        const landed: string[][] = [];

        await store.runAsync({ budgetMs: 0, onProgress: () => landed.push(["a", "b"].filter((id) => store.isDiscovered(id))) });

        expect(landed).toEqual([["a"], ["a", "b"]]);
        store.dispose();
    });

    it("stops where it is when cancelled, leaving the build parked for whoever needs it", async () => {
        const store = new ClipStore(project([track("a", slides())]), runtimeScope({ registry: vocabulary(), assets: catalog() }));
        let polls = 0;

        await store.runAsync({ budgetMs: 0, isCancelled: () => ++polls > 1 });

        expect(store.isDiscovered("a")).toBe(false);
        // Mid-build: no tree is offered, and the next caller finishes it.
        expect(store.instanceOf("a")).toBeNull();
        expect(store.ensureBuilt("a")).not.toBeNull();
        expect(store.isDiscovered("a")).toBe(true);
        store.dispose();
    });

    it("does nothing at all once the store is disposed, or when it is told to refine nothing", async () => {
        const doc = project([track("a", slides())]);
        const scope = runtimeScope({ registry: vocabulary(), assets: catalog() });

        const disposed = new ClipStore(doc, scope);
        disposed.dispose();
        await disposed.runAsync({ budgetMs: 0 });
        expect(disposed.isDiscovered("a")).toBe(false);

        const plain = new ClipStore(doc, scope, { assets: false, audio: false });
        await plain.runAsync({ budgetMs: 0 });
        expect(plain.isDiscovered("a")).toBe(false);
        plain.dispose();
    });

    it("tears a build down once its slice returns when the document replaced it mid-slice", async () => {
        const dispose = vi.spyOn(ClipInstance.prototype, "dispose");
        let store!: ClipStore;
        let swapped = false;
        class Trap extends generated(Rect) {
            override declareAssets(assets: AssetScope): void {
                super.declareAssets(assets);
                if (swapped) return;
                swapped = true;
                // The document changes while this very slice is running.
                store.setProject(project([track("a", comp([node("q", "rect", { width: 10, height: 10 })], [], 2))]));
            }
        }
        const registry = new Registry({ nodes: { trap: Trap as never } });
        store = new ClipStore(
            project([track("a", comp([node("t", "trap", { width: 10, height: 10 })], [], 1))]),
            runtimeScope({ registry }),
        );

        await store.runAsync({ budgetMs: 0 });

        // The first build was discarded while running, and torn down when it returned.
        expect(dispose).toHaveBeenCalledTimes(1);
        // The new document's track is the one that landed.
        expect(store.isDiscovered("a")).toBe(true);
        expect(store.trackAssets("a")!.frameCount).toBe(20);
        store.dispose();
    });

    it("drops a parked build whose track was replaced, disposing the tree it had built so far", async () => {
        const dispose = vi.spyOn(ClipInstance.prototype, "dispose");
        const { registry } = probeRegistry();
        const clip = (fill: string) => comp([node("p", "probe", { width: 10, height: 10 })], [
            { target: "p", args: { fill }, duration: 1 },
        ]);
        const store = new ClipStore(project([track("a", clip("#ff0000"))]), runtimeScope({ registry }));
        let polls = 0;
        await store.runAsync({ budgetMs: 0, isCancelled: () => ++polls > 2 });
        expect(dispose).not.toHaveBeenCalled();

        const update = store.setProject(project([track("a", clip("#00ff00"))]));

        expect(update.rebuilt).toEqual(["a"]);
        expect(dispose).toHaveBeenCalledTimes(1);
        store.dispose();
    });
});

describe("ClipStore options", () => {
    it("disposes a tree as soon as its refinement lands with keepInstances: false, and keeps what it found", () => {
        const store = new ClipStore(project([track("a", slides())]), runtimeScope({ registry: vocabulary(), assets: catalog() }), { keepInstances: false });

        store.discover("a");

        expect(store.instanceOf("a")).toBeNull();
        expect(store.isDiscovered("a")).toBe(true);
        expect(store.trackAssets("a")!.assetRecords.has("a.png")).toBe(true);
        store.dispose();
    });

    it("keeps the tree by default", () => {
        const { store } = discovered(project([track("a", slides())]));
        expect(store.instanceOf("a")).not.toBeNull();
        store.dispose();
    });

    it("declares audio alone with assets: false, so a caller that only mixes pays for no asset sweep", () => {
        const doc = project([track("a", comp([pic("p1", "a.png"), node("s", "sound", { src: "a.mp3" })], [], 1))]);
        const store = new ClipStore(doc, runtimeScope({ registry: vocabulary(), assets: catalog() }), { assets: false });

        store.discover("a");

        const found = store.trackAssets("a")!;
        expect(found.assetRecords.size).toBe(0);
        expect(found.audioRequests.map((r) => r.src)).toEqual(["a.mp3"]);
        expect(declaredBy).toEqual([]);
        store.dispose();
    });

    it("only builds with assets: false and audio: false: nothing is discovered", () => {
        const doc = project([track("a", comp([pic("p1", "a.png"), node("s", "sound", { src: "a.mp3" })], [], 1))]);
        const store = new ClipStore(doc, runtimeScope({ registry: vocabulary(), assets: catalog() }), { assets: false, audio: false });

        store.discover("a");

        expect(store.instanceOf("a")).not.toBeNull();
        expect(store.isDiscovered("a")).toBe(false);
        expect(store.trackAssets("a")).toBeUndefined();
        store.dispose();
    });
});

describe("ClipStore.dispose", () => {
    it("disposes every tree it holds", () => {
        const dispose = vi.spyOn(ClipInstance.prototype, "dispose");
        const { store } = discovered(project([track("a", slides()), track("b", slides(), { startAt: 3 })]));

        store.dispose();

        expect(dispose).toHaveBeenCalledTimes(2);
        expect(store.instanceOf("a")).toBeNull();
        expect(store.instanceOf("b")).toBeNull();
    });

    it("builds and discovers nothing afterwards, and takes no new document", () => {
        const doc = project([track("a", slides())]);
        const store = new ClipStore(doc, runtimeScope({ registry: vocabulary(), assets: catalog() }));
        store.dispose();

        expect(store.ensureBuilt("a")).toBeNull();
        store.discover("a");
        expect(store.isDiscovered("a")).toBe(false);
        const update = store.setProject(project([track("a", slides({ x: 90 }))]));
        expect(update).toEqual({ deltas: new Map(), rebuilt: [] });
        expect(store.project).toBe(doc);
        store.reset();
        expect(store.version).toBe(0);
    });

    it("keeps what discovery found, readable by a result already assembling", () => {
        const { store } = discovered(project([track("a", slides())]));
        const found = store.trackAssets("a");
        store.dispose();
        expect(store.trackAssets("a")).toBe(found);
    });
});

// ─── Audio: clamped to the clip, owners isolated ──────────────────────────────

describe("ClipStore – audio confined to the clip", () => {
    const audioOf = (clip: CompositionDocument, over: Partial<{ duration: number }> = {}) => {
        const { store } = discovered(project([track("a", clip, over)]));
        const found = store.trackAssets("a")!;
        store.dispose();
        return found;
    };
    const sound = (id: string, props: Record<string, unknown> = {}, span: { startAt?: number; endAt?: number } = {}): TimedNodeSpec =>
        ({ ...node(id, "sound", { src: "a.mp3", ...props }), ...span });

    it("cuts a bounded request that outlasts the clip off where the clip ends", () => {
        const [req] = audioOf(comp([sound("s", {}, { endAt: 3 })], [], 1)).audioRequests;
        expect(req.src).toBe("a.mp3");
        expect(req.endAt).toBeCloseTo(1, 9);
        expect(req.open).toBeFalsy();
    });

    it("leaves a bounded request that fits alone", () => {
        const [req] = audioOf(comp([sound("s", {}, { startAt: 0.2, endAt: 0.6 })], [], 1)).audioRequests;
        expect(req.startAt).toBeCloseTo(0.2, 9);
        expect(req.endAt).toBeCloseTo(0.6, 9);
    });

    it("cuts at the track's own length when the track is shorter than its clip", () => {
        const [req] = audioOf(comp([sound("s", {}, { endAt: 3 })], [], 3), { duration: 0.5 }).audioRequests;
        expect(req.endAt).toBeCloseTo(0.5, 9);
    });

    it("drops a bounded request that starts at or after the clip ends", () => {
        // A sound mounted past the clip's end never mounts; a request placed there by a node that is mounted is what is dropped.
        const { store } = discovered(
            project([track("a", comp([sound("s")], [1, { target: "s", type: "play", args: {}, duration: 1 }], 0.4))]),
            runtimeScope({ assets: catalog() }),
        );
        expect(store.trackAssets("a")!.audioRequests).toEqual([]);
        store.dispose();
    });

    it("lets an open request through unclamped, to be resolved against the project's total", () => {
        const [req] = audioOf(comp([sound("s")], [], 1)).audioRequests;
        expect(req.open).toBe(true);
        expect(req.endAt).toBe(Infinity);
        const [looped] = audioOf(comp([sound("s", { loop: true })], [], 1)).audioRequests;
        expect(looped).toMatchObject({ open: true, loop: true, endAt: Infinity });
    });

    it("confines a bus to the clip, open request or not", () => {
        const clip = comp([node("bus", "audioBus", {}), node("s", "sound", { src: "a.mp3" }, "bus")], [], 1);
        const [req] = audioOf(clip).audioRequests;
        expect(req.open).toBe(true);
        expect(req.bus?.map((stop) => [stop.startAt, stop.endAt])).toEqual([[0, 1]]);
    });

    it("leaves a bus that ends inside the clip as it was", () => {
        const clip = comp([
            { ...node("bus", "audioBus", {}), endAt: 0.5 },
            { ...node("s", "sound", { src: "a.mp3" }, "bus"), endAt: 0.4 },
        ], [], 1);
        const [req] = audioOf(clip).audioRequests;
        expect(req.bus?.map((stop) => stop.endAt)).toEqual([0.5]);
    });

    it("reports a sound that throws against its node, and keeps the sounds beside it", () => {
        const clip = comp([sound("good"), sound("bad", { src: "missing.mp3" })], [], 1);
        const found = audioOf(clip);

        expect(found.audioRequests.map((r) => r.src)).toEqual(["a.mp3"]);
        const { store } = discovered(project([track("a", clip)]));
        const errors = store.errorsOf("a");
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ trackId: "a", nodeId: "bad" });
        expect(errors[0].message).toMatch(/missing\.mp3/);
        store.dispose();
    });

    it("forgets the error once the sound that threw is fixed, in place", () => {
        const make = (src: string) => comp([sound("good"), sound("bad", { src })], [], 1);
        const { store, scope } = discovered(project([track("a", make("missing.mp3"))]));
        expect(store.errorsOf("a")).toHaveLength(1);

        edit(store, scope, project([track("a", make("b.mp3"))]));

        expect(store.errorsOf("a")).toEqual([]);
        expect(store.trackAssets("a")!.audioRequests.map((r) => r.src).sort()).toEqual(["a.mp3", "b.mp3"]);
        store.dispose();
    });
});

// ─── Release, rebuild and trim ────────────────────────────────────────────────

describe("ClipStore.release, rebuild and trim", () => {
    it("release disposes a discovered track's tree and keeps its index, bumping the generation", () => {
        const { store } = discovered(project([track("a", slides())]));
        const instance = store.instanceOf("a")!;
        const dispose = vi.spyOn(instance, "dispose");
        const found = store.trackAssets("a");
        const generation = store.generationOf("a");

        store.release("a");

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(store.instanceOf("a")).toBeNull();
        expect(store.trackAssets("a")).toBe(found);
        expect(store.generationOf("a")).toBeGreaterThan(generation);
        store.dispose();
    });

    it("release leaves a tree alone when the track was never discovered: it holds the only copy of what it built", () => {
        // With refinement off nothing is ever discovered, so nothing may be released.
        const store = new ClipStore(project([track("a", slides())]), runtimeScope({ registry: vocabulary(), assets: catalog() }), { assets: false, audio: false });
        store.ensureBuilt("a");
        const kept = store.instanceOf("a");
        expect(kept).not.toBeNull();

        store.release("a");

        expect(store.instanceOf("a")).toBe(kept);
        store.dispose();
    });

    it("release is harmless twice, and for a track nobody has", () => {
        const { store } = discovered(project([track("a", slides())]));
        store.release("a");
        const generation = store.generationOf("a");
        store.release("a");
        store.release("nobody");

        expect(store.generationOf("a")).toBe(generation);
        expect(store.generationOf("nobody")).toBe(-1);
        store.dispose();
    });

    it("a released track builds again on demand without refining or declaring", () => {
        const { store } = discovered(project([track("a", slides())]));
        store.release("a");

        const again = store.ensureBuilt("a");

        expect(again).not.toBeNull();
        expect(declaredBy).toEqual([]);
        store.dispose();
    });

    it("rebuild disposes the tree and keeps what refinement found", () => {
        const { store } = discovered(project([track("a", slides())]));
        const instance = store.instanceOf("a")!;
        const dispose = vi.spyOn(instance, "dispose");
        const found = store.trackAssets("a");
        const generation = store.generationOf("a");

        store.rebuild("a");

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(store.instanceOf("a")).toBeNull();
        expect(store.trackAssets("a")).toBe(found);
        expect(store.generationOf("a")).toBeGreaterThan(generation);
        store.dispose();
    });

    it("rebuild clears a recorded failure, and the discovery with it, so the next build tries again", () => {
        let attempts = 0;
        class Flaky extends generated(Rect) {
            constructor(props: ConstructorParameters<typeof Rect>[0]) {
                super(props);
                if (++attempts === 1) throw new Error("not this time");
            }
        }
        const registry = new Registry({ nodes: { flaky: Flaky as never } });
        const store = new ClipStore(project([track("a", comp([node("f", "flaky", { width: 10, height: 10 })], [], 1))]), runtimeScope({ registry }));
        store.discover("a");
        expect(store.failed("a")).toBe(true);
        expect(store.errorsOf("a")[0].message).toBe("not this time");
        const version = store.version;

        store.rebuild("a");

        expect(store.failed("a")).toBe(false);
        expect(store.isDiscovered("a")).toBe(false);
        expect(store.version).toBeGreaterThan(version);
        expect(store.ensureBuilt("a")).not.toBeNull();
        expect(attempts).toBe(2);
        store.dispose();
    });

    it("trim releases a track wholly outside the horizon and keeps one touching its edge", () => {
        // a: 0..29, b: 30..59, c: 60..89.
        const { store } = discovered(project([
            track("a", slides()), track("b", slides(), { startAt: 3 }), track("c", slides(), { startAt: 6 }),
        ]));

        // From frame 45, a horizon of 15 reaches 30..60: b is inside, c's first frame touches, a's last is 29.
        store.trim(45, 15);

        expect(store.instanceOf("a")).toBeNull();
        expect(store.instanceOf("b")).not.toBeNull();
        expect(store.instanceOf("c")).not.toBeNull();
        store.dispose();
    });

    it("trim keeps a track that merely overlaps the horizon", () => {
        const { store } = discovered(project([track("a", slides()), track("b", slides(), { startAt: 3 })]));

        store.trim(29, 0);

        expect(store.instanceOf("a")).not.toBeNull();
        expect(store.instanceOf("b")).toBeNull();
        store.dispose();
    });

    it("trim releases nothing for a horizon that reaches every track", () => {
        const { store } = discovered(project([track("a", slides()), track("b", slides(), { startAt: 3 })]));

        store.trim(0, 1000);

        expect(store.instanceOf("a")).not.toBeNull();
        expect(store.instanceOf("b")).not.toBeNull();
        store.dispose();
    });
});

// ─── Layout gates ─────────────────────────────────────────────────────────────

describe("ClipStore.settleGates", () => {
    /** A text that measures its face but declares nothing, so no owner names the face. */
    class QuietText extends generated(Text) {
        override declareAssets(): void { }
    }

    function gatedStore(options: { ready: Set<string>; families?: string[]; quiet?: boolean }) {
        const { registry, constructed } = countingRegistry();
        registry.addNode("quiet", QuietText as never);
        const families = options.families ?? ["Inter"];
        const doc = project([track("a", comp(
            families.map((family, i) => node(`t${i}`, options.quiet ? "quiet" : "text", { text: "hello", fontFamily: family, fontSize: 10 })),
            [], 1,
        ))]);
        const store = new ClipStore(doc, runtimeScope({ registry }), { isReady: (key) => options.ready.has(key) });
        store.discover("a");
        return { store, constructed, ready: options.ready };
    }

    it("does nothing while no face has arrived", () => {
        const { store, constructed } = gatedStore({ ready: new Set() });
        const built = constructed.length;

        expect(store.settleGates(["a"])).toBe(false);
        expect(constructed).toHaveLength(built);
        store.dispose();
    });

    it("rebuilds the track once its measured face arrives, and then not again", () => {
        const { store, constructed, ready } = gatedStore({ ready: new Set() });
        const built = constructed.length;
        ready.add("Inter");

        expect(store.settleGates(["a"])).toBe(true);
        expect(constructed.length).toBeGreaterThan(built);
        const after = constructed.length;

        expect(store.settleGates(["a"])).toBe(false);
        expect(constructed).toHaveLength(after);
        store.dispose();
    });

    it("drops a measured face no owner declared, rather than waiting on it for ever", () => {
        const { store, constructed, ready } = gatedStore({ ready: new Set(), quiet: true });
        const built = constructed.length;
        expect(store.layoutGates("a")).toEqual([]);

        // It would be a rebuild if the face counted; nothing declared it, so it does not.
        ready.add("Inter");
        expect(store.settleGates(["a"])).toBe(false);
        expect(constructed).toHaveLength(built);
        store.dispose();
    });

    it("does nothing without a way to ask whether a face is resident", () => {
        const { registry, constructed } = countingRegistry();
        const doc = project([track("a", comp([node("t", "text", { text: "hi", fontFamily: "Inter", fontSize: 10 })], [], 1))]);
        const store = new ClipStore(doc, runtimeScope({ registry }));
        store.discover("a");
        const built = constructed.length;

        expect(store.settleGates(["a"])).toBe(false);
        expect(constructed).toHaveLength(built);
        store.dispose();
    });

    it("waits for a track that is not on screen until it is asked about", () => {
        const { registry, constructed } = countingRegistry();
        const clip = (id: string) => comp([node(id, "text", { text: "hi", fontFamily: "Inter", fontSize: 10 })], [], 1);
        const ready = new Set<string>();
        const doc = project([track("a", clip("ta")), track("b", clip("tb"), { startAt: 1 })]);
        const store = new ClipStore(doc, runtimeScope({ registry }), { isReady: (key) => ready.has(key) });
        store.discover("a");
        store.discover("b");
        ready.add("Inter");
        const built = constructed.length;

        // Only a is on screen.
        expect(store.settleGates(["a"])).toBe(true);
        expect(constructed.slice(built)).toEqual(["ta"]);

        // b's gate arrived all the while; it rebuilds when it is asked about.
        expect(store.settleGates(["b"])).toBe(true);
        expect(constructed.slice(built)).toEqual(["ta", "tb"]);
        store.dispose();
    });

    it("waits for a second unready face that the rebuild itself measured", () => {
        const { store, constructed, ready } = gatedStore({ ready: new Set(), families: ["Inter", "Mono"] });
        ready.add("Inter");

        // Inter arrives: rebuild. That compile measures Mono, still absent.
        expect(store.settleGates(["a"])).toBe(true);
        const after = constructed.length;
        expect(store.settleGates(["a"])).toBe(false);
        expect(constructed).toHaveLength(after);

        // Mono arrives: one more rebuild, and then it is settled.
        ready.add("Mono");
        expect(store.settleGates(["a"])).toBe(true);
        expect(store.settleGates(["a"])).toBe(false);
        store.dispose();
    });

    it("skips a track it does not have, and an empty list", () => {
        const { store } = gatedStore({ ready: new Set(["Inter"]) });
        expect(store.settleGates(["nobody"])).toBe(false);
        expect(store.settleGates([])).toBe(false);
        store.dispose();
    });
});
