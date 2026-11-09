import { describe, expect, it } from "vitest";
import compilerWasmUrl from "esbuild-wasm/esbuild.wasm?url";

import { createBrowserEngine } from "../src/engine";

/**
 * A compiler whose initialisation failed stays failed.
 *
 * Its own file because the memo is module state, and each test file's page starts
 * with none: this is the only place the first initialisation can be made to fail
 * without taking every other case's compiler with it.
 */

const source = (key: string) => `
    import { component2d } from "@motionscript/sdk";

    export default component2d({ key: "${key}" });
`;

describe("the default compiler after a failed initialisation", () => {
    it("keeps the rejection, so a later engine with a good URL is refused too", async () => {
        let first: unknown;
        const broken = await createBrowserEngine({ compilerWasmUrl: "/no-such-compiler.wasm" });
        try {
            first = await broken.registerNode(source("failed-first")).catch((error: unknown) => error);
            expect(first).toBeInstanceOf(Error);
            expect(broken.knows("failed-first")).toBe(false);
        } finally {
            broken.dispose();
        }

        const good = await createBrowserEngine({ compilerWasmUrl });
        try {
            // The URL passed later is never read: the memo holds the rejected promise, so
            // this is the very error the first call got.
            const second = await good.registerNode(source("failed-second")).catch((error: unknown) => error);
            expect(second).toBe(first);
            expect(good.knows("failed-second")).toBe(false);
        } finally {
            good.dispose();
        }
    });
});
