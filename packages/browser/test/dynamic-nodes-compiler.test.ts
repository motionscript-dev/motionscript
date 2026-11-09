import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import compilerWasmUrl from "esbuild-wasm/esbuild.wasm?url";
import * as sdk from "@motionscript/core/sdk";

import { createBrowserEngine } from "../src/engine";
import { resolveDynamicNodes } from "../src/dynamic-nodes";

/**
 * The default compiler's one piece of module state: `esbuild.initialize` runs on
 * the first compile, once per page, and nothing before that loads WebAssembly.
 *
 * This file is the only one that may count initialisations. The memo is
 * module-scope and each test file runs in a page of its own, so the first test
 * here sees a compiler that has never been asked for, which no case in
 * `dynamic-nodes.test.ts` can, after the one before it has compiled.
 */

const sourceFor = (key: string, body = "") => `
    import { component2d } from "@motionscript/sdk";
    ${body}
    export default component2d({ key: "${key}" });
`;

/**
 * esbuild-wasm runs in a Web Worker it starts itself, and the worker is what is
 * handed the binary's URL and fetches it — so the page's own `fetch` never sees the
 * request. A worker started and told to load `esbuild.wasm` is the observable
 * "WebAssembly was loaded", counted here.
 */
let loads: string[];

beforeEach(() => {
    loads = [];
    const Real = globalThis.Worker;
    class Spy extends Real {
        constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            const post = this.postMessage.bind(this) as (message: unknown, ...rest: unknown[]) => void;
            this.postMessage = ((message: unknown, ...rest: unknown[]) => {
                if (typeof message === "string" && message.includes("esbuild.wasm")) loads.push(message);
                post(message, ...rest);
            }) as Worker["postMessage"];
        }
    }
    vi.stubGlobal("Worker", Spy);
});

afterEach(() => vi.unstubAllGlobals());

describe("resolveDynamicNodes", () => {
    it("returns a complete config at once, with the browser's own defaults, and loads nothing", () => {
        const config = resolveDynamicNodes(undefined, compilerWasmUrl);

        expect(config.sdk).toBe(sdk);
        expect(config).not.toHaveProperty("jsxRuntime");
        expect(config.modules).toBeUndefined();
        expect(typeof config.compile).toBe("function");
        expect(loads).toEqual([]);
    });

    it("takes each field the caller gave and leaves the rest to the defaults", () => {
        const modules = { "@motionscript/example/kit": {} };
        const compile = async (source: string) => source;
        const custom = { component2d: sdk.component2d };

        expect(resolveDynamicNodes({ modules }, undefined)).toMatchObject({ sdk, modules });
        expect(resolveDynamicNodes({ compile }, undefined).compile).toBe(compile);
        expect(resolveDynamicNodes({ sdk: custom }, undefined)).toMatchObject({ sdk: custom });
    });
});

describe("the default compiler's initialisation", () => {
    it("loads no WebAssembly until the first compile, then once however many compile after", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        try {
            // The renderer's wasm is loaded by now; the compiler's is not.
            expect(loads).toEqual([]);

            await Promise.all([
                engine.registerNode(sourceFor("compiler-a")),
                engine.registerNode(sourceFor("compiler-b")),
                engine.registerNode(sourceFor("compiler-c")),
            ]);
            expect(loads).toHaveLength(1);
            expect(new URL(loads[0]).pathname).toMatch(/esbuild\.wasm$/);

            await engine.registerNode(sourceFor("compiler-d"));
            expect(loads).toHaveLength(1);
            expect(["compiler-a", "compiler-b", "compiler-c", "compiler-d"].map((key) => engine.knows(key)))
                .toEqual([true, true, true, true]);
        } finally {
            engine.dispose();
        }
    });
});

describe("registering `nodes` at boot", () => {
    it("registers values first and strings in array order, and stops at the first refused string", async () => {
        const order: string[] = [];
        const probe = { order };
        const modules = { "@motionscript/example/probe": { probe } };
        const withProbe = (key: string, extra = "") => sourceFor(key, `
            import { probe } from "@motionscript/example/probe";
            probe.order.push("${key}");
            ${extra}
        `);

        const booted = createBrowserEngine({
            compilerWasmUrl,
            dynamicNodes: { modules },
            nodes: [
                withProbe("boot-first"),
                withProbe("boot-refused", `throw new Error("refused at boot");`),
                withProbe("boot-never"),
            ],
        });

        await expect(booted).rejects.toThrow("refused at boot");
        expect(order).toEqual(["boot-first", "boot-refused"]);
    });

    it("registers the components of `nodes` before its strings, wherever they sit in the array", async () => {
        const Taken = sdk.component2d({ key: "boot-taken" });

        // The string is listed first, yet the component already holds the key by the time it registers.
        await expect(createBrowserEngine({
            compilerWasmUrl,
            nodes: [sourceFor("boot-taken"), Taken],
        })).rejects.toThrow(/boot-taken/);
    });
});
