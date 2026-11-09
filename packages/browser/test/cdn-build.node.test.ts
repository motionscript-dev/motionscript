import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rolldown, type OutputChunk } from "rolldown";

/**
 * The package as shipped: its `package.json` contract, the CDN build in
 * `dist/browser/` and the audio subpath's reach.
 *
 * These read what `pnpm build` wrote, so they need `pnpm build:lib` first, as the
 * rest of this package's tests do for core. A missing `dist/browser/` is a failure
 * that says so, not a skip: the build is the thing under test.
 */

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const SRC = `${PACKAGE}src/`;
const CDN = `${PACKAGE}dist/browser/`;

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
const pkg = readJson(`${PACKAGE}package.json`);

const isBare = (id: string) => /^[@a-z]/.test(id);

/** Every chunk of a bundle of `entries`, every bare import left external. */
async function bundle(entries: Record<string, string>): Promise<OutputChunk[]> {
    const build = await rolldown({
        input: entries,
        logLevel: "silent",
        treeshake: false,
        external: isBare,
    });
    try {
        const { output } = await build.generate({ format: "esm" });
        return output.filter((file): file is OutputChunk => file.type === "chunk");
    } finally {
        await build.close();
    }
}

/**
 * The engine packages a bundle `import()`s, which rolldown lists in no chunk's
 * `dynamicImports` when external. Only ours: a dependency's guarded Node-only
 * `import("worker_threads")` is not something a host supplies.
 */
function dynamicExternalsOf(chunks: readonly OutputChunk[]): string[] {
    return chunks.flatMap((chunk) => [...chunk.code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!))
        .filter((id) => id.startsWith("@motionscript/"));
}

/** The bare specifiers a bundle imports, statically or dynamically. */
function externalsOf(chunks: readonly OutputChunk[]): string[] {
    const files = new Set(chunks.map((chunk) => chunk.fileName));
    return [...new Set([...chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]), ...dynamicExternalsOf(chunks)])]
        .filter((id) => !files.has(id) && isBare(id))
        .sort();
}

describe("package.json", () => {
    it("exports the barrel and the audio subpath, and nothing else", () => {
        expect(pkg.exports).toEqual({
            ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
            "./audio": { types: "./dist/audio/index.d.ts", default: "./dist/audio/index.js" },
        });
        expect(pkg.main).toBe("dist/index.js");
        expect(pkg.types).toBe("dist/index.d.ts");
        expect(pkg.type).toBe("module");
    });

    it("declares what the contract says about side effects, peers, dependencies and assets", () => {
        expect(pkg.sideEffects).toBe(false);
        expect(pkg.peerDependencies).toEqual({ "@motionscript/core": "workspace:^" });
        expect(pkg.peerDependenciesMeta).toBeUndefined();
        expect(Object.keys(pkg.dependencies).sort()).toEqual(["@mediabunny/mp3-encoder", "@motionscript/renderer", "esbuild-wasm", "mediabunny"]);
        expect(pkg.dependencies["@motionscript/renderer"]).toBe("workspace:^");
        expect(pkg.motionscriptBrowser).toEqual({
            assets: { "esbuild.wasm": "esbuild-wasm/esbuild.wasm", "ms_renderer_bg.wasm": "@motionscript/renderer/ms_renderer_bg.wasm" },
        });
    });

    it("ends its build with the CDN build, so a lint or compile failure stops it", () => {
        expect(pkg.scripts.build).toMatch(/^eslint \. && tsc .* && node \.\.\/\.\.\/scripts\/build-browser\.mjs$/);
    });
});

describe("the audio subpath", () => {
    it("reaches @motionscript/core at run time and not the renderer", async () => {
        const chunks = await bundle({ audio: `${SRC}audio/index.ts` });

        expect(externalsOf(chunks)).toEqual(["@motionscript/core"]);
    });

    it("is what the root barrel does reach: it needs the renderer (so the comparison has teeth)", async () => {
        const chunks = await bundle({ index: `${SRC}index.ts` });

        expect(externalsOf(chunks)).toContain("@motionscript/renderer");
    });
});

describe("dist/browser", () => {
    it("exists, so the build ran", () => {
        for (const file of ["index.js", "audio.js", "manifest.json", "esbuild.wasm", "ms_renderer_bg.wasm"]) {
            expect(existsSync(`${CDN}${file}`), `${CDN}${file} — run \`pnpm build:lib\``).toBe(true);
        }
    });

    it("imports exactly the peers and core's SDK, and nothing else", async () => {
        const chunks = await bundle({ index: `${CDN}index.js`, audio: `${CDN}audio.js` });

        expect(externalsOf(chunks)).toEqual([
            "@motionscript/core",
            "@motionscript/core/sdk",
        ]);
    });

    it("holds none of core's code, which the host's one copy supplies", async () => {
        const marker = "isn't available to a custom node";
        // The marker is core's, in its registry: a bundle of core carries it, so its absence below means something.
        const core = await bundle({ core: "@motionscript/core" });
        expect(core.map((chunk) => chunk.code).join("\n")).toContain(marker);

        const built = await bundle({ index: `${CDN}index.js`, audio: `${CDN}audio.js` });
        expect(built.map((chunk) => chunk.code).join("\n")).not.toContain(marker);
    });

    it("has an audio module that reaches only core among the peers", async () => {
        const chunks = await bundle({ audio: `${CDN}audio.js` });

        expect(externalsOf(chunks)).toEqual(["@motionscript/core"]);
    });
});

describe("dist/browser/manifest.json", () => {
    const manifest = readJson(`${CDN}manifest.json`);

    it("names the package and its version", () => {
        expect(manifest.name).toBe(pkg.name);
        expect(manifest.version).toBe(pkg.version);
    });

    it("maps each exports entry to its CDN module, relative to the package root", () => {
        expect(manifest.exports).toEqual({ ".": "dist/browser/index.js", "./audio": "dist/browser/audio.js" });
        for (const file of Object.values(manifest.exports) as string[]) {
            expect(existsSync(`${PACKAGE}${file}`), file).toBe(true);
        }
    });

    it("lists the peers, sorted as the build writes them", () => {
        expect(manifest.peers).toEqual(Object.keys(pkg.peerDependencies));
    });

    it("lists each declared asset at a file that exists", () => {
        expect(Object.keys(manifest.assets)).toEqual(Object.keys(pkg.motionscriptBrowser.assets));
        expect(manifest.assets).toEqual({ "esbuild.wasm": "dist/browser/esbuild.wasm", "ms_renderer_bg.wasm": "dist/browser/ms_renderer_bg.wasm" });
        for (const file of Object.values(manifest.assets) as string[]) {
            expect(existsSync(`${PACKAGE}${file}`), file).toBe(true);
        }
    });
});
