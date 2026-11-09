import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageAdapter, type AssetManifest, type VariableLerp } from "@motionscript/core";
import { component2d } from "@motionscript/core/sdk";
import { node, still } from "./document.fixtures";
import { createBrowserEngine } from "../src/engine";
import { WebAudioSink } from "../src/audio/player";
import { WebTicker } from "../src/ticker";

/**
 * What `createBrowserEngine` hands the core `Engine`, and what each session it
 * opens builds for itself.
 */

const DOCUMENT = still(node("r", "rect", { width: 10, height: 10 }));

const cleanup: Array<() => void> = [];
afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
});

async function make(options: Parameters<typeof createBrowserEngine>[0] = {}) {
    const engine = await createBrowserEngine({ ...options });
    cleanup.push(() => engine.dispose());
    return engine;
}

function open(engine: Awaited<ReturnType<typeof make>>) {
    const session = engine.open({ document: DOCUMENT, viewport: { width: 16, height: 16 }, fps: 10 });
    cleanup.push(() => session.dispose());
    return session;
}

/** A session's collaborators, which the controller holds privately. */
const partsOf = (session: ReturnType<typeof open>) => session.controller as unknown as {
    storageAdapter: StorageAdapter;
    masterClock: WebTicker;
    audioDevice: WebAudioSink;
};

describe("options that belong to the Engine", () => {
    it("forwards the manifest, viewport and frame rate unchanged", async () => {
        const manifest: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

        const engine = await make({ manifest, viewport: { width: 640, height: 360 }, fps: 24 });

        expect(engine.manifest).toBe(manifest);
        expect(engine.viewport).toEqual({ width: 640, height: 360 });
        expect(engine.fps).toBe(24);
    });

    it("adds no defaults of its own: core's 1920×1080 at 60 apply", async () => {
        const engine = await make();

        expect(engine.viewport).toEqual({ width: 1920, height: 1080 });
        expect(engine.fps).toBe(60);
        expect(engine.manifest).toEqual({ image: {}, video: {}, audio: {}, font: {} });
    });

    it("forwards shader packs and variable lerps into the engine's registry", async () => {
        const lerp: VariableLerp = (from, to, t) => ((from as number) * (1 - t)) + ((to as number) * t);
        const engine = await make({
            lerps: { mine: lerp },
            shaders: {
                "test.stripes": {
                    $kind: "motionscript/shader@1",
                    id: "test.stripes",
                    scope: "fill",
                    name: "Stripes",
                    source: "vec4 main(vec2 p) { return vec4(1.0); }",
                    properties: {},
                },
            },
        });

        expect(engine.registry.lerp("mine")).toBe(lerp);
        expect(engine.registry.shaderKeys()).toContain("test.stripes");
        expect(engine.registry.fillShader("test.stripes")?.name).toBe("Stripes");
    });

    it("reads its own options without handing them on: the registry knows nothing of them", async () => {
        const engine = await make({
            compilerWasmUrl: "/not-read.wasm",
            video: { codec: "vp9" },
            audio: { bitrate: 64_000 },
        });

        expect(engine.registry.nodeKeys()).toContain("rect");
        expect(engine.registry.lerp("compilerWasmUrl")).toBeUndefined();
    });

    it("keeps two engines' vocabularies apart", async () => {
        const first = await make({ lerps: { only: (from) => from } });
        const second = await make();

        expect(first.registry.lerp("only")).toBeDefined();
        expect(second.registry.lerp("only")).toBeUndefined();
    });
});

describe("what two sessions on one engine share, and what each owns", () => {
    it("gives each its own storage adapter, render context, audio sink and ticker", async () => {
        const engine = await make();
        const a = open(engine);
        const b = open(engine);

        const [pa, pb] = [partsOf(a), partsOf(b)];
        expect(pa.storageAdapter).toBeInstanceOf(StorageAdapter);
        expect(a.surface).not.toBe(b.surface);
        expect(pa.audioDevice).toBeInstanceOf(WebAudioSink);
        expect(pa.masterClock).toBeInstanceOf(WebTicker);

        expect(pa.storageAdapter).not.toBe(pb.storageAdapter);
        expect(a.surface).not.toBe(b.surface);
        expect(pa.audioDevice).not.toBe(pb.audioDevice);
        expect(pa.masterClock).not.toBe(pb.masterClock);
    });

    it("opens a session without an audio context: the device opens on first play", async () => {
        const engine = await make();
        const made = vi.spyOn(globalThis, "AudioContext");
        const session = open(engine);
        await session.seekFrame(0);

        expect(made).not.toHaveBeenCalled();
        made.mockRestore();
    });

    it("gives each session's ticker its sink's audio context, and each session its own", async () => {
        const engine = await make();
        const a = open(engine);
        const b = open(engine);

        const [pa, pb] = [partsOf(a), partsOf(b)];
        expect(pa.masterClock.getContext()).toBe(pa.audioDevice.getContext());
        expect(pb.masterClock.getContext()).toBe(pb.audioDevice.getContext());
        // One AudioContext per session, since each makes its own sink (016's open question on that).
        expect(pa.audioDevice.getContext()).not.toBe(pb.audioDevice.getContext());
    });

    it("shares one exporter: stills of both come from the one renderer it keeps", async () => {
        const before = [...document.body.querySelectorAll("canvas")];
        const engine = await make();
        const a = open(engine);
        const b = open(engine);

        await a.image();
        await b.image();

        expect([...document.body.querySelectorAll("canvas")].filter((canvas) => !before.includes(canvas))).toHaveLength(1);
    });

    it("shares one registry: a type registered after both opened is built by both", async () => {
        const built: unknown[] = [];
        // Its children builder runs once per node built.
        const Late = component2d({
            key: "engine-options-late",
            children: (state) => {
                built.push(state);
                return [];
            },
        });
        const engine = await make();
        const a = open(engine);
        const b = open(engine);
        await engine.registerNode(Late);
        const late = still(node("l", "engine-options-late", { width: 4, height: 4 }));

        a.replace(late);
        await a.seekFrame(0);
        expect(built).toHaveLength(1);
        b.replace(late);
        await b.seekFrame(0);
        expect(built).toHaveLength(2);
    });


    it("keeps one exporter across engines' sessions but not across engines", async () => {
        const first = await make();
        const second = await make();

        expect(first.exporter).not.toBe(second.exporter);
    });

    it("never gives a session a null clock", async () => {
        const engine = await make();

        expect(open(engine).playback).not.toBeNull();
    });
});
