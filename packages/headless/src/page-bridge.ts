/** The contract between the Node driver and the page, types only in a file neither half's tsconfig must make an exception for (the harness has the DOM lib and no Node types, the driver the reverse). */

export interface ScreenshotRequest {
    /** The document to render, as JSON: a **document is data**, so it crosses the process boundary freely (only *node types* are code, which the entry is bundled for). A string is taken as JSON text, which Playwright carries far faster than an object of thousands of nodes. Omit to render the entry's default project. */
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
    /** Declares the media a scene may name. Fonts above all: `ManifestAssetCatalog` throws for an unknown `src`, so an undeclared face is never fetched, and a browser quietly shapes against a fallback where Node renders nothing: either way the frame is wrong, only one says so. */
    setManifest(manifest: unknown): void;
    screenshot(request: ScreenshotRequest): Promise<ScreenshotResult>;
    exportVideo(request: ExportRequest): Promise<string>;
    /** How many frames the request's document (or the default project) spans. */
    countFrames(request: { document?: unknown }): number;
    /** Join segments without re-encoding, under one audio track mixed over the whole timeline. */
    concatSegments(request: ConcatRequest): Promise<ConcatResult>;
}
