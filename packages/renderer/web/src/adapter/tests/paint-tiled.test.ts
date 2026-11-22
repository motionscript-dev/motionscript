import { describe, expect, it } from "vitest";
import { Graphics2D } from "@motionscript/core";
import type { Node } from "../../doc";
import { WgpuRenderContext } from "../context";

const all = (root: Node): Node[] => [root, ...root.children.flatMap(all)];

describe("paintTiled", () => {
    it("draws the tile once into a surface of whole device px and paints the cover with it repeating", () => {
        const ctx = new WgpuRenderContext(400, 300, () => ({ width: 0, height: 0 }));
        ctx.pixelRatio = 2;
        let painted = false;
        ctx.execute(() => {
            painted = ctx.paintTiled(
                { x: -50.2, y: -20, width: 100.4, height: 40 },
                { x: -200, y: -150, width: 400, height: 300 },
                () => ctx.draw(new Graphics2D().rect({ width: 100.4, height: 40 }).fill("red")),
            );
        });
        expect(painted).toBe(true);
        const [image] = ctx.doc.images;
        expect([image.width, image.height]).toEqual([201, 80]);
        // The tile's drawing went into the surface, and only there.
        expect(all(image.surface!).length).toBeGreaterThan(1);
        const leaves = all(ctx.doc.root).filter((n) => n.fill);
        expect(leaves).toHaveLength(1);
        const fill = leaves[0].fill as { kind: string; image: unknown; tile: string; matrix: number[] };
        expect(fill).toMatchObject({ kind: "image", image, tile: "repeat" });
        // One surface px is a whole tile's share: the tile's edges are the surface's.
        expect(fill.matrix[0] * image.width).toBeCloseTo(100.4);
        expect(fill.matrix[3] * image.height).toBeCloseTo(40);
        expect([fill.matrix[4], fill.matrix[5]]).toEqual([-50.2, -20]);
    });

    it("paints nothing over an empty cover", () => {
        const ctx = new WgpuRenderContext(400, 300, () => ({ width: 0, height: 0 }));
        let drew = false;
        ctx.execute(() => {
            ctx.paintTiled({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }, () => (drew = true));
        });
        expect(drew).toBe(false);
        expect(ctx.doc.images).toHaveLength(0);
    });
});
