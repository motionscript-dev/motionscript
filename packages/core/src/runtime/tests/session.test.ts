import { afterEach, describe, expect, it } from "vitest";

import { AssetManifest } from "@/assets/manifest";
import { Fills } from "@/attributes/shape/fill/chain";
import { setTheme } from "@/attributes/shape/fill/color/parser";
import { node as declareNode } from "@/document/node-decorator";
import type { ProjectDocument } from "@/document/project";
import type { StillDocument } from "@/document/types";
import { Node2D } from "@/components/trees/2d/node2d";
import { AudioSink } from "@/platform/audio-sink";
import { Ticker } from "@/platform/ticker";
import { StorageAdapter } from "@/platform/storage-adapter";
import { MeasureContext2D } from "@/render/measure-context";
import {
    ExportStillRequest,
    ExportVideoRequest,
    ExportedStill,
    Exporter,
} from "@/platform/exporter";
import { Engine, EngineRenderContext, EnginePlatform } from "../engine";
import { FPS, VIEWPORT, comp, node, project, still, track } from "../document.fixtures";
import {
    FakeAudioSink,
    FakeClock,
    FakeMeasureContext,
    FakeRenderContext,
    FakeStorageAdapter,
    asStorage,
} from "../runtime.fixtures";

/** Records every request the session hands it, so a test can assert on the ask. */
class RecordingExporter implements Exporter {
    videoRequests: ExportVideoRequest[] = [];
    stillRequests: ExportStillRequest[] = [];

    exportVideo(request: ExportVideoRequest): Promise<Uint8Array | void> {
        this.videoRequests.push(request);
        return Promise.resolve(new Uint8Array([1, 2, 3]));
    }

    exportStill(request: ExportStillRequest): Promise<ExportedStill> {
        this.stillRequests.push(request);
        return Promise.resolve({ bytes: new Uint8Array([4]), frame: 0, totalFrames: 1 });
    }
}

/** A surface that records what it was mounted with, over a render pass that paints nothing. */
class FakeSurface extends FakeRenderContext {
    mounted: unknown[] = [];
    unmountCount = 0;
    disposeCount = 0;
    pixelRatio = 1;
    view = { zoom: 1, x: 0, y: 0 };
    frame: { width: number; height: number } | null = null;
    clipToFrame = true;
    frameBackground: "black" | "transparent" = "black";

    mount(target: unknown): void { this.mounted.push(target); }
    override unmount(): void { this.unmountCount++; }
    override dispose(): void {
        this.disposeCount++;
        super.dispose();
    }
}

/** An audio device that also remembers the mute switch. */
class MutableAudioSink extends FakeAudioSink {
    mutedCalls: boolean[] = [];
    override setMuted(muted: boolean): void { this.mutedCalls.push(muted); }
}

interface Harness {
    engine: Engine;
    exporter: RecordingExporter;
    surfaces: FakeSurface[];
    storages: FakeStorageAdapter[];
    clocks: FakeClock[];
    audios: MutableAudioSink[];
}

function harness(options: { withClock?: boolean } = {}): Harness {
    const exporter = new RecordingExporter();
    const surfaces: FakeSurface[] = [];
    const storages: FakeStorageAdapter[] = [];
    const clocks: FakeClock[] = [];
    const audios: MutableAudioSink[] = [];
    const withClock = options.withClock ?? true;

    const platform: EnginePlatform = {
        createStorageAdapter(): StorageAdapter {
            const storage = new FakeStorageAdapter();
            storages.push(storage);
            return asStorage(storage);
        },
        createRenderContext(): EngineRenderContext {
            const surface = new FakeSurface();
            surfaces.push(surface);
            return surface;
        },
        createMeasureContext(): MeasureContext2D {
            return new FakeMeasureContext();
        },
        createAudioSink(): AudioSink {
            const sink = new MutableAudioSink();
            audios.push(sink);
            return sink;
        },
        createTicker(): Ticker | null {
            if (!withClock) return null;
            const clock = new FakeClock();
            clocks.push(clock);
            return clock;
        },
        createExporter(): Exporter {
            return exporter;
        },
    };

    return { engine: new Engine(platform), exporter, surfaces, storages, clocks, audios };
}

/** A box held for `seconds`, so a session has frames to seek through. */
const clip = (seconds = 1) => comp([node("box", "rect", { width: 10, height: 10 })], [seconds]);

const doc = (over: Partial<ProjectDocument> = {}) => project([track("a", clip())], over);

const header = (fontSize: number) => ({ typography: { header: { fontSize } } });

const title = comp([node("title", "text", { text: "hi", variant: "header" })], [1]);

