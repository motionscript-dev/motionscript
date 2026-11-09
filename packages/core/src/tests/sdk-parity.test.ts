import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `packages/sdk/src/index.ts` (the published `@motionscript/sdk` barrel) still
// imports its symbols FROM `@motionscript/core` — this file is the same
// curated surface, sourced from core's own internals instead. Until the sdk
// package collapses to a passthrough, both must resolve to the same set of
// names: a name dropped or added on either side without the other is exactly
// what this guards against. Types are erased at runtime, so this only checks
// the value-export surface — the type surface is verified by hand against each
// sub-barrel (see the judgment calls called out in the sdk barrel move).
//
// The published barrel is loaded by a *dynamic* import with a non-literal
// specifier so `tsc` never resolves it as part of this package's program: a
// literal specifier would pull a file outside `rootDir` into the compile
// (TS6059) and, worse, would statically type-check it against whatever
// `@motionscript/core`'s last built `dist/` happens to export — a stale-build
// problem unrelated to this file. A plain runtime `import()` sidesteps both and
// still tests the thing that matters: what the module actually exports.
//
// The specifiers are resolved to absolute `file://` URLs by hand (rather than
// left as plain relative strings) because a non-literal specifier opts out of
// Vite's own relative-path rewriting too — an unresolved relative path would
// be evaluated against vitest's module-runner root instead of this file.
const here = dirname(fileURLToPath(import.meta.url));
const publishedSdkUrl = pathToFileURL(resolve(here, "../../../sdk/src/index.ts")).href;
const coreSdkUrl = pathToFileURL(resolve(here, "../sdk/index.ts")).href;

describe("sdk barrel parity", () => {
    it("exports the same named values as packages/sdk/src/index.ts", async () => {
        const publishedSdk = (await import(/* @vite-ignore */ publishedSdkUrl)) as Record<string, unknown>;
        const coreSdk = (await import(/* @vite-ignore */ coreSdkUrl)) as Record<string, unknown>;

        const published = Object.keys(publishedSdk).sort();
        const ported = Object.keys(coreSdk).sort();
        expect(ported).toEqual(published);
    }, 60_000); // cold-importing both whole barrels outlasts the default 5s
});
