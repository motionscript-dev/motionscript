import {
    DEFAULT_OUTPUT, resolveProjectDocument,
    type AssetManifest, type FrameSpec, type ProjectDocument, type Registry, type VisualDocument, type Size2D, type Theme,
} from "@motionscript/core";
import type { ScreenshotFormat } from "./frame-loop";
import type { RendererWasmOption } from "./renderer";
import { createStillRenderer, type FrameRef } from "./still";

export type { ScreenshotFormat, FrameSpec };

export type ScreenshotParams = RendererWasmOption & {
    /** A project, or a lone still or composition as the one track of one. */
    document: ProjectDocument | VisualDocument;
    /** The vocabulary its clips compile against. Defaults to what the library ships. */
    registry?: Registry;
    /** Win over the document's own; 1920×1080 at 60 fps when neither says. */
    viewport?: Size2D;
    fps?: number;
    scale?: number;
    manifest?: AssetManifest;
    /** Theme for a document that carries none of its own. */
    theme?: Theme;
    /** Which frame to capture. Defaults to the timeline's first. */
    frame?: FrameRef;
    /** Encoding format (default "png"). */
    format?: ScreenshotFormat;
    /** JPEG quality in [0,1] (ignored for png; default 0.92). */
    quality?: number;
};

export type ScreenshotResult = {
    /** The project frame that was captured, after clamping. */
    frame: number;
    totalFrames: number;
    /** Encoded image bytes. */
    bytes: Uint8Array;
};

/**
 * Renders a single frame of a document to an image.
 *
 * A one-shot wrapper over {@link StillRenderer}: create, render, encode, dispose.
 * It therefore takes the same path as a live preview, and as the video export at
 * that frame — there is one renderer, not three.
 *
 * For anything that captures **repeatedly** — a thumbnail builder, a preview that
 * repaints as the user edits — hold a {@link StillRenderer} instead. This function
 * builds and tears down a WebGPU surface per call, which is the right trade for one
 * capture and the wrong one for a hundred.
 */
export async function exportScreenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
    const {
        registry, scale, manifest, theme, rendererWasmUrl,
        frame, format = "png", quality = 0.92,
    } = params;

    const project = resolveProjectDocument(params.document, params, DEFAULT_OUTPUT);
    if (project.tracks.length === 0) throw new Error("The project has no tracks to screenshot.");

    const renderer = await createStillRenderer({
        viewport: project.viewport, fps: project.fps, scale, manifest, theme, rendererWasmUrl, registry,
    });

    try {
        const drawn = await renderer.render(project, { frame });
        return { ...drawn, bytes: await renderer.toBytes({ format, quality }) };
    } finally {
        renderer.dispose();
    }
}
