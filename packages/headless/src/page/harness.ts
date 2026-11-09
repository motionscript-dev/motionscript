/**
 * The half of the server engine that runs **inside the page**.
 *
 * esbuild bundles this together with the project's own entry into one IIFE, so
 * the browser loads a single file: no module graph over HTTP, no dev server, no
 * dependency-optimizer scan. That scan — not "a browser" — is what made the
 * previous Playwright driver slow enough to delete, and it is the one piece of
 * it deliberately not recovered.
 *
 * Everything below runs with the DOM, WebGPU, WebCodecs and Web Audio available,
 * which is the entire point: it is the *browser* engine, driven remotely, so a
 * server export renders the same 3D and the same audio a preview does.
 */
import {
    ConcatMismatchError,
    concatVideoSegments,
    createBrowserEngine,
    exportVideo as exportVideoFile,
    mixTimelineAudio,
} from "@motionscript/browser";
import {
    placeTracks,
    resolveProjectDocument,
    totalFramesOf,
    type Engine,
    type ProjectDocument,
    type RenderIssue,
} from "@motionscript/core";
import type {
    Bridge,
    ConcatRequest,
    ConcatResult,
    ExportRequest,
    ScreenshotRequest,
    ScreenshotResult,
} from "../page-bridge";

/** What a project entry may export. */
export interface ProjectModule {
    /** What a request that brings no document renders. */
    default?: ProjectDocument;
    /**
     * A record naming each node type's key outright, or an array of components
     * mixed freely with TS source strings (a string default-exports a
     * component, whose `key` is its key — see `createBrowserEngine`'s `nodes`
     * option, which this is bundled into the page and handed to unchanged).
     * Only the array form accepts a string.
     */
    nodes?: Record<string, unknown> | readonly unknown[];
    shaders?: Record<string, unknown>;
}

const RENDERER_WASM = "/ms_renderer_bg.wasm";

declare global {
    interface Window {
        __motionScript?: Bridge;
    }
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on
    // anything above a few hundred KB, which every real frame is.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Build the engine and publish the bridge.
 *
 * The ready signal is an attribute on `<html>` rather than a resolved promise:
 * the driver has to wait for it from *outside* the page, and an attribute is the
 * one thing it can poll without evaluating anything.
 */
export async function installBridge(project: ProjectModule): Promise<void> {
    const engine: Engine = await createBrowserEngine({
        // Origin-relative, served by the driver's route handler. Explicit rather
        // than defaulted because the default resolves against `import.meta.url`,
        // which an IIFE bundle does not have. Same reasoning for
        // `compilerWasmUrl` — only ever read if `project.nodes` names a string.
        rendererWasmUrl: RENDERER_WASM,
        compilerWasmUrl: "/esbuild.wasm",
        nodes: project.nodes as never,
        shaders: project.shaders,
        viewport: project.default?.viewport,
        fps: project.default?.fps,
    });

    // Optional. An entry that exports only `nodes` and `shaders` is complete:
    // those are *code*, which is the one thing that cannot cross a process
    // boundary and so the only thing the bundle exists to carry. Documents are
    // data and arrive per request.
    const fallback = project.default;

    window.__motionScript = {
        projectName: fallback?.name ?? "",
        fps: fallback?.fps ?? 0,

        listTracks() {
            return fallback?.tracks.map(track => track.id) ?? [];
        },

        setManifest(manifest: unknown) {
            engine.setManifest(manifest as never);
        },

        async screenshot(request: ScreenshotRequest): Promise<ScreenshotResult> {
            const session = openFor(request);
            try {
                const still = await session.image({
                    frame: typeof request.frame === "number"
                        ? { kind: "frame", frame: request.frame }
                        : { kind: request.frame },
                    scale: request.scale,
                    format: request.format,
                    onIssue: warnIssue,
                });
                return {
                    base64: toBase64(still.bytes),
                    frame: still.frame,
                    totalFrames: still.totalFrames,
                };
            } finally {
                session.dispose();
            }
        },

        // What `session.export` does, without opening a session: a session's
        // controller discovers every track on frame 0 as it opens, which the
        // exporter then does again with a store of its own.
        async exportVideo(request: ExportRequest): Promise<string> {
            const { scale, includeAudio, frames, supersample, codec, bitrate, hardwareAcceleration } = request;
            const bytes = await exportVideoFile({
                document: resolve(request),
                registry: engine.registry,
                manifest: engine.manifest,
                scale,
                includeAudio,
                frames,
                supersample,
                video: { codec, bitrate, hardwareAcceleration },
                returnBytes: true,
                rendererWasmUrl: RENDERER_WASM,
                onIssue: warnIssue,
            });
            if (!bytes) throw new Error("The exporter produced no bytes.");
            return toBase64(bytes);
        },

        countFrames(request: { document?: unknown }): number {
            const resolved = resolve(request);
            return totalFramesOf(placeTracks(resolved.tracks, resolved.fps!));
        },

        async concatSegments(request: ConcatRequest): Promise<ConcatResult> {
            try {
                const audio = request.includeAudio === false ? null : await mixTimelineAudio({
                    document: resolve(request),
                    registry: engine.registry,
                    manifest: engine.manifest,
                    rendererWasmUrl: RENDERER_WASM,
                });
                const joined = await concatVideoSegments(request.segments.map(fromBase64), { audio });
                return { base64: toBase64(joined) };
            } catch (error) {
                if (error instanceof ConcatMismatchError) return { mismatch: error.message };
                throw error;
            }
        },
    };

    /** Reaches the Node side as a page warning (`onPageMessage`), as other soft failures do. */
    function warnIssue(issue: RenderIssue): void {
        console.warn(`[render issue] ${issue.kind}${issue.feature ? ` ${issue.feature}` : ""}${issue.nodeId ? ` on ${issue.nodeId}` : ""}: ${issue.message}`);
    }

    /**
     * The document a request brought, else the entry's default. A string is the
     * document's JSON text, which crosses into the page far faster than the
     * object Playwright would otherwise walk.
     */
    function sourceOf(request: { document?: unknown }): unknown {
        const source = typeof request.document === "string" ? JSON.parse(request.document) : request.document ?? fallback;
        if (!source) {
            throw new Error(
                "This request named no document, and the project entry has no default " +
                "export to fall back on. Either pass a document, or have the entry " +
                "`export default` a project document.",
            );
        }
        return source;
    }

    /** The request's project, its viewport and fps resolved as a session opened on it would resolve them. */
    function resolve(request: { document?: unknown }): ProjectDocument {
        return resolveProjectDocument(sourceOf(request) as never, {}, engine);
    }

    function openFor(request: { document?: unknown }) {
        return engine.open({ document: sourceOf(request) as never });
    }

    document.documentElement.setAttribute("data-motion-script", "ready");
}
