import { describe, it, expect, afterEach } from "vitest";
import compilerWasmUrl from "esbuild-wasm/esbuild.wasm?url";
import { Node2D, Rect, setTheme, type NodeConstructor } from "@motionscript/core";
import { component2d } from "@motionscript/core/sdk";

import { still, node as specNode } from "./document.fixtures";
import { createBrowserEngine } from "../src/engine";
import { createStillRenderer } from "../src/still";
import { snapshotPixels } from "./pixels.fixtures";

/**
 * `createBrowserEngine`'s `nodes` option accepting a TS source string that
 * default-exports a component — see `dynamic-nodes.ts` for the default
 * `sdk`/`compile` `browser` supplies. Every case here passes
 * `compilerWasmUrl` explicitly (the Vite `?url` import): its default
 * resolves against `import.meta.url`, which a bundled/IIFE context
 * doesn't reliably have, so tests always pin it.
 *
 * The "an app that never registers a string node never triggers the
 * esbuild-wasm import" laziness claim isn't re-verified here at runtime — it
 * follows directly from `resolveDynamicNodes`'s `compile` being a plain
 * closure that only calls `defaultCompiler()` when actually invoked, which is
 * a code-shape guarantee a timing-based test would only reproduce noisily.
 */

/** A node type passed as a value, beside the source strings below. */
const Box = component2d({ key: "dynamic-nodes-test-box" });

const blobSource = `
    import { component2d } from "@motionscript/sdk";

    export default component2d({ key: "dynamic-blob" });
`;

// A composite whose child is built with a call, as an author writes one in a file.
const swatchSource = `
    import { component2d, Rect } from "@motionscript/sdk";

    export default component2d({
        key: "dynamic-swatch",
        children: () => [Rect({ width: "fill", height: "fill", fill: "#ff0000" })],
    });
`;

// A node whose builder reports the label it was built with to a host-supplied
// module, so a test can tell that the compiled component was instantiated.
const probedSource = `
    import { component2d, Types } from "@motionscript/sdk";
    import { probe } from "@motionscript/example/probe";

    export default component2d({
        key: "dynamic-probed",
        state: { label: Types.text("") },
        children: (state) => {
            probe.built.push(state.label);
            return [];
        },
    });
`;

/** A source defining nothing but `key`, under an sdk imported as `specifier`. */
const bare = (key: string, specifier = "@motionscript/sdk", body = "") => `
    import { component2d } from "${specifier}";
    ${body}
    export default component2d({ key: "${key}" });
`;

const cleanup: Array<() => void> = [];
afterEach(() => {
    setTheme(undefined);
    while (cleanup.length) cleanup.pop()!();
});

