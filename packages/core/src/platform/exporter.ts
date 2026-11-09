import { AssetManifest } from "@/assets/manifest";
import type { ProjectDocument } from "@/document/project";
import type { Registry } from "@/document/registry";
import type { FrameSpec } from "@/runtime/frame-time";
import type { RenderIssue } from "@/render/render-issue";

/**
 * Encoding settings, passed through to whatever the platform's exporter uses.
 *
 * Deliberately `unknown`-shaped rather than a union of every codec option each
 * backend might take: `core` has no opinion about encoders.
 */
export type EncodeOptions = Record<string, unknown>;

/** A run of project frames: `start` included, `end` not. */
export interface FrameRange {
    start: number;
    end: number;
}

/** What an {@link Exporter} needs to encode a timeline. */
export interface ExportVideoRequest {
    /** The project, its fps and viewport resolved — see `Session.document`. Carries its theme. */
    project: ProjectDocument;
    /** The vocabulary its clips compile against: the opening engine's. */
    registry: Registry;
    /** Resolution multiplier on the viewport. Default 1. */
    scale?: number;
    manifest?: AssetManifest;
    includeAudio?: boolean;
    /**
     * Encode only these frames, as a file of their own that starts at 0. It is
     * always silent: a range is one segment of a split export, whose audio is
     * mixed once over the whole timeline.
     */
    frames?: FrameRange;
    /** Progress through the export, in `[0, 1]`. */
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
    /**
     * What the renderer drew but not as the document says, once per kind,
     * feature and node. A lost GPU device fails the export with a
     * `RenderBackendError` instead.
     */
    onIssue?: (issue: RenderIssue) => void;
    encode?: EncodeOptions;
}

/** What an {@link Exporter} needs to encode one frame. */
export interface ExportStillRequest {
    project: ProjectDocument;
    registry: Registry;
    frame: FrameSpec;
    scale?: number;
    manifest?: AssetManifest;
    format?: "png" | "jpeg";
    quality?: number;
    signal?: AbortSignal;
    /**
     * What the renderer drew but not as the document says, once per kind,
     * feature and node. A lost GPU device fails the export with a
     * `RenderBackendError` instead.
     */
    onIssue?: (issue: RenderIssue) => void;
}

export interface ExportedStill {
    bytes: Uint8Array;
    /** The frame actually captured — the request clamped into range. */
    frame: number;
    totalFrames: number;
}

/**
 * How a `Session` turns itself into bytes.
 *
 * A **port**: `core` declares it, a platform implements it, and the dependency
 * runs platform → core like every other seam here — which is what lets
 * `Session.export()` exist in `core` without importing anything that encodes.
 */
export interface Exporter {
    exportVideo(request: ExportVideoRequest): Promise<Uint8Array | void>;
    exportStill(request: ExportStillRequest): Promise<ExportedStill>;
}
