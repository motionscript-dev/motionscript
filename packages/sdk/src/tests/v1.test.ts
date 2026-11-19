import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Loaded by URL, as core's barrel tests do: a literal import of `../index` is a barrel import, which lint forbids.
const here = dirname(fileURLToPath(import.meta.url));
const load = (path: string): Promise<Record<string, unknown>> =>
    import(/* @vite-ignore */ pathToFileURL(resolve(here, path)).href) as Promise<Record<string, unknown>>;

// While v1 is the latest API, each `/v1` path is its bare path exactly: the same names, the same values. Core's
// `sdk/tests/v1-freeze.test.ts` holds what v1 promises.
describe.each([
    ["./v1", "../v1.ts", "../index.ts"],
    ["./v1/component", "../v1-component.ts", "../component.ts"],
])("%s", (_subpath, v1Path, latestPath) => {
    it("hands out exactly what the bare path does", async () => {
        const [v1, latest] = await Promise.all([load(v1Path), load(latestPath)]);
        expect(Object.keys(v1).sort()).toEqual(Object.keys(latest).sort());
        for (const name of Object.keys(latest)) expect(v1[name], name).toBe(latest[name]);
    }, 60_000);
});