describe("createBrowserEngine — dynamic nodes", () => {
    it("compiles and registers a source string with zero dynamicNodes config", async () => {
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            nodes: [Box, blobSource],
        });
        cleanup.push(() => engine.dispose());

        expect(engine.knows("dynamic-nodes-test-box")).toBe(true);
        expect(engine.knows("dynamic-blob")).toBe(true);
    });

    it("a document naming the string-declared type builds it, proving instanceof holds", async () => {
        const probe = { built: [] as unknown[] };
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            nodes: [probedSource],
            dynamicNodes: { modules: { "@motionscript/example/probe": { probe } } },
        });
        cleanup.push(() => engine.dispose());

        const document = still(specNode("b", "dynamic-probed", { width: 10, height: 10, label: "b" }));
        const session = engine.open({ document });
        cleanup.push(() => session.dispose());

        await session.seekFrame(0);
        // A track that cannot build its node still seeks and reports a length, so
        // `totalFrames` says nothing here. The builder running is what needs the class.
        expect(probe.built).toEqual(["b"]);
    });

    it("builds nothing for the same document when the type is not registered", async () => {
        const probe = { built: [] as unknown[] };
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            dynamicNodes: { modules: { "@motionscript/example/probe": { probe } } },
        });
        cleanup.push(() => engine.dispose());

        const session = engine.open({ document: still(specNode("b", "dynamic-probed", { width: 10, height: 10, label: "b" })) });
        cleanup.push(() => session.dispose());

        await session.seekFrame(0);
        expect(probe.built).toEqual([]);
    });

    it("a later registerNode call works even when no string was passed at construction", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl, nodes: [Box] });
        cleanup.push(() => engine.dispose());

        expect(engine.knows("dynamic-blob")).toBe(false);
        const component = await engine.registerNode(blobSource);
        expect(engine.knows("dynamic-blob")).toBe(true);
        expect(new (component as unknown as new () => object)()).toBeInstanceOf(Node2D);
    });

    it("a component built of calls compiles, and the node draws", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl, nodes: [swatchSource] });
        cleanup.push(() => engine.dispose());

        const Swatch = engine.registry.node("dynamic-swatch")!.ctor as unknown as new () => Node2D;
        const swatch = new Swatch();
        expect(swatch.children).toHaveLength(1);
        expect(swatch.children[0]).toBeInstanceOf(Rect);

        const renderer = await createStillRenderer({
            viewport: { width: 32, height: 32 }, registry: engine.registry,
        });
        cleanup.push(() => renderer.dispose());
        await renderer.render(still(specNode("s", "dynamic-swatch", { width: "fill", height: "fill" })));
        const { pixels, width, height } = snapshotPixels((renderer as any).renderContext);
        const centre = ((height >> 1) * width + (width >> 1)) * 4;
        expect([...pixels.slice(centre, centre + 4)]).toEqual([255, 0, 0, 255]);
    });

    it("a script written in JSX neither compiles nor links, and registers nothing", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        cleanup.push(() => engine.dispose());

        // JSX is not TypeScript, pragma or none.
        for (const pragma of ["", "/** @jsxRuntime automatic */\n/** @jsxImportSource @motionscript/sdk */"]) {
            const failure = await engine.registerNode(`${pragma}
                import { component2d, Rect } from "@motionscript/sdk";

                export default component2d({ key: "dynamic-jsx", children: () => [<Rect width="fill" height="fill" />] });
            `).catch((error: unknown) => error);
            expect((failure as Error).message).toMatch(/Transform failed|Unexpected|Expected/);
        }

        // Compiled elsewhere, it requires a JSX runtime the registry does not link.
        for (const runtime of ["@motionscript/sdk/jsx-runtime", "@motionscript/sdk/jsx-dev-runtime"]) {
            await expect(engine.registerNode(bare("dynamic-jsx", "@motionscript/sdk", `import { jsx } from "${runtime}"; void jsx;`)))
                .rejects.toThrow(`"${runtime}" isn't available`);
        }
        expect(engine.knows("dynamic-jsx")).toBe(false);
    });

    it("dynamicNodes.compile overrides just the compiler, sdk still defaults", async () => {
        let calls = 0;
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            nodes: [blobSource],
            dynamicNodes: {
                compile: async (source) => {
                    calls++;
                    // A real compiler, just not browser's own default —
                    // proves the override is genuinely used.
                    const esbuild = await import("esbuild-wasm");
                    const { code } = await esbuild.transform(source, { loader: "ts", format: "cjs", target: "es2020" });
                    return code;
                },
            },
        });
        cleanup.push(() => engine.dispose());

        expect(calls).toBe(1);
        expect(engine.knows("dynamic-blob")).toBe(true);
    });

    it("dynamicNodes.modules links what a forked component imports beyond the sdk", async () => {
        const kit = { ring: () => "kit", linked: [] as unknown[] };
        const component = await import("@motionscript/core/component");
        const forkSource = bare("dynamic-fork", "@motionscript/sdk", `
            import { niceStep } from "@motionscript/sdk/component";
            import { ring, linked } from "@motionscript/example/kit";
            linked.push(ring, niceStep);
        `);
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            nodes: [forkSource],
            dynamicNodes: {
                modules: { "@motionscript/sdk/component": component, "@motionscript/example/kit": kit },
            },
        });
        cleanup.push(() => engine.dispose());

        const Fork = engine.registry.node("dynamic-fork")!.ctor as unknown as new () => object;
        expect(new Fork()).toBeInstanceOf(Node2D);
        expect(kit.linked).toEqual([kit.ring, component.niceStep]);
        await expect(engine.registerNode(`import "@motionscript/plot/kit";`))
            .rejects.toThrow(/"@motionscript\/plot\/kit" isn't available/);
    });

    it("does not offer @motionscript/sdk/component unless the host lists it", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        cleanup.push(() => engine.dispose());

        await expect(engine.registerNode(bare("dynamic-no-component", "@motionscript/sdk", `
            import { niceStep } from "@motionscript/sdk/component";
            void niceStep;
        `))).rejects.toThrow(/"@motionscript\/sdk\/component" isn't available/);
        expect(engine.knows("dynamic-no-component")).toBe(false);
    });

    it("links the same SDK under every specifier a script may use", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        cleanup.push(() => engine.dispose());

        for (const specifier of ["@motionscript/sdk", "motionscript", "motion-script"]) {
            const Linked = await engine.registerNode(bare("dynamic-spelling", specifier), { replace: true });
            expect(new (Linked as unknown as new () => object)()).toBeInstanceOf(Node2D);
        }
    });

    it("the record form has no slot for a string — bypassing the type still fails, not silently", async () => {
        await expect(createBrowserEngine({
            compilerWasmUrl,
            nodes: { blob: blobSource } as unknown as Record<string, NodeConstructor>,
        })).rejects.toThrow();
    });
});