/** A project whose only node is a `header` title, under `theme`. The same clip every call, so only the theme can rebuild it. */
const titled = (theme: ProjectDocument["theme"]) => project([track("a", title)], { theme });

describe("Session", () => {
    afterEach(() => setTheme());

    it("takes viewport and fps from the project, over the engine's defaults", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });

        expect(session.viewport).toEqual(VIEWPORT);
        expect(session.fps).toBe(FPS);
        session.dispose();
    });

    it("falls back to the engine's defaults when the document carries none", () => {
        const { engine } = harness();
        const session = engine.open({ document: clip() });

        expect(session.viewport).toEqual({ width: 1920, height: 1080 });
        expect(session.fps).toBe(60);
        session.dispose();
    });

    it("lets the source's viewport and fps win over the document's own", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc(), viewport: { width: 320, height: 180 }, fps: 24 });

        expect(session.viewport).toEqual({ width: 320, height: 180 });
        expect(session.fps).toBe(24);
        expect(session.document).toMatchObject({ viewport: { width: 320, height: 180 }, fps: 24 });
        session.dispose();
    });

    it("opens a lone composition as the one track of a project around it", () => {
        const { engine } = harness();
        const lone = clip();
        const session = engine.open({ document: lone });

        expect(session.document.kind).toBe("project");
        expect(session.document.tracks).toHaveLength(1);
        expect(session.document.tracks[0]).toMatchObject({ clip: lone, duration: 1 });
        expect(session.totalFrames).toBe(60);
        session.dispose();
    });

    it("opens a lone still as the one track of a project, carrying its theme", () => {
        const { engine } = harness();
        const lone: StillDocument = { ...still(node("box", "rect", { width: 10, height: 10 })), theme: header(96) };
        const session = engine.open({ document: lone });

        expect(session.document.tracks.map(t => t.clip)).toEqual([lone]);
        expect(session.document.theme).toEqual(header(96));
        session.dispose();
    });

    it("mounts the target it is given, and only when given one", () => {
        const { engine, surfaces } = harness();
        const target = { marker: "canvas" };

        const mounted = engine.open({ document: doc(), target });
        expect(surfaces[0].mounted).toEqual([target]);

        const unmounted = engine.open({ document: doc() });
        expect(surfaces[1].mounted).toEqual([]);

        mounted.dispose();
        unmounted.dispose();
    });

    it("opens a project with no tracks yet as an empty, zero-length session", () => {
        const { engine } = harness();
        const session = engine.open({ document: project([]) });

        expect(session.document.tracks).toEqual([]);
        expect(session.totalFrames).toBe(0);
        session.dispose();
    });

    it("applies the document's theme before its first frame", async () => {
        const { engine } = harness();
        const session = engine.open({ document: titled(header(96)) });

        await session.seekFrame(0);
        expect(session.controller.getNodePropsAt("0")).toMatchObject({ fontSize: 96 });
        session.dispose();
    });

    it("hands the exporter the project it plays and the engine's registry", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });

        await session.export({ scale: 2 });
        const request = exporter.videoRequests[0];

        expect(request.project).toBe(session.document);
        expect(request.project).toMatchObject({ viewport: VIEWPORT, fps: FPS });
        expect(request.registry).toBe(engine._registry);
        expect(request.manifest).toBe(engine.manifest);
        expect(request.scale).toBe(2);
        session.dispose();
    });

    it("hands the exporter a lone document as the resolved project around it", async () => {
        const { engine, exporter } = harness();
        const lone = clip();
        const session = engine.open({ document: lone });

        await session.export();
        const { project: exported } = exporter.videoRequests[0];

        expect(exported.tracks.map(t => t.clip)).toEqual([lone]);
        expect(exported).toMatchObject({ viewport: { width: 1920, height: 1080 }, fps: 60 });
        session.dispose();
    });

    it("defaults a still to the last frame", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });

        await session.image();
        const request = exporter.stillRequests[0];

        expect(request.frame).toEqual({ kind: "last" });
        expect(request.project).toBe(session.document);
        expect(request.registry).toBe(engine._registry);
        session.dispose();
    });

    it("exposes no playback when the platform has no clock", () => {
        const { engine } = harness({ withClock: false });
        const session = engine.open({ document: doc() });

        expect(session.playback).toBeNull();
        session.dispose();
    });

    it("still seeks and inspects without a realtime clock", async () => {
        const { engine } = harness({ withClock: false });
        const session = engine.open({ document: doc() });

        // No transport, but everything that is not transport still works — the
        // point of standing a `SteppedClock` in rather than leaving it null.
        expect(session.playback).toBeNull();
        expect(session.controller).toBeDefined();
        await expect(session.seekFrame(0)).resolves.toBeUndefined();
        expect(session.controller.getNodePropsAt("0")).toMatchObject({ width: 10 });
        session.dispose();
    });

    it("exposes playback when the platform has a clock", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });

        expect(session.playback).not.toBeNull();
        expect(session.playback!.isPlaying).toBe(false);
        session.dispose();
    });

    it("replaces what plays on the surface it already has", async () => {
        const { engine, surfaces } = harness();
        const session = engine.open({ document: doc() });
        const longer = clip(2);

        session.replace(project([track("a", longer)]));
        await session.controller.whenReplaced();

        expect(session.document.tracks[0].clip).toBe(longer);
        expect(session.totalFrames).toBe(20);
        expect(surfaces).toHaveLength(1);
        expect(surfaces[0].disposeCount).toBe(0);
        session.dispose();
    });

    // A lone document's output settings fall back to the session's, not the
    // engine's — otherwise every lone replace on a non-default session would throw.
    it("replaces with a lone document at the session's own fps and viewport", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });
        const lone = clip();

        session.replace(lone);

        expect(session.document).toMatchObject({ viewport: VIEWPORT, fps: FPS });
        expect(session.document.tracks[0].clip).toBe(lone);
        session.dispose();
    });

    it("refuses to replace with a document at a different fps", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });
        const before = session.document;

        expect(() => session.replace(doc({ fps: FPS * 2 }))).toThrow(/open a new session/);
        expect(session.document).toBe(before);
        session.dispose();
    });

    // `replace` resolved with no override, so a session opened at 24 fps over a
    // 60 fps document refused to take back the very document it was playing.
    it("keeps the open-time fps and viewport when replacing", () => {
        const { engine } = harness();
        const own = doc({ fps: FPS * 2, viewport: { width: 400, height: 100 } });
        const session = engine.open({ document: own, fps: FPS, viewport: VIEWPORT });

        expect(() => session.replace(own)).not.toThrow();
        expect(session.document).toMatchObject({ fps: FPS, viewport: VIEWPORT });
        // The host's settings win over the next document's own, as they do at open.
        expect(() => session.replace(doc({ fps: 30 }))).not.toThrow();
        expect(session.document.fps).toBe(FPS);
        session.dispose();
    });

    it("refuses to replace with a document at a different viewport", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });
        const before = session.document;

        expect(() => session.replace(doc({ viewport: { width: 400, height: 100 } }))).toThrow(/open a new session/);
        expect(session.document).toBe(before);
        session.dispose();
    });

    it("applies the replacing document's theme", async () => {
        const { engine } = harness();
        const session = engine.open({ document: titled(header(96)) });
        await session.seekFrame(0);

        session.replace(titled(header(48)));
        await session.controller.whenReplaced();

        expect(session.controller.getNodePropsAt("0")).toMatchObject({ fontSize: 48 });
        session.dispose();
    });

    it("disposes its surface with it", () => {
        const { engine, surfaces } = harness();
        engine.open({ document: doc() }).dispose();

        expect(surfaces[0].disposeCount).toBe(1);
    });
});

