import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetDeclaration } from "@/assets/scope";
import { ManifestAssetCatalog } from "@/assets/catalog";
import type { Node2D } from "@/components/trees/2d/node2d";
import { component2d } from "@/components/factory/component2d";

const catalog = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });

let loads = 0;
async function warmUp(): Promise<string> {
    loads++;
    return "a value the scope should not take for a disposer";
}

const Typeset = component2d({
    key: "loadTaskProbe",
    load: (loader) => loader.task("warm-up", warmUp, { before: "layout" }),
});

afterEach(() => {
    vi.restoreAllMocks();
    loads = 0;
});

describe("a component's load task", () => {
    it("is one loader however many nodes declare it, with no warning about a second function", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const scope = new AssetDeclaration(catalog);
        for (let i = 0; i < 3; i++) (new Typeset({}) as Node2D).declareAssets(scope);
        expect([...scope.declarations.keys()]).toEqual(["warm-up"]);
        expect(warn).not.toHaveBeenCalled();
        const declared = scope.declarations.get("warm-up") as { load: () => Promise<unknown>; gate: string };
        expect(declared.gate).toBe("layout");
        expect(await declared.load()).toBeUndefined();
        expect(loads).toBe(1);
    });

    it("hands the scope the function a load resolves to, to free what it loaded", async () => {
        const free = () => { };
        const Owner = component2d({ key: "loadTaskFree", load: (loader) => loader.task("owned", async () => free) });
        const scope = new AssetDeclaration(catalog);
        (new Owner({}) as Node2D).declareAssets(scope);
        const declared = scope.declarations.get("owned") as { load: () => Promise<unknown> };
        expect(await declared.load()).toBe(free);
    });
});
