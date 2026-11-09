import { describe, expect, it } from "vitest";

import { Rect } from "@/components/builtins/geometry/geometry";
import { Node2D } from "@/components/trees/2d/node2d";
import { NullRenderContext } from "@/render/null-render-context";
import type { RenderContext2D } from "@/render/render-context2d";
import { AssetNotLoadedError } from "@/assets/errors";
import { attachScope } from "@/components/trees/node/node.fixtures";

/**
 * A node whose draw throws closes its own scope on the way out.
 *
 * `begin`/`end` live on the render pass, not on a node's hooks, so that a node
 * cannot leave one open — and a throw must not be the exception. A scope left
 * open by a throw outlives the pass that opened it: a context reused for the
 * next frame would draw it inside the dead node's state.
 */

class OpenScopes extends NullRenderContext {
    get open(): number {
        return this.currentNodeStack.length;
    }
}

class Faulty extends Node2D {
    constructor(private readonly error: Error) {
        super({ width: 10, height: 10 });
    }
    protected override renderSelf(_ctx: RenderContext2D): void {
        throw this.error;
    }
}

function tree(error: Error): { root: Rect; faulty: Faulty } {
    const faulty = new Faulty(error);
    const middle = new Rect({ width: 50, height: 50, opacity: 0.5 });
    const root = new Rect({ width: 100, height: 100, opacity: 0.5 });
    middle.add(faulty);
    root.add(middle);
    root.attach(attachScope());
    root.layout({ x: 0, y: 0, width: 100, height: 100 }, {
        measureText: () => ({ width: 0, height: 0 }),
    } as never);
    return { root, faulty };
}

describe("a draw that throws", () => {
    it("still throws", () => {
        const error = new Error("boom");
        const { root } = tree(error);
        expect(() => root.render(new OpenScopes())).toThrow(error);
    });

    it("leaves no node scope open", () => {
        const { root } = tree(new Error("boom"));
        const ctx = new OpenScopes();
        expect(() => root.render(ctx)).toThrow();
        expect(ctx.open).toBe(0);
    });

    it("is still claimed by the innermost node", () => {
        const error = new AssetNotLoadedError("image", "missing.png");
        const { root, faulty } = tree(error);
        expect(() => root.render(new OpenScopes())).toThrow(error);
        expect(error.nodeId).toBe(faulty.id);
    });
});
