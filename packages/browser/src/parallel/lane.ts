import type { AssetManifest, ProjectDocument, Registry, RenderIssue, Theme } from "@motionscript/core";
import type { RendererWasmOption } from "../renderer";
import type { ResolvedVideoEncoding } from "../exporter";
import type { VideoFormat } from "../formats";
import type { ExportChunk } from "./plan";

/** Everything a lane needs to render chunks of one export: plain data (it crosses a `MessagePort`), with the encoding pinned since differently encoded segments cannot be joined. */
export interface SegmentSpec {
    /** Its fps and viewport resolved. */
    project: ProjectDocument;
    manifest: AssetManifest;
    theme?: Theme;
    scale: number;
    supersample: number;
    format: VideoFormat;
    encoding: ResolvedVideoEncoding;
    /** Passed through untouched to a remote lane's `resolve`, for what only its host knows. */
    host?: unknown;
}

/** A chunk's frames so far, and how its time split between drawing and waiting on the encoder. */
export interface LaneReport {
    frames: number;
    busyMs: number;
    waitMs: number;
    /** Render issues since the lane's last report. */
    issues?: RenderIssue[];
}

/** One lane, open on one export. */
export interface LaneSession {
    /** Render the chunk's frames to a complete, silent segment file. */
    render(chunk: ExportChunk, onReport: (report: LaneReport) => void, signal: AbortSignal): Promise<Uint8Array>;
    close(): void;
}

/** Something that renders chunks: this window, or another realm across a port. */
export interface ExportLane {
    open(spec: SegmentSpec, signal: AbortSignal): Promise<LaneSession>;
}

/** What a realm renders with: its own registry, and where its renderer's WASM is served. */
export interface LaneEnvironment extends RendererWasmOption {
    registry?: Registry;
}
