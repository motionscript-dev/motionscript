import type { DynamicNodeConfig } from "@motionscript/core";
import * as sdk from "@motionscript/core/sdk";
import * as esbuild from "esbuild-wasm";

/**
 * `browser`'s real, working default for `Registry.addNodeFromSource` — the
 * `sdk` half is cheap (re-exports, no WASM) and imported eagerly; the compiler
 * is the expensive half, and stays behind a lazy `import()` so an app that
 * never registers a source-string node never pays for it, however long the
 * engine has been running.
 *
 * `core` has no compiler dependency of its own and cannot import the published
 * `@motionscript/sdk` barrel (that package depends on `core`, so the reverse
 * would be circular) — `browser` is where this concern actually belongs: the
 * package whose entire job is "what running in an actual browser tab looks
 * like" already owns the renderer, `WebAudioSink` and `WebTicker` on exactly that
 * basis.
 */

// Default to the wasm shipped by esbuild-wasm, resolved lazily — `import.meta.url`
// is empty in a non-ESM output (an IIFE bundle, which is what the headless page
// loads), and `new URL("…", "")` throws on import, before a caller has had the
// chance to pass an explicit URL that would have made the default irrelevant.
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

/**
 * Resolves a full `DynamicNodeConfig`, filling in whatever the caller left
 * unset with `browser`'s own default. Synchronous — the WASM import happens
 * on `compile`'s first actual call, not here, so attaching this to every
 * engine costs nothing until a source string is genuinely registered.
 */
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