class RegisteredElsewhereBox extends Node2D { }
declareNode("registered-elsewhere-box")(RegisteredElsewhereBox);

/** An identity `compile` — the source below is already plain CommonJS. */
function dynamicNodesConfig() {
    return { sdk: { Node2D, node: declareNode }, compile: async (source: string) => source };
}

const dynamicBlobSource = `
    const { Node2D, node } = require("motion-script");
    class Blob extends Node2D {}
    node("dynamic-blob")(Blob);
    module.exports.default = Blob;
`;

describe("Engine", () => {
    it("seeds the builtin vocabulary from its constructor", () => {
        const { engine } = harness();
        // Nothing in this file registered anything: a `Registry` seeds itself.
        expect(engine.knows("rect")).toBe(true);
        expect(engine.knows("no-such-node-type")).toBe(false);
    });

    it("does not know the pattern nodes, which `@motionscript/patterns` registers", () => {
        const { engine } = harness();
        for (const key of ["line-grid", "lineGridPattern", "dotGridPattern", "gridPattern"]) {
            expect(engine.knows(key)).toBe(false);
        }
    });

    // What registering a pack on the engine buys: a document can name
    // `"shaderLab.prism"` from a plain rect, with no node that knows the pack.
    // The node that draws it passes the object directly and never needed this.
    it("registers shader packs given as plain JSON", () => {
        const pack = {
            $kind: "motionscript/shader@1",
            id: "test.stripes",
            scope: "fill",
            name: "Stripes",
            source: "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }",
            properties: {},
        };

        const platform = harness().engine.platform;
        const engine = new Engine(platform, { shaders: { "test.stripes": pack } });

        expect(engine._registry.shaderKeys()).toContain("test.stripes");
        expect(engine._registry.fillShader("test.stripes")?.name).toBe("Stripes");
        // And nowhere else: a second engine has its own vocabulary.
        expect(new Engine(platform)._registry.shaderKeys()).not.toContain("test.stripes");
    });

    it("reaches live sessions when the manifest is swapped", () => {
        const { engine, storages } = harness();
        const session = engine.open({ document: doc() });

        const next: AssetManifest = {
            image: { "a.png": { src: "a.png", width: 1, height: 1, sizeBytes: 1 } },
            video: {}, audio: {}, font: {},
        };
        engine.setManifest(next);

        expect(engine.manifest).toBe(next);
        expect(storages[0].setCatalogCalls).toHaveLength(1);
        session.dispose();
    });

    // The session handed the new catalog to its storage adapter only; the
    // controller, its clip store and every node's `assets` kept the old one, so a
    // clip needing an entry added after open went on failing to build.
    it("reaches the catalog the controller builds clips against", async () => {
        const { engine } = harness();
        const needsImage = project([track("a", still(node("pic", "rect", { width: 10, height: 10, fill: Fills.image("a.png") })))]);
        const session = engine.open({ document: needsImage });
        await session.seekFrame(0);
        expect(session.controller.buildErrors.map((e) => e.message).join("\n")).toMatch(/Image asset not found: "a\.png"/);

        engine.setManifest({
            image: { "a.png": { src: "a.png", width: 4, height: 4, sizeBytes: 1 } },
            video: {}, audio: {}, font: {},
        });
        await session.controller.whenReplaced();

        expect(session.controller.buildErrors).toEqual([]);
        session.dispose();
    });

    it("stops notifying a disposed session", () => {
        const { engine, storages } = harness();
        const session = engine.open({ document: doc() });
        session.dispose();

        // Would throw if the disposed session's listener still ran against its
        // torn-down storage adapter.
        expect(() => engine.setManifest({ image: {}, video: {}, audio: {}, font: {} })).not.toThrow();
        expect(storages[0].setCatalogCalls).toHaveLength(0);
    });

    it("exposes its registry read-only, for introspection — the same live instance as _registry", () => {
        const { engine } = harness();
        expect(engine.registry).toBe(engine._registry);
        expect(engine.registry.node("rect")?.commands.get("fadeTo")?.args).toEqual([
            { key: "opacity", kind: "unknown" },
        ]);
    });
});

