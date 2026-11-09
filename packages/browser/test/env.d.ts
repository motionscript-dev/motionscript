/**
 * Vite's `?url` import suffix, which resolves to the asset's served URL.
 *
 * Declared here rather than by pulling in `vite/client`: the only thing these
 * tests need from it is this one form (`esbuild.wasm?url`), and the full
 * client types bring a large ambient surface — `ImportMeta.env`, every other
 * asset suffix — that nothing here uses and that would quietly widen what a
 * test is allowed to reference.
 */
declare module "*?url" {
    const url: string;
    export default url;
}

/**
 * Only the one variable a test reads: `vitest.config.ts` forwards
 * `REQUIRE_ENCODERS` into the page, which has no `process`.
 */
interface ImportMeta {
    readonly env: { readonly REQUIRE_ENCODERS?: string };
}

/**
 * What the Node-side build checks read the package's files with. This package is
 * compiled without Node's types, because everything under `src/` is for the
 * browser, so the functions a `*.node.test.ts` needs are declared here rather
 * than by taking `@types/node` in.
 */
declare module "node:fs" {
    export function readFileSync(path: string, encoding: "utf8"): string;
    export function existsSync(path: string): boolean;
    export function readdirSync(path: string): string[];
}

declare module "node:url" {
    export function fileURLToPath(url: string | URL): string;
}
