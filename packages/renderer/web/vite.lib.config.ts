// The package's library build: the engine entry (src/engine) as ESM in dist/,
// with core and mediabunny left as imports and the renderer's WASM
// emitted beside it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const external = /^(@motionscript\/core(\/.*)?|mediabunny)$/;
const WASM = "ms_renderer_bg.wasm";
const DEFAULT_URL = `new URL('${WASM}', import.meta.url)`;
const HIDDEN_URL = `new URL('ms_renderer_bg' + '.wasm', import.meta.url)`;

/**
 * Library mode inlines every `new URL(…, import.meta.url)` asset as base64,
 * which would ship the 2 MB WASM inside the JS. The reference is hidden from
 * the asset plugin (the output keeps a plain relative URL, which a host's
 * bundler resolves), and the file is emitted beside the entry.
 */
function wasmBeside(): Plugin {
    return {
        name: "renderer-wasm-beside",
        transform(code, id) {
            if (id.endsWith("ms_renderer.js")) return code.replace(DEFAULT_URL, HIDDEN_URL);
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: WASM, source: readFileSync(fileURLToPath(new URL(`pkg/${WASM}`, import.meta.url))) });
            this.emitFile({ type: "asset", fileName: "index.d.ts", source: readFileSync(fileURLToPath(new URL("src/engine/public.d.ts", import.meta.url))) });
        },
    };
}

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    publicDir: false,
    plugins: [wasmBeside()],
    build: {
        outDir: fileURLToPath(new URL("../dist", import.meta.url)),
        emptyOutDir: true,
        target: "es2022",
        minify: false,
        sourcemap: true,
        lib: {
            entry: fileURLToPath(new URL("src/engine/index.ts", import.meta.url)),
            formats: ["es"],
            fileName: () => "index.js",
        },
        rolldownOptions: { external: (id: string) => external.test(id) },
    },
});