describe("Engine.registerNode / registerShader", () => {
    it("registers a class synchronously-fast, through the async signature", async () => {
        const platform = harness().engine.platform;
        const engine = new Engine(platform);

        const ctor = await engine.registerNode(RegisteredElsewhereBox);
        expect(ctor).toBe(RegisteredElsewhereBox);
        expect(engine.knows("registered-elsewhere-box")).toBe(true);
    });

    it("registers a source string, compiled through the configured dynamicNodes", async () => {
        const platform = harness().engine.platform;
        const engine = new Engine(platform, { dynamicNodes: dynamicNodesConfig() });

        const ctor = await engine.registerNode(dynamicBlobSource);
        expect(engine.knows("dynamic-blob")).toBe(true);
        expect(new (ctor as unknown as new () => object)()).toBeInstanceOf(Node2D);
    });

    it("a later registerNode call works even when no string was passed at construction", async () => {
        const platform = harness().engine.platform;
        // dynamicNodes IS configured (mirrors createBrowserEngine's revised,
        // unconditional attachment), but no string was in `nodes` at boot.
        const engine = new Engine(platform, { dynamicNodes: dynamicNodesConfig() });

        expect(engine.knows("dynamic-blob")).toBe(false);
        await engine.registerNode(dynamicBlobSource);
        expect(engine.knows("dynamic-blob")).toBe(true);
    });

    it("registerShader mirrors Registry.addShader, key explicit, replace opt-in", () => {
        const platform = harness().engine.platform;
        const engine = new Engine(platform);
        const stripes = { scope: "fill" as const, name: "Stripes", source: "fn fill(in: FillIn) -> vec4f { return vec4f(1.0); }" };
        const dots = { scope: "fill" as const, name: "Dots", source: "fn fill(in: FillIn) -> vec4f { return vec4f(0.0); }" };

        engine.registerShader("test.pack", stripes);
        expect(() => engine.registerShader("test.pack", dots)).toThrow(/already registered to a different pack/);
        engine.registerShader("test.pack", dots, { replace: true });
        expect(engine._registry.shader("test.pack")?.name).toBe("Dots");
    });
});

// ─── Engine options and lifecycle ─────────────────────────────────────────────

/** A platform that records its disposal, over the same fakes the harness uses. */
function disposablePlatform() {
    const base = harness().engine.platform;
    let disposals = 0;
    const platform: EnginePlatform = { ...base, dispose: () => { disposals++; } };
    return { platform, disposals: () => disposals };
}

