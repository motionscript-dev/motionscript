import { describe, expect, it } from "vitest";

import { fillOps } from "@/attributes/shape/fill/registry";
import { Fills } from "@/attributes/shape/fill/chain";
import { strokeOps, type Stroke } from "@/attributes/shape/stroke/stroke";
import { Graphics3D, type Graphics3DOp } from "@/render3d/graphics3d";
import { isSurfaceTexture3D } from "@/render3d/texture";
import { Scene3D } from "@/render3d/scene3d";
import { component3d } from "@/components/factory/component3d";
import type { Node3D } from "@/components/trees/three/node3d";
import * as Paint3D from "@/components/modules/paint3d";

type Instances = Extract<Graphics3DOp, { kind: "instances" }>;
type Bar = { position: number[]; scale: number[] };

const EDGE: Paint3D.Segment3D[] = [[[0, 0, 0], [1, 0, 0]]];

function draw(stroke: Stroke, segments: readonly Paint3D.Segment3D[] = EDGE, options?: Paint3D.LinesOptions): Instances[] {
    const g3 = Paint3D.lines(new Graphics3D(), strokeOps.resolve(stroke), segments, options);
    return g3.ops().filter((op): op is Instances => op.kind === "instances");
}

function bars(op: Instances): Bar[] {
    return op.instances as unknown as Bar[];
}

describe("Paint3D.material", () => {
    it("makes one solid layer a colour, its alpha the opacity", () => {
        const m = Paint3D.material(fillOps.resolve("rgba(255, 0, 0, 0.5)")) as { type: string; color: number[]; opacity: number; map?: unknown };
        expect(m.type).toBe("basic");
        expect(m.color).toEqual([1, 0, 0, 1]);
        expect(m.opacity).toBeCloseTo(0.5);
        expect(m.map).toBeUndefined();
    });

    it("multiplies a layer's own opacity in", () => {
        const m = Paint3D.material(fillOps.resolve({ type: "solid", color: "white", opacity: 0.25 })) as { opacity: number };
        expect(m.opacity).toBeCloseTo(0.25);
    });

    it("lights it when asked, laying extra fields over it", () => {
        const m = Paint3D.material(fillOps.resolve("white"), { type: "standard", roughness: 0.4, opacity: 0.5 }) as { type: string; roughness: number; opacity: number };
        expect(m).toMatchObject({ type: "standard", roughness: 0.4 });
        expect(m.opacity).toBeCloseTo(0.5);
    });

    it("makes a gradient a texture map", () => {
        const m = Paint3D.material(fillOps.resolve(Fills.linearGradient(["red", "blue"]))) as { color?: unknown; map?: unknown };
        expect(m.color).toBeUndefined();
        expect(isSurfaceTexture3D(m.map as never)).toBe(true);
    });

    it("makes an empty fill invisible", () => {
        expect(Paint3D.material([])).toMatchObject({ type: "basic", visible: false });
    });
});

