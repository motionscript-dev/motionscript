import type { DynamicNodeConfig } from "@motionscript/core";
import * as sdk from "@motionscript/core/sdk";
import * as esbuild from "esbuild-wasm";

/** `browser`'s working default for `Registry.addNodeFromSource`: the cheap `sdk` half is imported eagerly, the compiler stays behind a lazy `import()` so an app that never registers a source-string node never pays for it. `core` cannot import the published `@motionscript/sdk` barrel (circular) and has no compiler dependency, so the concern lives here, which already owns the renderer, `WebAudioSink` and `WebTicker`. */

// Default to the wasm shipped by esbuild-wasm, resolved lazily: `import.meta.url` is empty in a non-ESM output (the headless page's IIFE), and `new URL("…", "")` would throw on import before a caller could pass an explicit URL.
function defaultCompilerWasmUrl(): string {
    return new URL("esbuild-wasm/esbuild.wasm", import.meta.url).href;
}

let compilerPromise: Promise<(source: string) => Promise<string>> | undefined;

/** Loaded once, memoized process-wide. */
function defaultCompiler(wasmUrl?: string): Promise<(source: string) => Promise<string>> {
    return (compilerPromise ??= (async () => {
        await esbuild.initialize({ wasmURL: wasmUrl ?? defaultCompilerWasmUrl() });
        return async (source: string) => {
            const { code } = await esbuild.transform(source, {
                // A component is written with calls: there is no JSX to compile.
                loader: "ts",
                format: "cjs",
                target: "es2020",
            });
            return code;
        };
    })());
}

/** Resolves a full `DynamicNodeConfig`, filling unset fields with `browser`'s default. Synchronous: the WASM import happens on `compile`'s first call, so attaching this to every engine is free until a source string is registered. */
export function resolveDynamicNodes(
    partial: Partial<DynamicNodeConfig> | undefined,
    compilerWasmUrl?: string,
): DynamicNodeConfig {
    return {
        sdk: partial?.sdk ?? sdk,
        modules: partial?.modules,
        compile: partial?.compile ?? (async (source) => (await defaultCompiler(compilerWasmUrl))(source)),
    };
}