describe("Engine options", () => {
    it("takes node classes as an array of declared classes, each under the key it declared", () => {
        const engine = new Engine(harness().engine.platform, { nodes: [RegisteredElsewhereBox] });
        expect(engine.knows("registered-elsewhere-box")).toBe(true);
    });

    it("takes node classes as a record naming each key outright", () => {
        class Plain extends Node2D { }
        const engine = new Engine(harness().engine.platform, { nodes: { "my-plain": Plain as never } });

        expect(engine.knows("my-plain")).toBe(true);
        expect(engine.registry.node("my-plain")?.ctor).toBe(Plain);
        // The builtin vocabulary stays.
        expect(engine.knows("rect")).toBe(true);
    });

    it("keeps one engine's node types out of another's", () => {
        const platform = harness().engine.platform;
        const withBox = new Engine(platform, { nodes: [RegisteredElsewhereBox] });
        expect(withBox.knows("registered-elsewhere-box")).toBe(true);
        expect(new Engine(platform).knows("registered-elsewhere-box")).toBe(false);
    });

    it("registers the interpolations a document may name in a variable's lerp", () => {
        const doubled = (from: unknown, to: unknown, t: number) => (from as number) + ((to as number) - (from as number)) * Math.min(1, t * 2);
        const engine = new Engine(harness().engine.platform, { lerps: { doubled } });

        expect(engine.registry.lerp("doubled")).toBe(doubled);
        expect(engine.registry.lerpKeys()).toContain("doubled");
        expect(new Engine(harness().engine.platform).registry.lerp("doubled")).toBeUndefined();
    });

    it("compiles a document that names a registered lerp, and reports one that names a missing lerp", async () => {
        const lerpDoc = () => ({
            ...comp([node("box", "rect", { width: "=[g]", height: 10 })], [], 2),
            variables: [{ id: "g", value: 0, lerp: "doubled" }],
            commands: [{ id: "up", type: "variableTo", targetId: "g", at: 0, duration: 1, args: { value: 100 } }],
        });
        const doubled = (from: unknown, to: unknown, t: number) => (from as number) + ((to as number) - (from as number)) * Math.min(1, t * 2);
        const platform = harness().engine.platform;

        const known = new Engine(platform, { lerps: { doubled } }).open({ document: lerpDoc(), fps: FPS });
        await known.seekFrame(5);
        // Halfway through, the doubled lerp is already at the end.
        expect(known.controller.getNodePropsAt("0")).toMatchObject({ width: 100 });
        expect(known.controller.buildErrors).toEqual([]);
        known.dispose();

        const unknown = new Engine(platform).open({ document: lerpDoc(), fps: FPS });
        await unknown.seekFrame(5);
        expect(unknown.controller.buildErrors.map((e) => e.message).join("\n")).toMatch(/doubled/);
        unknown.dispose();
    });

    it("opens sessions against the manifest it was given, which the engine reports as its own", async () => {
        const manifest: AssetManifest = {
            image: { "a.png": { src: "a.png", width: 4, height: 4, sizeBytes: 1 } },
            video: {}, audio: {}, font: {},
        };
        const needsImage = still(node("pic", "rect", { width: 10, height: 10, fill: Fills.image("a.png") }));
        const platform = harness().engine.platform;

        const engine = new Engine(platform, { manifest });
        expect(engine.manifest).toBe(manifest);
        const session = engine.open({ document: needsImage });
        await session.seekFrame(0);
        expect(session.controller.buildErrors).toEqual([]);
        session.dispose();

        const bare = new Engine(platform).open({ document: needsImage });
        await bare.seekFrame(0);
        expect(bare.controller.buildErrors.map((e) => e.message).join("\n")).toMatch(/Image asset not found: "a\.png"/);
        bare.dispose();
    });

    it("starts with an empty manifest when none is given", () => {
        const engine = new Engine(harness().engine.platform);
        expect(engine.manifest).toEqual({ image: {}, video: {}, audio: {}, font: {} });
    });

    it("uses its viewport and fps for a document that carries neither", () => {
        const engine = new Engine(harness().engine.platform, { viewport: { width: 640, height: 360 }, fps: 24 });
        expect(engine.viewport).toEqual({ width: 640, height: 360 });
        expect(engine.fps).toBe(24);

        const session = engine.open({ document: clip() });
        expect(session.viewport).toEqual({ width: 640, height: 360 });
        expect(session.fps).toBe(24);
        // One second at 24 fps.
        expect(session.totalFrames).toBe(24);
        session.dispose();
    });

    it("lets a project's own viewport and fps win over the engine's", () => {
        const engine = new Engine(harness().engine.platform, { viewport: { width: 640, height: 360 }, fps: 24 });
        const session = engine.open({ document: doc() });
        expect(session.viewport).toEqual(VIEWPORT);
        expect(session.fps).toBe(FPS);
        session.dispose();
    });

    it("defaults to 1920x1080 at 60 fps", () => {
        const engine = new Engine(harness().engine.platform);
        expect(engine.viewport).toEqual({ width: 1920, height: 1080 });
        expect(engine.fps).toBe(60);
    });
});

