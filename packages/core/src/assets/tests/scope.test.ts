import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetDeclaration, assetKey, normalizeWeight } from "@/assets/scope";
import { ManifestAssetCatalog } from "@/assets/catalog";
import type { LoaderFn } from "@/assets/record";
import { Fills } from "@/attributes/shape/fill/chain";
import { fillOps } from "@/attributes/shape/fill/registry";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Text } from "@/components/builtins/text/text";
import { ContextMap } from "@/util/context";
import type { Node } from "@/components/trees/node/node";

const catalog = new ManifestAssetCatalog({
    image: {
        "photo.png": { src: "photo.png", width: 8, height: 8, sizeBytes: 0 },
        "paper.png": { src: "paper.png", width: 8, height: 8, sizeBytes: 0 },
        "map.png": { src: "map.png", width: 8, height: 8, sizeBytes: 0 },
    },
    video: { "clip.mp4": { src: "clip.mp4", width: 8, height: 8, duration: 12, sizeBytes: 0 } },
    audio: {},
    font: {},
});

const keys = (scope: AssetDeclaration): string[] => [...scope.declarations.keys()].sort();

const mount = <T extends Node>(node: T): T => {
    node.attach({ assets: catalog, context: ContextMap.EMPTY, time: 0 });
    return node;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe("AssetDeclaration", () => {
    it("throws for an image or video the catalog does not know", () => {
        const scope = new AssetDeclaration(catalog);
        expect(() => scope.image("missing.png")).toThrow(/Image asset not found/);
        expect(() => scope.video("missing.mp4")).toThrow(/Video asset not found/);
        expect(() => scope.video("missing.mp4", { start: 0, end: 2 })).toThrow(/Video asset not found/);
        expect(scope.declarations.size).toBe(0);
    });

    it("declares nothing for an unset media slot or an unnamed family", () => {
        const scope = new AssetDeclaration(catalog);
        scope.image("");
        scope.video("");
        scope.font("");
        scope.fill(fillOps.resolve(Fills.image("")));
        expect(scope.declarations.size).toBe(0);
    });

    it("dedupes by key, keeping the first declaration", () => {
        const scope = new AssetDeclaration(catalog);
        scope.image("photo.png");
        scope.image("photo.png");
        scope.video("clip.mp4", { start: 2 });
        scope.video("clip.mp4", { start: 5, end: 6 });
        scope.font("Inter", "700");
        scope.font("Inter", 300);

        expect(scope.declarations.get("clip.mp4")).toEqual({ type: "video", src: "clip.mp4", trimStart: 2, trimEnd: 12 });
        expect(scope.declarations.get("Inter")).toEqual({ type: "font", family: "Inter", weight: 700 });
        expect(keys(scope)).toEqual(["Inter", "clip.mp4", "photo.png"]);
        for (const [key, decl] of scope.declarations) expect(assetKey(decl)).toBe(key);
    });

    it("keeps the first loader, warns on a different function, and upgrades to the layout gate", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const first: LoaderFn = async () => { };
        const scope = new AssetDeclaration(catalog);

        scope.loader("grammar", first);
        scope.loader("grammar", first, { gate: "layout" });
        expect(warn).not.toHaveBeenCalled();
        expect(scope.declarations.get("grammar")).toEqual({ type: "loader", key: "grammar", load: first, gate: "layout" });

        scope.loader("grammar", async () => { });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/grammar/);
        expect((scope.declarations.get("grammar") as { load: LoaderFn }).load).toBe(first);
    });

    it("declares a font family the catalog has no entry for, because fonts are not validated at declaration", () => {
        const scope = new AssetDeclaration(catalog);
        scope.font("Nowhere", 600);
        expect(scope.declarations.get("Nowhere")).toEqual({ type: "font", family: "Nowhere", weight: 600 });
        // And it never asks the catalog, so a catalog that throws for everything is not reached.
        const hostile = new AssetDeclaration({
            ...catalog,
            getFontMeta: () => { throw new Error("asked"); },
            getFontFamilyMetas: () => { throw new Error("asked"); },
        } as never);
        expect(() => hostile.font("Nowhere")).not.toThrow();
    });

    it("ignores, without a warning, a loader key an image already holds, and an image whose key a loader holds", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        const load: LoaderFn = async () => { };

        const imageFirst = new AssetDeclaration(catalog);
        imageFirst.image("photo.png");
        imageFirst.loader("photo.png", load);
        imageFirst.loader("photo.png", load, { gate: "layout" });
        expect(imageFirst.declarations.get("photo.png")).toEqual({ type: "image", src: "photo.png" });

        const loaderFirst = new AssetDeclaration(catalog);
        loaderFirst.loader("photo.png", load);
        loaderFirst.image("photo.png");
        expect(loaderFirst.declarations.get("photo.png")).toMatchObject({ type: "loader", key: "photo.png" });

        expect(warn).not.toHaveBeenCalled();
    });

    it("normalizes weights, landing anything unparseable on 400", () => {
        expect(normalizeWeight(undefined)).toBe(400);
        expect(normalizeWeight(NaN)).toBe(400);
        expect(normalizeWeight("bold")).toBe(400);
        expect(normalizeWeight("600")).toBe(600);
        expect(normalizeWeight(350)).toBe(350);
    });

    it("declares fills through their registry", () => {
        const scope = new AssetDeclaration(catalog);
        scope.fill(fillOps.resolve(Fills.image("photo.png")));
        scope.fill(fillOps.resolve(Fills.video("clip.mp4", { trimStart: 1, trimEnd: 3 }))[0]);
        expect(keys(scope)).toEqual(["clip.mp4", "photo.png"]);
        expect(scope.declarations.get("clip.mp4")).toMatchObject({ trimStart: 1, trimEnd: 3 });
    });

    it("binds and walks a subtree once, declaring every node in it", () => {
        const bound: Node[] = [];
        const scope = new AssetDeclaration(catalog, { bindSubtree: (node) => { bound.push(node); mount(node); } });
        const source = new Rect({
            fill: Fills.image("photo.png"),
            children: [new Text({ text: "hi", fontFamily: "Inter" })],
        });

        scope.subtree(source);
        scope.subtree(source);

        expect(bound).toEqual([source]);
        expect(keys(scope)).toEqual(["Inter", "photo.png"]);
    });

    it("walks nothing of an unbound subtree, and hands the walk to onSubtree when given", () => {
        const unbound = new AssetDeclaration(catalog);
        unbound.subtree(new Rect({ fill: Fills.image("photo.png") }));
        expect(unbound.declarations.size).toBe(0);

        const visited: Node[] = [];
        const custom = new AssetDeclaration(catalog, { onSubtree: (node, scope) => { visited.push(node); scope.image("map.png"); } });
        const source = new Rect({ fill: Fills.image("photo.png") });
        custom.subtree(source);
        expect(visited).toEqual([source]);
        expect(keys(custom)).toEqual(["map.png"]);
    });
});