describe("createBrowserEngine — what a source reaches and how it fails", () => {
    it("hands a caller-supplied sdk and modules to the script, not the browser defaults", async () => {
        const core = await import("@motionscript/core/sdk");
        const made: string[] = [];
        const sdk = {
            ...core,
            marker: "caller's sdk",
            component2d: (spec: { key: string }) => {
                made.push(spec.key);
                return core.component2d(spec as never);
            },
        };
        const seen: unknown[] = [];
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            dynamicNodes: { sdk, modules: { "@motionscript/example/seen": { seen } } },
            nodes: [bare("dynamic-custom-sdk", "@motionscript/sdk", `
                import { marker } from "@motionscript/sdk";
                import { seen } from "@motionscript/example/seen";
                seen.push(marker);
            `)],
        });
        cleanup.push(() => engine.dispose());

        expect(made).toEqual(["dynamic-custom-sdk"]);
        expect(seen).toEqual(["caller's sdk"]);
        expect(engine.knows("dynamic-custom-sdk")).toBe(true);
    });

    it("rejects with the compiler's own error for a script that does not parse", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        cleanup.push(() => engine.dispose());

        const before = engine.registry.nodeKeys();

        const failure = await engine.registerNode("export default component2d({").catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toMatch(/Transform failed|Unexpected|Expected/);
        expect(engine.registry.nodeKeys()).toEqual(before);
    });

    it("rejects a script whose default export is no component", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        cleanup.push(() => engine.dispose());

        await expect(engine.registerNode(`export default { key: "dynamic-plain" };`))
            .rejects.toThrow(/must `export default` a component/);
        expect(engine.knows("dynamic-plain")).toBe(false);
    });

    it("rejects with a script's own top-level throw, unchanged, and registers nothing", async () => {
        const engine = await createBrowserEngine({ compilerWasmUrl });
        cleanup.push(() => engine.dispose());
        const before = engine.registry.nodeKeys();

        const failure = await engine.registerNode(`
            import { component2d } from "@motionscript/sdk";

            const Throws = component2d({ key: "dynamic-throws" });
            throw new TypeError("script says no");
            export default Throws;
        `).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toBe("script says no");
        expect(engine.registry.nodeKeys()).toEqual(before);
    });

    it("rejects createBrowserEngine when a string in `nodes` throws", async () => {
        await expect(createBrowserEngine({
            compilerWasmUrl,
            nodes: [`throw new RangeError("bad boot script");`],
        })).rejects.toThrow(RangeError);
    });

    // A dynamic `import()` is part of the page, not of the registry's `require`, so
    // the lock does not see it. This is a reach the design accepts: the containment is
    // hardening, and the boundary is whatever gate a host puts in front of `registerNode`.
    it("lets a script reach a module through import(), which neither the require lock nor the denied names stop", async () => {
        const reached: unknown[] = [];
        const engine = await createBrowserEngine({
            compilerWasmUrl,
            dynamicNodes: { modules: { "@motionscript/example/reached": { reached } } },
        });
        cleanup.push(() => engine.dispose());

        await engine.registerNode(bare("dynamic-importer", "@motionscript/sdk", `
            import { reached } from "@motionscript/example/reached";

            reached.push(import("data:text/javascript,export default 41"));
        `));

        expect(reached).toHaveLength(1);
        expect(((await reached[0]) as { default: number }).default).toBe(41);
    });
});