describe("Engine.dispose", () => {
    it("disposes the platform it was built over", () => {
        const { platform, disposals } = disposablePlatform();
        const engine = new Engine(platform);

        expect(disposals()).toBe(0);
        engine.dispose();
        expect(disposals()).toBe(1);
    });

    it("disposes a platform that has nothing to dispose", () => {
        expect(() => new Engine(harness().engine.platform).dispose()).not.toThrow();
    });

    it("stops telling sessions about a new manifest", () => {
        const { platform } = disposablePlatform();
        const storages: FakeStorageAdapter[] = [];
        const wrapped: EnginePlatform = {
            ...platform,
            createStorageAdapter: () => {
                const storage = new FakeStorageAdapter();
                storages.push(storage);
                return asStorage(storage);
            },
        };
        const engine = new Engine(wrapped);
        const session = engine.open({ document: doc() });

        engine.dispose();
        engine.setManifest({ image: {}, video: {}, audio: {}, font: {} });

        expect(storages[0].setCatalogCalls).toHaveLength(0);
        session.dispose();
    });

    it("still reports the manifest it was last given, so a late reader is not left with nothing", () => {
        const engine = new Engine(harness().engine.platform);
        const manifest: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };
        engine.setManifest(manifest);
        engine.dispose();
        expect(engine.manifest).toBe(manifest);
    });
});

// ─── Session accessors and lifecycle ──────────────────────────────────────────

describe("Session.seek", () => {
    const frameAfter = async (seconds: number): Promise<number> => {
        const { engine } = harness();
        const session = engine.open({ document: project([track("a", clip(2))]) });
        await session.seek(seconds);
        const frame = session.playback!.frame;
        session.dispose();
        return frame;
    };

    it("moves the playhead to the frame the time falls on", async () => {
        expect(await frameAfter(0)).toBe(0);
        expect(await frameAfter(0.5)).toBe(5);
        expect(await frameAfter(1)).toBe(10);
    });

    it("rounds a time between frames to the nearest, halves up", async () => {
        // The fixture runs at 10 fps.
        expect(await frameAfter(0.34)).toBe(3);
        expect(await frameAfter(0.36)).toBe(4);
        expect(await frameAfter(0.35)).toBe(4);
        expect(await frameAfter(0.25)).toBe(3);
    });

    it("lands a time within float error of a frame on that frame, not one short", async () => {
        // 0.3 s at 10 fps multiplies out a hair off 3.
        expect(await frameAfter(0.1 + 0.2)).toBe(3);
    });

    it("clamps a time past the end to the last frame position and one before the start to the first", async () => {
        expect(await frameAfter(-5)).toBe(0);
        expect(await frameAfter(500)).toBe(20);
    });

    it("draws the frame it lands on", async () => {
        const { engine, surfaces } = harness();
        const session = engine.open({ document: doc() });
        const before = surfaces[0].renderCount;

        await session.seek(0.5);

        expect(surfaces[0].renderCount).toBeGreaterThan(before);
        session.dispose();
    });
});

describe("Session accessors", () => {
    it("surface is the render context the platform made for it", () => {
        const { engine, surfaces } = harness();
        const session = engine.open({ document: doc() });
        expect(session.surface).toBe(surfaces[0]);
        session.dispose();
    });

    it("duration and totalFrames follow the furthest track and update when the document does", async () => {
        const { engine } = harness();
        const session = engine.open({ document: project([track("a", clip(1)), track("b", clip(0.5), { startAt: 2 })]) });

        expect(session.duration).toBeCloseTo(2.5, 6);
        expect(session.totalFrames).toBe(25);

        session.replace(project([track("a", clip(3))]));
        await session.controller.whenReplaced();
        expect(session.duration).toBeCloseTo(3, 6);
        expect(session.totalFrames).toBe(30);
        session.dispose();
    });

    it("an empty project has no duration", () => {
        const { engine } = harness();
        const session = engine.open({ document: project([]) });
        expect(session.duration).toBe(0);
        session.dispose();
    });

    it("reports the controller it plays through, the same object each time", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });
        expect(session.controller).toBe(session.controller);
        expect(session.controller.totalFrames).toBe(session.totalFrames);
        session.dispose();
    });
});

