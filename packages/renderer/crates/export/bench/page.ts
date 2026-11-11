// The benchmark page: the same e2e scene exported through the WebCodecs path
// (`exportVideo`, the renderer on the page's WebGPU device) and through the
// native sidecar (`exportVideoNative`, the stream sent to the driver, which
// pipes it into `ms-export`). Bundled by run.ts with esbuild.

import { createBrowserEngine, exportVideo, exportVideoNative } from "@motionscript/browser";
import { nodes } from "../../../../e2e/src/project";

const WASM = "/ms_renderer_bg.wasm";

declare global {
    interface Window {
        __nativeWrite(b64: string): Promise<void>;
        __nativeFinish(): Promise<void>;
        bench: unknown;
    }
}

function b64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

const engine = await createBrowserEngine({ rendererWasmUrl: WASM, nodes: nodes as never });

interface RunOptions { scale: number; supersample: number; effects?: string[]; discard?: boolean }

window.bench = {
    setManifest(manifest: unknown) {
        engine.setManifest(manifest as never);
    },

    async webcodecs(doc: string, o: RunOptions) {
        const t0 = performance.now();
        const bytes = await exportVideo({
            document: JSON.parse(doc), registry: engine.registry, manifest: engine.manifest,
            scale: o.scale, supersample: o.supersample, returnBytes: true, rendererWasmUrl: WASM,
            video: { codec: "avc", hardwareAcceleration: "prefer-hardware" },
        });
        const ms = performance.now() - t0;
        return { ms, file: b64(bytes as Uint8Array) };
    },

    async native(doc: string, o: RunOptions) {
        let sent = 0, writeMs = 0, firstFrameAt = 0;
        const t0 = performance.now();
        await exportVideoNative({
            document: JSON.parse(doc), registry: engine.registry, manifest: engine.manifest,
            scale: o.scale, supersample: o.supersample, rendererWasmUrl: WASM,
            onProgress: () => { firstFrameAt ||= performance.now() - t0; },
            transport: {
                effects: o.effects!,
                async write(bytes) {
                    const w0 = performance.now();
                    sent += bytes.length;
                    if (!o.discard) await window.__nativeWrite(b64(bytes));
                    writeMs += performance.now() - w0;
                },
                async finish() {
                    if (!o.discard) await window.__nativeFinish();
                },
            },
        });
        const ms = performance.now() - t0;
        return { ms, sent, writeMs, firstFrameAt };
    },
};
document.documentElement.dataset.ready = "1";