describe("Paint3D.lines", () => {
    it("scales a unit bar by weight in thousandths of a unit", () => {
        const [op] = draw({ weight: 5.5, fill: "black" });
        expect(op!.geometry).toEqual({ type: "box", width: 1, height: 1, depth: 1 });
        const [bar] = bars(op!);
        expect(bar!.scale[0]).toBeCloseTo(1);
        expect(bar!.scale[1]).toBeCloseTo(0.0055);
        expect(bar!.scale[2]).toBeCloseTo(0.0055);
        expect(bar!.position).toEqual([0.5, 0, 0]);
    });

    it("turns a bar onto its segment", () => {
        const [op] = draw({ weight: 10, fill: "black" }, [[[0, 0, 0], [0, 2, 0]]]);
        const q = (op!.instances[0] as { quaternion: { x: number; y: number; z: number; w: number } }).quaternion;
        // +x carried onto +y: a quarter turn about +z.
        expect(q.z).toBeCloseTo(Math.SQRT1_2);
        expect(q.w).toBeCloseTo(Math.SQRT1_2);
        expect(bars(op!)[0]!.scale[0]).toBeCloseTo(2);
    });

    it("draws one instances call per layer", () => {
        const ops = draw([{ weight: 8, fill: "white" }, { weight: 3, fill: "black" }], [EDGE[0]!, [[1, 0, 0], [1, 1, 0]]]);
        expect(ops).toHaveLength(2);
        expect(ops.map((op) => op.instances.length)).toEqual([2, 2]);
    });

    it("cuts a dashed segment into dashes of the pattern's lengths", () => {
        // 100 on, 100 off along a unit: five dashes 0.1 long.
        const [op] = draw({ weight: 2, fill: "black", dash: [100, 100] });
        const dashes = bars(op!);
        expect(dashes).toHaveLength(5);
        for (const d of dashes) expect(d.scale[0]).toBeCloseTo(0.1);
        expect(dashes[0]!.position[0]).toBeCloseTo(0.05);
        expect(dashes[4]!.position[0]).toBeCloseTo(0.85);
    });

    it("clips the last dash to the segment, and shifts by the offset", () => {
        expect(Paint3D.dashes(1, [0.3, 0.2])).toEqual([[0, 0.3], [0.5, 0.8]]);
        const shifted = Paint3D.dashes(1, [0.3, 0.2], 0.1);
        expect(shifted[0]![0]).toBeCloseTo(0);
        expect(shifted[0]![1]).toBeCloseTo(0.2);
        expect(shifted[1]![0]).toBeCloseTo(0.4);
        expect(shifted[1]![1]).toBeCloseTo(0.7);
        expect(shifted[2]![0]).toBeCloseTo(0.9);
        expect(shifted[2]![1]).toBeCloseTo(1);
    });

    it("repeats an odd dash list twice, as SVG does", () => {
        const [op] = draw({ weight: 2, fill: "black", dash: [100, 100, 300] });
        // 0.1 on, 0.1 off, 0.3 on, 0.1 off, 0.1 on, 0.3 off: two dashes then one in the second half.
        expect(bars(op!).map((b) => Number(b.scale[0]!.toFixed(3)))).toEqual([0.1, 0.3, 0.1]);
    });

    it("runs a square cap half the weight past each end, and ends butt and round flush", () => {
        const square = bars(draw({ weight: 20, fill: "black", cap: "square" })[0]!)[0]!;
        expect(square.scale[0]).toBeCloseTo(1.02);
        expect(bars(draw({ weight: 20, fill: "black", cap: "butt" })[0]!)[0]!.scale[0]).toBeCloseTo(1);
        expect(bars(draw({ weight: 20, fill: "black", cap: "round" })[0]!)[0]!.scale[0]).toBeCloseTo(1);
        const dashed = bars(draw({ weight: 20, fill: "black", cap: "square", dash: [100, 100] })[0]!);
        for (const d of dashed) expect(d.scale[0]).toBeCloseTo(0.12);
    });

    it("draws nothing for an empty stroke, a clear one, or no segments", () => {
        expect(draw([])).toEqual([]);
        expect(draw({ weight: 5, fill: "transparent" })).toEqual([]);
        expect(draw({ weight: 0, fill: "black" })).toEqual([]);
        expect(draw({ weight: 5, fill: "black" }, [])).toEqual([]);
        expect(draw({ weight: 5, fill: "black" }, [[[1, 1, 1], [1, 1, 1]]])).toEqual([]);
    });

    it("colours with the first solid fill, opaque unless its alpha says otherwise", () => {
        const [solid] = draw({ weight: 5, fill: "red" });
        expect(solid!.material).toEqual({ type: "basic", color: [1, 0, 0, 1], opacity: 1 });
        const [faint] = draw({ weight: 5, fill: "rgba(0, 0, 255, 0.4)" });
        expect(faint!.material).toMatchObject({ color: [0, 0, 1, 1], transparent: true, depthWrite: false });
        expect((faint!.material as { opacity: number }).opacity).toBeCloseTo(0.4);
    });

    it("draws through solids when asked", () => {
        const [op] = draw({ weight: 5, fill: "black" }, EDGE, { through: true });
        expect(op!.material).toMatchObject({ depthTest: false, depthWrite: false, transparent: true });
    });

    it("lifts every segment by the offset given, and passes the transform on", () => {
        const [op] = draw({ weight: 5, fill: "black" }, EDGE, { lift: [0, 0.01, 0], transform: { position: [0, 3, 0] } });
        expect(bars(op!)[0]!.position).toEqual([0.5, 0.01, 0]);
        expect(op!.transform).toEqual({ position: [0, 3, 0] });
    });
});

describe("a component3d painted with Paint3D", () => {
    const Panel = component3d({
        key: "paintedPanel3d",
        state: { ...Paint3D.state },
        defaults: { fill: "tomato", stroke: { weight: 5, fill: "black" } },
        commands: { ...Paint3D.commands },
        render: (ctx, s) => {
            const g3 = new Graphics3D().box({ width: 1, height: 1, depth: 1, material: Paint3D.material(s.fill) });
            ctx.draw(Paint3D.lines(g3, s.stroke, EDGE));
        },
    });

    it("takes fill and stroke as a 2D shape does, and has their commands", () => {
        const node = new Panel({ fill: "#00ff00" }) as unknown as Node3D;
        const scene = new Scene3D();
        node.render(scene);
        const drawn = scene.ops().filter((op) => op.kind === "mesh" || op.kind === "instances");
        expect(drawn.map((op) => op.kind)).toEqual(["mesh", "instances"]);
        expect((drawn[0] as { material: { color: number[] } }).material.color).toEqual([0, 1, 0, 1]);
        expect(Object.keys(Paint3D.commands)).toEqual(["fillTo", "strokeTo"]);
    });
});
