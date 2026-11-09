import { describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { Rect } from "@/components/builtins/geometry/geometry";
import { NumberNode, RichText, Text } from "@/components/builtins/text/text";
import { parentIssue } from "@/document/placement";
import { asProjectDocument } from "@/document/project";
import { Registry } from "@/document/registry";
import type { NodeSpec, StillDocument } from "@/document/types";
import { precompFor } from "@/runtime/document.fixtures";

const LEAVES = [
    ["text", Text],
    ["number", NumberNode],
    ["richtext", RichText],
] as const;

const registry = new Registry();

describe.each(LEAVES)("%s is a leaf", (key, Leaf) => {
    it("throws when a child is added, and says it takes none", () => {
        const leaf = new Leaf({} as never);
        expect(() => leaf.add(new Rect({}))).toThrow("It takes no children.");
    });

    it("throws when it is built with children", () => {
        expect(() => new Leaf({ children: [new Rect({})] } as never)).toThrow("It takes no children.");
    });

    it("tells a host it holds nothing, and refuses a child as a leaf", () => {
        expect(registry.describe(key)?.holds).toEqual([]);
        expect(parentIssue(registry, "rect", key)).toEqual({ kind: "leaf", parent: key });
    });
});

describe("a document that nests a node under a leaf", () => {
    const row = (id: string, type: string, parentId: string | null, props: Record<string, unknown> = {}): NodeSpec =>
        ({ id, type, parentId, layerOrder: 0, props });
    const doc: StillDocument = {
        kind: "still",
        nodes: [row("", "canvas2d", null), row("title", "text", null, { text: "hi" }), row("box", "rect", "title")],
    };

    it("fails to build rather than drawing a child nothing lays out", () => {
        const catalog = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });
        const project = asProjectDocument(doc, { fps: 30, viewport: { width: 200, height: 200 } });
        const { buildErrors } = precompFor(project, { registry, assets: catalog }).run();
        expect(buildErrors[0]?.message ?? "").toMatch(/cannot hold Rect.*takes no children/);
    });
});
