import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

/**
 * What a consumer's bundler keeps of this package.
 *
 * The package declares `sideEffects: false`, so a bundler may drop any statement
 * no used export reaches. Each entry point that draws must still reach the
 * renderer, and the audio mixdown must not. vitest itself does not tree-shake,
 * so this bundles for real, with rolldown, the bundler Vite 8 runs.
 */

const BARREL = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const CONSUMER = "\0consumer";

/** Bundle a consumer of `@motionscript/browser`, every other package left external. */
async function bundle(source: string): Promise<string> {
    const build = await rolldown({
        input: CONSUMER,
        logLevel: "silent",
        // Through the resolver rather than a plugin's `resolveId`, so the
        // package's own `sideEffects` is what the tree-shaker reads.
        resolve: { alias: { "@motionscript/browser": BARREL } },
        external: (id) => /^[@a-z]/.test(id) && id !== "@motionscript/browser",
        plugins: [{
            name: "consumer",
            resolveId: (id) => (id === CONSUMER ? id : null),
            load: (id) => (id === CONSUMER ? source : null),
        }],
    });
    try {
        const { output } = await build.generate({ format: "esm" });
        return output.map((file) => (file.type === "chunk" ? file.code : "")).join("\n");
    } finally {
        await build.close();
    }
}

describe("a consumer bundled with rolldown", () => {
    it.each(["createBrowserEngine", "createStillRenderer", "exportVideo", "exportVideoParallel", "serveExportLane"])(
        "importing only %s keeps the renderer",
        async (entry) => {
            const code = await bundle(`export { ${entry} } from "@motionscript/browser";`);

            expect(code).toMatch(/\bcreateWgpuRenderer\b/);
        },
    );

    it("importing only the audio mixdown carries no renderer", async () => {
        const code = await bundle(`export { mixAudio } from "@motionscript/browser";`);

        expect(code).not.toMatch(/@motionscript\/renderer/);
    });
});
