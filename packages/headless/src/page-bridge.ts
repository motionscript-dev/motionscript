/**
 * The contract between the Node driver and the page it drives.
 *
 * Types only, in a file neither half's tsconfig has to make an exception for:
 * the harness compiles with the DOM lib and no Node types, the driver with Node
 * types and no DOM, and a shared *type* needs neither.
 */

export interface ScreenshotRequest {
    /**
     * The document to render, as JSON.
     *
     * The usual way in, and the reason the split between this and the entry is
     * worth having: a **document is data**, so it crosses the process boundary
     * freely and a caller can render anything at request time. Only *node types*
     * are code, and code is what the entry is bundled for.
     *
     * A string is taken as the document's JSON text, which Playwright carries
     * into the page far faster than an object of thousands of nodes.
     *
     * Omit to render the entry's own default project.
     */
    document?: unknown;
    frame: number | "first" | "last";
    scale?: number;
    format?: "png" | "jpeg";
}

export interface ScreenshotResult {
    /** Encoded bytes, base64 — Playwright cannot round-trip a `Uint8Array`. */
    base64: string;
    frame: number;
    totalFrames: number;
}

export interface ExportRequest {
    /** See {@link ScreenshotRequest.document}. */
    document?: unknown;
    scale?: number;
    /** Render at this multiple and downsample before encoding. The browser exporter's default is 2. */
    supersample?: number;
    /** Defaults to `'avc'`; an encoder this Chromium lacks falls back to it. */
    codec?: "avc" | "hevc" | "av1" | "vp9";
    /** Bits per second. Defaults to 0.2 bits per pixel per frame of the output. */
    bitrate?: number;
    hardwareAcceleration?: "no-preference" | "prefer-hardware" | "prefer-software";
    /** Set false for a file with no audio track. */
    includeAudio?: boolean;
    /** Only these frames (`end` excluded), timestamped from 0 and silent: one segment of a split export. */
    frames?: { start: number; end: number };
}

export interface ConcatRequest {
    /** The document the segments were rendered from, whose audio is mixed once for the joined file. */
    document?: unknown;
    /** Each segment's MP4, base64, in timeline order. */
    segments: string[];
    includeAudio?: boolean;
}

/** The joined file, or why the segments cannot be joined without re-encoding. */
export type ConcatResult = { base64: string } | { mismatch: string };

/** What the page publishes. Checked by capability, never by version number. */
export interface Bridge {
    projectName: string;
    fps: number;
    /** The default project's track ids, in paint order. */
    listTracks(): string[];
    /**
     * Declare the media a scene may name.
     *
     * Fonts above all: `ManifestAssetCatalog` throws for a `src` it has never
     * heard of, so an undeclared face is never fetched — and unlike Node, where
     * a missing face renders nothing and is obvious, a browser quietly shapes
     * against a fallback. Either way the frame is wrong; only one of them says so.
     */
    setManifest(manifest: unknown): void;
    screenshot(request: ScreenshotRequest): Promise<ScreenshotResult>;
    exportVideo(request: ExportRequest): Promise<string>;
    /** How many frames the request's document (or the default project) spans. */
    countFrames(request: { document?: unknown }): number;
    /** Join segments without re-encoding, under one audio track mixed over the whole timeline. */
    concatSegments(request: ConcatRequest): Promise<ConcatResult>;
}
