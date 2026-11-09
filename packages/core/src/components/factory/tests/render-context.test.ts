import { describe, expect, it } from "vitest";
import { Graphics2D } from "@/render/graphics2d";
import type { Node2D } from "@/components/trees/2d/node2d";
import { laidOut, recorded } from "@/components/trees/tests/recording-context.fixtures";
import type { RenderContext2D } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { Camera, OrbitCamera } from "@/components/builtins/layout/layout";
import { Rect } from "@/components/builtins/geometry/geometry";

const square = (size: number) => new Graphics2D().rect({ width: size, height: size }).fill("white");

describe("ctx.clip", () => {
    const Clipped = component2d({
        key: "clipped",
        render: (ctx) => {
            ctx.draw(square(10));
            ctx.clip(new Graphics2D().rect({ width: 40, height: 20 }), () => ctx.draw(square(80)));
            ctx.draw(square(30));
        },
    });

    it("confines what its body draws to the shape's outline, and nothing after it", () => {
        const ctx = recorded(laidOut(new Clipped({ id: "c" })));
        expect(ctx.events.filter((e) => e !== "transform")).toEqual(["begin:c", "draw:rect+fill", "beginClip", "draw:rect+fill", "endClip", "draw:rect+fill", "end"]);
        expect(ctx.clips.map((c) => c.ops())).toEqual([[{ kind: "rect", state: { width: 40, height: 20 } }]]);
    });

    it("confines nothing for a shape with no outline", () => {
        const Open = component2d({
            key: "open",
            render: (ctx) => ctx.clip(new Graphics2D().fill("white"), () => ctx.draw(square(10))),
        });
        const ctx = recorded(laidOut(new Open({ id: "o" })));
        expect(ctx.events).not.toContain("beginClip");
        expect(ctx.events).toContain("draw:rect+fill");
    });
});

describe("ctx.inFront", () => {
    it("draws its body as it is outside a space", () => {
        const Own = component2d({ key: "own", render: (ctx) => ctx.inFront(() => ctx.draw(square(10))) });
        const ctx = recorded(laidOut(new Own({ id: "o" })));
        expect(ctx.events.filter((e) => e.startsWith("draw") || e.endsWith("Clip"))).toEqual(["draw:rect+fill"]);
    });
});

describe("ctx.ancestor", () => {
    const look = (ctx: RenderContext2D) => ctx.ancestor(Camera);
    const seen: ReturnType<typeof look>[] = [];
    const Probe = component2d({
        key: "probe",
        render: (ctx) => {
            seen.push(look(ctx));
        },
    });
    const probed = (root: Node2D) => {
        seen.length = 0;
        recorded(laidOut(root, { x: 0, y: 0, width: 400, height: 300 }));
        return seen.at(-1);
    };

    it("is the nearest node the component built, past nodes between", () => {
        const inner = new Camera({ id: "inner", zoom: 2, children: [Rect({ children: [Probe({ id: "p" })] })] });
        const outer = new Camera({ id: "outer", children: [inner] });
        const view = probed(outer);
        expect(view?.id).toBe("inner");
        expect(view?.key).toBe("camera");
        expect(view?.state.zoom).toBe(2);
    });

    it("reads its resolved state and the size it was laid out at", () => {
        const camera = new Camera({ id: "cam", width: 400, height: 300, lookAt: { x: 5, y: 6 }, children: [Probe()] });
        const view = probed(camera)!;
        expect(view.state.lookAt).toEqual({ x: 5, y: 6 });
        expect(view.size).toEqual({ width: 400, height: 300 });
        expect(() => { (view.state as { zoom: number }).zoom = 3; }).toThrow(TypeError);
    });

    it("is null with no such node above, whatever else is", () => {
        expect(probed(new OrbitCamera({ children: [Probe()] }))).toBeNull();
        expect(probed(new Probe())).toBeNull();
    });
});
