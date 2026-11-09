import { describe, expect, it } from "vitest";
import { Node2D } from "@/components/trees/2d/node2d";
import { Graphics2D } from "@/render/graphics2d";
import type { RenderContext2D } from "@/render/render-context2d";
import { fillOps } from "@/attributes/shape/fill/registry";
import { frameOf, laidOut } from "@/components/trees/tests/recording-context.fixtures";
import { OrbitCamera } from "@/components/builtins/layout/layout";
import { component2d } from "@/components/factory/component2d";

const square = () => new Graphics2D().rect({ width: 300, height: 300 }).fill(fillOps.resolve("tomato"));

/** A class drawing its own paint in `renderSelf`, which a space cuts at its near plane. */
class Painted extends Node2D {
    protected override renderSelf(ctx: RenderContext2D): void {
        ctx.draw(square());
    }
}

const Drawn = component2d({
    key: "inFrontProbe",
    // The class's two paint scopes: its own paint under the children, its overlay and stroke over them.
    render: (ctx) => {
        ctx.inFront(() => ctx.draw(square()));
        ctx.children();
        ctx.inFront(() => { });
    },
});

// Tipped toward the lens and pushed past it, so the near plane cuts the square.
const CROSSING = { id: "p", width: 300, height: 300, depth: 900, rotationX: 75 };

function spaceOf(child: Node2D) {
    return laidOut(new OrbitCamera({ id: "o", perspective: 1000, children: [child] } as never) as Node2D, { x: 0, y: 0, width: 400, height: 300 });
}

describe("ctx.inFront", () => {
    it("paints a component's own drawing cut at a space's near plane, as a class's renderSelf is", () => {
        const before = frameOf(spaceOf(new Painted(CROSSING as never)));
        const after = frameOf(spaceOf(new Drawn(CROSSING as never) as Node2D));
        expect(before.events).toContain("beginClip");
        expect(after).toEqual(before);
    });

    it("runs nothing while a render is only probed for its shape", () => {
        let ran = 0;
        const Counted = component2d({ key: "inFrontCount", render: (ctx) => ctx.inFront(() => { ran++; }) });
        const node = laidOut(new Counted({}) as Node2D);
        node._localBounds();
        expect(ran).toBe(0);
    });
});
