// @motionscript/browser — @motionscript/core in the browser: WebGPU surfaces
// (through @motionscript/renderer), video export, audio playback and clock.

// Lets a host answer for an asset's bytes before the adapter goes to the network (see `asset-bytes.ts`).
export { loadAssetBytes, setAssetByteSource, type AssetByteSource } from "./asset-bytes";
export {
    exportVideo,
    type ExportParams,
    type ExportProgressCallback,
    type VideoEncoderOptions,
    type AudioEncoderOptions,
} from "./exporter";
// Mixes the timeline's audio and encodes it alone, without rendering a frame.
export { exportAudio, NoAudioError, type ExportAudioParams } from "./export-audio";
export {
    EXPORT_FORMATS,
    type ExportFormat,
    type ExportFormatInfo,
    type VideoFormat,
    type AudioFormat,
} from "./formats";
// mediabunny's resolution-aware quality levels, for `ExportParams.video.bitrate` without a direct encoder dependency.
export {
    QUALITY_VERY_LOW,
    QUALITY_LOW,
    QUALITY_MEDIUM,
    QUALITY_HIGH,
    QUALITY_VERY_HIGH,
    type Quality,
} from "mediabunny";
export { exportScreenshot, type ScreenshotParams, type ScreenshotResult, type ScreenshotFormat, type FrameSpec } from "./screenshot";
// Thrown by a still and an export alike for a frame whose every track failed to build.
export { NothingToDrawError } from "./frame-loop";
// Joins separately-encoded MP4s (or WebMs) without re-encoding, which is what makes parallel export worthwhile; see `concat.ts` for the two things a caller must guarantee.
export { concatVideoSegments, createSegmentJoiner, ConcatMismatchError, type ConcatOptions, type SegmentJoiner } from "./concat";
// One export across several renderers: chunks of frames on lanes the run admits
// while they add throughput, joined as they land. See `parallel/export-parallel.ts`.
export { exportVideoParallel, type ParallelExportParams } from "./parallel/export-parallel";
// Experimental: the same export rendered and encoded by a native host process, fed a stream through a host transport. See `native-export.ts`.
export { exportVideoNative, type NativeExportParams, type NativeExportTransport } from "./native-export";
export { localLane, messagePortLane, serveExportLane, type MessagePortLaneOptions } from "./parallel/lanes";
export type { ExportLane, LaneEnvironment, LaneReport, LaneSession, SegmentSpec } from "./parallel/lane";
export type { ExportChunk } from "./parallel/plan";
// Mixes a timeline's audio without rendering a frame: the other half of a split export (AAC cannot be concatenated across pieces). See `mix-timeline-audio.ts`.
export { mixTimelineAudio, type MixTimelineAudioParams } from "./mix-timeline-audio";
// Single frames as a first-class capability: one long-lived renderer that repaints into a host-owned canvas (thumbnails, still previews); `exportScreenshot` is its one-shot wrapper.
export { StillRenderer, createStillRenderer } from "./still";
export type {
    StillRendererOptions,
    RenderStillOptions,
    EncodeStillOptions,
    StillSource,
    FrameRef,
} from "./still";
export { WebAudioSink as WebAudioPlayer } from "./audio/player";
// Mixdown. Also on the `@motionscript/browser/audio` subpath, which is the
// import to prefer — it reaches it without loading the renderer.
export { mixAudio, encodeWav, type MixAudioOptions } from "./audio/mixer";
export { WebTicker } from "./ticker";

export { createBrowserEngine } from "./engine";
export type { BrowserEngineOptions, BrowserEncodeOptions } from "./engine";
export { WebGpuUnavailableError, type RendererWasmOption } from "./renderer";

// The renderer's host-facing surface, so a host needs no second import.
export { isWgpuSupported, onWgpuEvent, ShaderPreview, validateShader, WGSL_PRELUDE } from "@motionscript/renderer";
export type {
    WgpuEvent, ShaderDiagnostic, ShaderField, ShaderPreviewInput, ShaderReport, ShaderScope, ShaderStatus,
} from "@motionscript/renderer";
