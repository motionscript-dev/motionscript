import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import V1 from "./v1-names.json";

// `@motionscript/sdk/v1` and `/v1/component` are these two barrels. `v1-names.json` is every value name they had
// when v1 was cut: a name may join (v1 still links), but one that leaves or is renamed breaks every component that
// imports `/v1`. Types are erased before a component links, so only values are held here.
const here = dirname(fileURLToPath(import.meta.url));
const load = (path: string): Promise<Record<string, unknown>> =>
    import(/* @vite-ignore */ pathToFileURL(resolve(here, path)).href) as Promise<Record<string, unknown>>;

describe.each([
    ["@motionscript/sdk/v1", "../index.ts", V1.sdk],
    ["@motionscript/sdk/v1/component", "../../component.ts", V1.component],
])("%s", (specifier, path, names) => {
    it("still exports every v1 name", async () => {
        const barrel = await load(path);
        const gone = names.filter((name) => !(name in barrel));
        expect(
            gone,
            `${specifier} no longer exports ${gone.join(", ")}. Removing or renaming a v1 name breaks every ` +
                "component on /v1: that needs v2, with a v1 shim that keeps the old name.",
        ).toEqual([]);
    }, 60_000);
});
