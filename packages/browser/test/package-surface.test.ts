import { describe, expect, it } from "vitest";
import * as mediabunny from "mediabunny";
import * as renderer from "@motionscript/renderer";
import * as frameLoop from "../src/frame-loop";
import * as barrel from "../src";
import * as audio from "../src/audio";
import { WebAudioMixer, mixAudio, encodeWav, DEFAULT_SAMPLE_RATE } from "../src/audio/mixer";
import { WebAudioSink } from "../src/audio/player";
import { AudioBusGraph } from "../src/audio/bus-graph";

/**
 * The package's import surface, by name. Types do not
 * exist at run time, so what is held here is the values; the compiler holds the
 * rest.
 */

describe("the root barrel", () => {
    it("exports exactly the values the contract lists", () => {
        expect(Object.keys(barrel).sort()).toEqual([
            "ConcatMismatchError",
            "EXPORT_FORMATS",
            "NoAudioError",
            "NothingToDrawError",
            "QUALITY_HIGH",
            "QUALITY_LOW",
            "QUALITY_MEDIUM",
            "QUALITY_VERY_HIGH",
            "QUALITY_VERY_LOW",
            "ShaderPreview",
            "StillRenderer",
            "WGSL_PRELUDE",
            "WebAudioPlayer",
            "WebGpuUnavailableError",
            "WebTicker",
            "concatVideoSegments",
            "createBrowserEngine",
            "createSegmentJoiner",
            "createStillRenderer",
            "encodeWav",
            "exportAudio",
            "exportScreenshot",
            "exportVideo",
            "exportVideoNative",
            "exportVideoParallel",
            "isWgpuSupported",
            "loadAssetBytes",
            "localLane",
            "messagePortLane",
            "mixAudio",
            "mixTimelineAudio",
            "onWgpuEvent",
            "serveExportLane",
            "setAssetByteSource",
            "validateShader",
        ]);
    });

    it("keeps its internals off it", () => {
        for (const name of [
            "WebExporter",
            "DEFAULT_OUTPUT",
            "loadRenderer",
            "createWgpuRenderer",
            "resolveDynamicNodes",
            "DENIED_GLOBALS",
            "DynamicNodeConfig",
            "motionGraphicsBitrate",
            "toFrameSpec",
            "stillFrameSpec",
            "WebAudioSink",
            "WebAudioMixer",
            "AudioBusGraph",
            "DEFAULT_SAMPLE_RATE",
            "formatSpec",
            "audioTrackSource",
            "ensureAudioEncoder",
        ]) {
            expect(barrel, name).not.toHaveProperty(name);
        }
    });

    it("names the live audio device WebAudioPlayer, and it is the sink", () => {
        expect(barrel.WebAudioPlayer).toBe(WebAudioSink);
    });

    it("re-exports the renderer's and mediabunny's values rather than copies", () => {
        for (const name of ["isWgpuSupported", "onWgpuEvent", "ShaderPreview", "validateShader", "WGSL_PRELUDE"] as const) {
            expect(barrel[name], name).toBe(renderer[name]);
        }
        expect(barrel.NothingToDrawError).toBe(frameLoop.NothingToDrawError);
        for (const level of ["QUALITY_VERY_LOW", "QUALITY_LOW", "QUALITY_MEDIUM", "QUALITY_HIGH", "QUALITY_VERY_HIGH"] as const) {
            expect(barrel[level]).toBe(mediabunny[level]);
        }
    });

    it("exports the engine factory and the function forms of the standalone entry points", () => {
        for (const name of ["createBrowserEngine", "exportVideo", "exportScreenshot", "mixTimelineAudio", "concatVideoSegments", "createStillRenderer", "mixAudio", "encodeWav", "setAssetByteSource"] as const) {
            expect(typeof barrel[name], name).toBe("function");
        }
        for (const name of ["WebTicker", "StillRenderer", "ConcatMismatchError", "WebGpuUnavailableError"] as const) {
            expect(typeof barrel[name], name).toBe("function");
        }
    });
});

describe("the /audio subpath", () => {
    it("exports the mixdown, the live device under both names and the bus graph, and nothing else", () => {
        expect(Object.keys(audio).sort()).toEqual([
            "AudioBusGraph",
            "DEFAULT_SAMPLE_RATE",
            "WebAudioMixer",
            "WebAudioPlayer",
            "WebAudioSink",
            "encodeWav",
            "mixAudio",
        ]);
    });

    it("is the same code the root names, not a copy", () => {
        expect(audio.WebAudioSink).toBe(WebAudioSink);
        expect(audio.WebAudioPlayer).toBe(WebAudioSink);
        expect(audio.mixAudio).toBe(mixAudio);
        expect(audio.encodeWav).toBe(encodeWav);
        expect(audio.WebAudioMixer).toBe(WebAudioMixer);
        expect(audio.AudioBusGraph).toBe(AudioBusGraph);
        expect(audio.DEFAULT_SAMPLE_RATE).toBe(DEFAULT_SAMPLE_RATE);
        expect(barrel.mixAudio).toBe(mixAudio);
        expect(barrel.encodeWav).toBe(encodeWav);
    });
});
