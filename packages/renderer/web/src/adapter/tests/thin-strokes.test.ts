import { describe, expect, it } from "vitest";
import { Graphics2D } from "@motionscript/core";
import { isAxisAligned, type Node, PathBuilder } from "../../doc";
import { WgpuRenderContext } from "../context";

/** Every node one Graphics2D draws into a fresh doc, depth first. */
function drawn(g: Graphics2D): Node[] {
    const ctx = new WgpuRenderContext(400, 300, () => ({ width: 0, height: 0 }));
    ctx.execute(() => ctx.draw(g));
    const out: Node[] = [];
    const walk = (n: Node) => {
        out.push(n);
        n.children.forEach(walk);
    };
    walk(ctx.doc.root);
    return out;
}

const strokeWidths = (g: Graphics2D) => drawn(g).filter((n) => n.stroke).map((n) => n.stroke!.width);
/** Whether a group moves or scales its children (the pixel-edge snap does). */
const snapped = (g: Graphics2D) => drawn(g).some((n) => n.kind === "group" && n.transform.some((v, i) => v !== [1, 0, 0, 1][i] && i < 4));

describe("thin strokes", () => {
    const thin = { fill: "red", weight: 1.3, align: "center" } as never;

    it("keep their authored width and place on an outline that is not all horizontal and vertical", () => {
        for (const data of ["M 0 0 L 40 30 L 80 0", "M 0 0 C 20 40 60 40 80 0", "M 0 0 H 40 V 30 Z"]) {
            const g = new Graphics2D().path({ data }).stroke(thin);
            expect(strokeWidths(g), data).toEqual([1.3]);
            expect(snapped(g), data).toBe(false);
        }
    });

    it("sit on whole device pixels along horizontal and vertical lines", () => {
        const g = new Graphics2D().path({ data: "M 0 0 H 40.3 V 30 H 0 Z" }).stroke(thin);
        expect(strokeWidths(g)).toEqual([1]);
        expect(snapped(g)).toBe(true);
    });

    it("sit on whole device pixels round the renderer's own rect", () => {
        expect(drawn(new Graphics2D().rect({ width: 41, height: 21 }).stroke(thin)).filter((n) => n.kind === "rect").map((n) => n.stroke?.width)).toEqual([1]);
    });
});

describe("parsed paths", () => {
    const pathOf = (state: Record<string, unknown>) => drawn(new Graphics2D().path(state as never).fill("red")).find((n) => n.kind === "path")!.path!;
    const data = "M 0 0 L 40 30 L 80 0 L 60 -20 Z";

    it("come back as the same path data for the same string and placement", () => {
        expect(pathOf({ data })).toBe(pathOf({ data }));
        expect(pathOf({ data, centerBounds: [-50, -50, 50, 50] })).toBe(pathOf({ data, centerBounds: [-50, -50, 50, 50] }));
        expect(pathOf({ data, end: 0.5 })).toBe(pathOf({ data, end: 0.5 }));
    });

    it("are placed again when the centring, turn or trim changes", () => {
        const plain = pathOf({ data });
        const others = [pathOf({ data, centerBounds: [-50, -50, 50, 50] }), pathOf({ data, rotation: 30 }), pathOf({ data, end: 0.5 })];
        for (const p of others) expect(p).not.toBe(plain);
        expect(Array.from(pathOf({ data, rotation: 30 }).points)).not.toEqual(Array.from(plain.points));
    });
});

describe("isAxisAligned", () => {
    const build = (f: (b: PathBuilder) => void) => {
        const b = new PathBuilder();
        f(b);
        return b.build();
    };

    it("holds for lines that are each horizontal or vertical, closing lines too", () => {
        expect(isAxisAligned(build((b) => b.moveTo(0, 0).lineTo(10, 0).lineTo(10, 5).lineTo(0, 5).close()))).toBe(true);
        expect(isAxisAligned(build((b) => b.moveTo(0, 0).lineTo(10, 0).moveTo(3, 3).lineTo(3, 9)))).toBe(true);
    });

    it("fails on a slanted line, a slanted close or a curve", () => {
        expect(isAxisAligned(build((b) => b.moveTo(0, 0).lineTo(10, 1)))).toBe(false);
        expect(isAxisAligned(build((b) => b.moveTo(0, 0).lineTo(10, 0).lineTo(10, 5).close()))).toBe(false);
        expect(isAxisAligned(build((b) => b.moveTo(0, 0).quadTo(5, 5, 10, 0)))).toBe(false);
        expect(isAxisAligned(build((b) => b.moveTo(0, 0)))).toBe(false);
    });
});