describe("Session with an invalid document", () => {
    const invalid = () => project([track("a", clip()), track("a", clip())]);

    it("refuses to open one, naming what is wrong, before it builds a surface", () => {
        const { engine, surfaces, storages } = harness();

        expect(() => engine.open({ document: invalid() })).toThrow(/Invalid project document[\s\S]*duplicate track id "a"/);
        expect(surfaces).toHaveLength(0);
        expect(storages).toHaveLength(0);
    });

    it("refuses an invalid lone output setting the same way", () => {
        const { engine } = harness();
        expect(() => engine.open({ document: clip(), fps: 0 })).toThrow(/fps must be a positive number/);
    });

    it("leaves the open session exactly as it was when a replace is refused", async () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });
        await session.seekFrame(3);
        const before = session.document;
        const frames = session.totalFrames;

        expect(() => session.replace(invalid())).toThrow(/Invalid project document/);

        expect(session.document).toBe(before);
        expect(session.totalFrames).toBe(frames);
        // And it still plays.
        await expect(session.seekFrame(4)).resolves.toBeUndefined();
        expect(session.playback!.frame).toBe(4);
        session.dispose();
    });

    it("does not swap the controller's project when a replace is refused", async () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });
        const spans = session.controller.spans.map((s) => ({ ...s }));

        expect(() => session.replace(invalid())).toThrow();
        await session.controller.whenReplaced();

        expect(session.controller.spans).toEqual(spans);
        session.dispose();
    });
});

describe("Session.dispose", () => {
    it("can be called twice without throwing", () => {
        const { engine } = harness();
        const session = engine.open({ document: doc() });

        session.dispose();
        expect(() => session.dispose()).not.toThrow();
    });

    // `Session.dispose` has no guard of its own: a second call hands the surface a
    // second `dispose`, and a real backend's surface is deleted once. The same holds
    // of `Engine.dispose` and the platform.
    it.skip("disposes its surface once, however many times it is disposed", () => {
        const { engine, surfaces } = harness();
        const session = engine.open({ document: doc() });

        session.dispose();
        session.dispose();

        expect(surfaces[0].disposeCount).toBe(1);
    });

    it.skip("disposes the platform once, however many times the engine is disposed", () => {
        const { platform, disposals } = disposablePlatform();
        const engine = new Engine(platform);

        engine.dispose();
        engine.dispose();

        expect(disposals()).toBe(1);
    });

    it("stops the manifest reaching it after the first call, and again after the second", () => {
        const { engine, storages } = harness();
        const session = engine.open({ document: doc() });
        session.dispose();
        session.dispose();

        engine.setManifest({ image: {}, video: {}, audio: {}, font: {} });
        expect(storages[0].setCatalogCalls).toHaveLength(0);
    });

    it("tears down its clock and audio device", () => {
        const { engine, clocks, audios } = harness();
        const session = engine.open({ document: doc() });

        session.dispose();

        expect(clocks[0].disposeCount).toBe(1);
        expect(audios[0].stopCount).toBeGreaterThanOrEqual(1);
    });

    it("leaves the engine, and any other session on it, working", async () => {
        const { engine } = harness();
        const first = engine.open({ document: doc() });
        const second = engine.open({ document: doc() });

        first.dispose();

        await expect(second.seekFrame(2)).resolves.toBeUndefined();
        second.dispose();
    });
});

