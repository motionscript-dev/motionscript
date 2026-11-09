import { describe, expect, it } from "vitest";

import { AssetNotLoadedError } from "@/assets/errors";
import { Node2D } from "@/components/trees/2d/node2d";
import { Rect } from "@/components/builtins/geometry/geometry";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { NullRenderContext } from "@/render/null-render-context";
import type { RenderContext2D } from "@/render/render-context2d";

/**
 * `Node2D.render` tells the runtime which node drew a missing asset, so the
 * segment can be learned against the node that needed it.
 */

class Throwing extends Node2D {
    constructor(private readonly error: unknown) {
        super({ width: 10, height: 10 });
    }
    protected override renderSelf(_ctx: RenderContext2D): void {
        throw this.error;
    }
}

function tree(error: unknown): { root: Rect; middle: Rect; inner: Throwing } {
    const inner = new Throwing(error);
    const middle = new Rect({ width: 50, height: 50 });
    const root = new Rect({ width: 100, height: 100 });
    middle.add(inner);
    root.add(middle);
    root.attach(attachScope());
    root.layout({ x: 0, y: 0, width: 100, height: 100 }, { measureText: () => ({ width: 0, height: 0 }) } as never);
    return { root, middle, inner };
}

describe("AssetNotLoadedError on the way out of a draw", () => {
    it("is stamped with the id of the node that threw, once, and not by the ancestors it passes through", () => {
        const error = new AssetNotLoadedError("image", "missing.png");
        const { root, inner } = tree(error);

        expect(error.nodeId).toBeUndefined();
        expect(() => root.render(new NullRenderContext())).toThrow(error);
        expect(error.nodeId).toBe(inner.id);
    });

    it("keeps a nodeId that was already set, whatever node it passes through", () => {
        const error = new AssetNotLoadedError("image", "missing.png");
        error.nodeId = "somewhere-else";
        const { root } = tree(error);

        expect(() => root.render(new NullRenderContext())).toThrow(error);
        expect(error.nodeId).toBe("somewhere-else");
    });

    it("carries the type and source it was thrown with, and rethrows the same error", () => {
        const error = new AssetNotLoadedError("video", "clip.mp4");
        const { root } = tree(error);

        let caught: unknown;
        try { root.render(new NullRenderContext()); } catch (thrown) { caught = thrown; }

        expect(caught).toBe(error);
        expect(error).toMatchObject({ assetType: "video", src: "clip.mp4", name: "AssetNotLoadedError" });
    });

    it("leaves any other error alone: no nodeId is added", () => {
        const error = new Error("boom") as Error & { nodeId?: string };
        const { root } = tree(error);

        expect(() => root.render(new NullRenderContext())).toThrow(error);
        expect(error.nodeId).toBeUndefined();
    });

    it("lets a non-Error throw through untouched", () => {
        const { root } = tree("just a string");
        expect(() => root.render(new NullRenderContext())).toThrow("just a string");
    });
});
