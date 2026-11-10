import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
    resolve: {
        // Mirror the tsconfig `@/* -> ./src/*` path mapping (resolved by
        // tsc-alias at build time) so tests can import via the `@` alias too.
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    // Discovered only once a test reaches them, which would re-optimize mid-run
    // and reload the page ("Vite unexpectedly reloaded a test").
    optimizeDeps: {
        include: ["mediabunny", "@mediabunny/mp3-encoder"],
    },
    test: {
        testTimeout: 30_000,
        // The page has no `process`, so `REQUIRE_ENCODERS` reaches a test only through
        // here. `encoders.fixtures.ts` reads it: set to `1`, a suite that needs an H.264
        // or AAC encoder this Chromium lacks fails; otherwise it is skipped with a reason.
        env: { REQUIRE_ENCODERS: process.env.REQUIRE_ENCODERS ?? "" },
        projects: [
            {
                extends: true,
                test: {
                    name: "chromium",
                    include: ["test/**/*.test.ts"],
                    exclude: [...configDefaults.exclude, "test/**/*.node.test.ts"],
                    browser: {
                        enabled: true,
                        // Linux reads a SwiftShader WebGPU canvas back empty when headless,
                        // so CI runs headed under Xvfb (HEADED=1).
                        headless: process.env.HEADED !== "1",
                        instances: [{ browser: "chromium" }],
                        // Headless Chromium needs a GPU process to encode video, and without
                        // these it doesn't get one. The failure is badly disguised:
                        // `VideoEncoder.isConfigSupported` still answers `supported: true`,
                        // and then the first real `encode()` takes the whole page down — the
                        // run reports "Browser connection was closed while running tests",
                        // nowhere near the cause, with zero tests executed. Any suite that
                        // encodes (see `concat.test.ts`) is unrunnable without them.$1//
                        // `--enable-unsafe-swiftshader` is what makes the software fallback
                        // usable on a machine with no real GPU (CI); it is scoped to this test
                        // browser and says nothing about how the library runs in production.
                        provider: playwright({
                            launchOptions: {
                                args: [
                                    "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader",
                                    "--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader",
                                ],
                            },
                        }),
                    },
                },
            },
            {
                extends: true,
                test: {
                    // What a consumer's bundler keeps of this package is a
                    // question about a build, so it is asked in Node.
                    name: "node",
                    include: ["test/**/*.node.test.ts"],
                    environment: "node",
                },
            },
        ],
    },
});