describe("Playback through a session", () => {
    const opened = () => {
        const h = harness();
        const session = h.engine.open({ document: project([track("a", clip(2))]) });
        return { ...h, session, playback: session.playback!, clock: h.clocks[0], audio: h.audios[0], storage: h.storages[0] };
    };

    it("starts not playing, at frame 0", () => {
        const { playback, session } = opened();
        expect(playback.isPlaying).toBe(false);
        expect(playback.frame).toBe(0);
        session.dispose();
    });

    it("play starts the clock at the speed and direction asked, and the audio device with it", () => {
        const { playback, clock, audio, storage, session } = opened();

        playback.play(2, true);

        expect(playback.isPlaying).toBe(true);
        expect(clock.isPlaying).toBe(true);
        expect(audio.playCalls).toEqual([{ time: 0, speed: 2, reverse: true }]);
        expect(storage.setPlayingCalls).toEqual([true]);
        session.dispose();
    });

    it("play defaults to normal speed, forwards", () => {
        const { playback, audio, session } = opened();
        playback.play();
        expect(audio.playCalls).toEqual([{ time: 0, speed: 1, reverse: false }]);
        session.dispose();
    });

    it("pause stops the clock, the audio and the adapter's prefetching", () => {
        const { playback, audio, storage, session } = opened();
        playback.play();
        const stopped = audio.stopCount;

        playback.pause();

        expect(playback.isPlaying).toBe(false);
        expect(audio.stopCount).toBe(stopped + 1);
        expect(storage.setPlayingCalls).toEqual([true, false]);
        session.dispose();
    });

    it("frame follows the clock", () => {
        const { playback, clock, session } = opened();
        clock.setTime(1.3);
        expect(playback.frame).toBeCloseTo(13, 9);
        session.dispose();
    });

    it("seekFrame moves the clock without pausing it", () => {
        const { playback, clock, session } = opened();
        playback.play();

        playback.seekFrame(7);

        expect(clock.seekCalls.at(-1)).toBeCloseTo(0.7, 9);
        expect(playback.frame).toBeCloseTo(7, 9);
        expect(playback.isPlaying).toBe(true);
        session.dispose();
    });

    it("seekFrame clamps to the timeline, and does not wait to paint", () => {
        const { playback, clock, surfaces, session } = opened();
        const renders = surfaces[0].renderCount;

        playback.seekFrame(-5);
        expect(clock.seekCalls.at(-1)).toBe(0);
        playback.seekFrame(10_000);
        expect(clock.seekCalls.at(-1)).toBeCloseTo(2, 9);
        expect(surfaces[0].renderCount).toBe(renders);
        session.dispose();
    });

    it("setMuted reaches the audio device", () => {
        const { playback, audio, session } = opened();
        playback.setMuted(true);
        playback.setMuted(false);
        expect(audio.mutedCalls).toEqual([true, false]);
        session.dispose();
    });

    it("onTime hears the playhead as it moves, in seconds", () => {
        const { playback, clock, session } = opened();
        const heard: number[] = [];
        playback.onTime((t) => heard.push(t));

        clock.setTime(0.5);
        clock.setTime(1);

        expect(heard).toEqual([0.5, 1]);
        session.dispose();
    });

    it("onPlay and onPause hear the transport", () => {
        const { playback, session } = opened();
        const events: string[] = [];
        playback.onPlay(() => events.push("play"));
        playback.onPause(() => events.push("pause"));

        playback.play();
        playback.pause();

        expect(events).toEqual(["play", "pause"]);
        session.dispose();
    });

    it("stops hearing anything once the session is disposed", () => {
        const { playback, clock, session } = opened();
        const heard: number[] = [];
        playback.onTime((t) => { heard.push(t); });

        session.dispose();
        clock.setTime(1);

        expect(heard).toEqual([]);
    });
});

describe("Session.image and Session.export options", () => {
    const manifest: AssetManifest = {
        image: { "a.png": { src: "a.png", width: 1, height: 1, sizeBytes: 1 } },
        video: {}, audio: {}, font: {},
    };

    it("lets a manifest passed to image win over the engine's", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });

        await session.image({ manifest });

        expect(exporter.stillRequests[0].manifest).toBe(manifest);
        expect(exporter.stillRequests[0].manifest).not.toBe(engine.manifest);
        session.dispose();
    });

    it("falls back to the engine's manifest, as it is now, not as it was at open", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });
        engine.setManifest(manifest);

        await session.image();

        expect(exporter.stillRequests[0].manifest).toBe(manifest);
        session.dispose();
    });

    it("passes the abort signal, the frame, the scale and the format on to the exporter", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });
        const controller = new AbortController();

        await session.image({ signal: controller.signal, frame: { kind: "first" }, scale: 3, format: "jpeg", quality: 0.5 });

        expect(exporter.stillRequests[0]).toMatchObject({ frame: { kind: "first" }, scale: 3, format: "jpeg", quality: 0.5 });
        expect(exporter.stillRequests[0].signal).toBe(controller.signal);
        session.dispose();
    });

    it("lets a manifest passed to export win over the engine's, and hands over the abort signal and progress callback", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });
        const controller = new AbortController();
        const onProgress = () => { };

        await session.export({ manifest, signal: controller.signal, onProgress, includeAudio: false, encode: { codec: "x" } });

        const request = exporter.videoRequests[0];
        expect(request.manifest).toBe(manifest);
        expect(request.signal).toBe(controller.signal);
        expect(request.onProgress).toBe(onProgress);
        expect(request).toMatchObject({ includeAudio: false, encode: { codec: "x" } });
        session.dispose();
    });

    it("hands the exporter the project as it is after a replace", async () => {
        const { engine, exporter } = harness();
        const session = engine.open({ document: doc() });
        const next = project([track("a", clip(3))]);

        session.replace(next);
        await session.export();

        expect(exporter.videoRequests[0].project).toBe(session.document);
        expect(exporter.videoRequests[0].project.tracks[0].clip).toBe(next.tracks[0].clip);
        session.dispose();
    });
});
