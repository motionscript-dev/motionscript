import {
    DEFAULT_OUTPUT,
    ManifestAssetCatalog,
    AssetTimeline,
    Registry,
    resolveProjectDocument,
    type AssetManifest,
    type ProjectDocument,
    type VisualDocument,
    type Size2D,
} from "@motionscript/core";
import { collectAudio } from "./frame-loop";

import { mixAudio } from "./audio/mixer";
import { loadRenderer, type RendererWasmOption } from "./renderer";

export interface MixTimelineAudioParams extends RendererWasmOption {
    /** A project, or a lone still or composition as the one track of one. */
    document: ProjectDocument | VisualDocument;
    registry?: Registry;
    /** Win over the document's own; 1920×1080 at 60 fps when neither says. */
    viewport?: Size2D;
    fps?: number;
    manifest?: AssetManifest;
    /** Mixdown rate. Defaults to the mixer's own (44100). */
    sampleRate?: number;
}

const EMPTY_MANIFEST: AssetManifest = { image: {}, video: {}, audio: {}, font: {} };

/**
 * Mixes a timeline's audio without rendering a frame. A **split** export cannot mix per piece (separately-encoded AAC
 * puts the encoder's priming delay at every join: a click and drift at each boundary), so the coordinator mixes the
 * whole timeline once here. Returns `null` when no audio is scheduled (the common case, not a failure), so the caller
 * muxes video only rather than declaring an empty track.
 *
 * It must discover: audio requests are an *output of discovery* (each node declares its clips as it enters the tree), so
 * there is no knowing what plays when without it. Nothing is drawn, so it takes the renderer's measure context, not a
 * render context: text is measured, not rasterized, and WebGPU is not required.
 */
export async function mixTimelineAudio(
    params: MixTimelineAudioParams,
): Promise<AudioBuffer | null> {
    const { registry = new Registry(), manifest = EMPTY_MANIFEST, sampleRate } = params;
    const project = resolveProjectDocument(params.document, params, DEFAULT_OUTPUT);
    if (project.tracks.length === 0) return null;
    const viewport = project.viewport!;
    const fps = project.fps!;

    // The renderer only for its text shaper; nothing is drawn.
    const renderer = await loadRenderer(params, { gpu: false });
    const catalog = new ManifestAssetCatalog(manifest);
    const storage = renderer.createStorageAdapter({ catalog, viewport, fps });
    const measurer = renderer.createMeasureContext(storage);

    // Audio is declared from each node's arrival state, so no asset windows are refined.
    const precomper = new AssetTimeline(project, { registry, viewport, fps, assets: catalog, measurer }, { assets: false });
    try {
        const precomp = precomper.run();

        const scheduled = collectAudio(precomp);
        if (scheduled.length === 0) return null;

        return await mixAudio(scheduled, precomp.totalDuration, { sampleRate, catalog });
    } finally {
        precomper.dispose();
        // The adapter holds decode sessions and cached images; without this a mix
        // leaks them for the life of the page.
        storage.dispose();
    }
}
