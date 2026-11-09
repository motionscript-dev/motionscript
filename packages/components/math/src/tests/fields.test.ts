import { describe, expect, it } from "vitest";
import { Registry, type GraphicsOp, type InsetsResolved, type Node2D, type Vector2 } from "@motionscript/sdk";
import { traceContour } from "../kit/contour";
import { cartesianMap, lineThrough, readMatrix, transformedMap, warpedMap } from "../kit/coords";
import { EQUATION_KINDS } from "../kit/equation3d";
import { fieldError, fieldParams, parseField } from "../kit/field";
import { NODES } from "../nodes";
import { plotArea } from "../kit/system";
import { planeMap, type NumberPlane } from "../systems/number-plane";
import { inkOf, play, scene, type Row, type Step } from "./harness";

const registry = new Registry({ nodes: NODES });

/** 800 × 400 with no padding: 100 px a unit both ways over [-4, 4] × [-2, 2]. */
const FLAT = cartesianMap({ xRange: [-4, 4], yRange: [-2, 2], area: { minX: -400, maxX: 400, minY: -200, maxY: 200 } });
const PLANE: Row = { id: "plane", type: "numberPlane", props: { width: 800, height: 400, xRange: [-4, 4], labels: false, ticks: false } };
const AXES: Row = { id: "axes", type: "axes2d", props: { width: 800, height: 400, xRange: [-4, 4], yRange: [-2, 2], labels: false } };

const near = (got: Vector2, x: number, y: number) => {
    expect(got.x).toBeCloseTo(x, 6);
    expect(got.y).toBeCloseTo(y, 6);
};

/** The runs every path in `ops` draws, an outline painted twice (filled, then stroked) counted once. */
function pathPoints(ops: readonly GraphicsOp[]): Vector2[][] {
    const seen = new Set<unknown>();
    return ops.flatMap((op) => {
        if (op.kind !== "path") return [];
        const data = (op.state as { data: { type: string; x: number; y: number }[] }).data;
        if (seen.has(data)) return [];
        seen.add(data);
        const runs: Vector2[][] = [];
        for (const command of data) {
            if (command.type === "M") runs.push([]);
            if (command.type !== "Z") runs[runs.length - 1].push({ x: command.x, y: command.y });
        }
        return runs;
    });
}

describe("a transformed map", () => {
    const shear = transformedMap(FLAT, [1, 1, 0, 1]);

    it("sends a point through the matrix, and back", () => {
        near(shear.toPoint(1, 1), 200, 100);
        near(shear.toCoords(200, 100), 1, 1);
        near(shear.toCoords(0, 0), 0, 0);
    });

    it("shows whatever of the plane now falls in the box, so a grid ruled over its ranges fills it", () => {
        // The corner (4, 2) of the box is the point (2, 2) of a plane sheared by one.
        expect(shear.xRange).toEqual([-6, 6]);
        expect(shear.yRange).toEqual([-2, 2]);
        expect(shear.curved).toBeUndefined();
    });

    it("reads a point as the flat plane has it when the matrix squeezes the plane onto a line", () => {
        const squeezed = transformedMap(FLAT, [1, 0, 0, 0]);
        near(squeezed.toPoint(2, 5), 200, 0);
        near(squeezed.toCoords(200, 100), 2, 1);
    });

    it("reaches four times its own ranges at most, so a plane going flat folds its grid into a band", () => {
        const flat = transformedMap(FLAT, [2, -2, 1, -1]);
        expect(flat.xRange).toEqual([-16, 16]);
        expect(flat.yRange).toEqual([-8, 8]);
        // Nearly flat, the box's pre-image runs to thousands of units; the grid stops where the flat one does.
        const almost = transformedMap(FLAT, [2, -1.999, 1, -1]);
        expect(almost.xRange).toEqual(flat.xRange);
        expect(almost.yRange).toEqual(flat.yRange);
        // A shrink by two still fills the box.
        expect(transformedMap(FLAT, [0.5, 0, 0, 0.5]).xRange).toEqual([-8, 8]);
    });

    it("takes a matrix by its rows or flat, and leaves one that is neither as it was", () => {
        expect(readMatrix([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
        expect(readMatrix([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
        expect(readMatrix([1, 2, 3], [0, 1, 1, 0])).toEqual([0, 1, 1, 0]);
    });
});

describe("a warped map", () => {
    const warp = warpedMap(
        FLAT,
        (x, y, out) => {
            out.x = x + Math.sin(y);
            out.y = y + Math.sin(x);
            return true;
        },
        "wave",
    );

    it("sends a point where the warp does, and finds its way back", () => {
        near(warp.toPoint(1, 0), 100, Math.sin(1) * 100);
        const back = warp.toCoords(100, Math.sin(1) * 100);
        expect(back.x).toBeCloseTo(1, 5);
        expect(back.y).toBeCloseTo(0, 5);
    });

    it("draws a line through it as a run of points, where a flat map needs two", () => {
        expect(lineThrough(FLAT, -4, 1, 4, 1)).toHaveLength(2);
        const bent = lineThrough(warp, -4, 1, 4, 1);
        expect(bent.length).toBeGreaterThan(20);
        expect(new Set(bent.map((p) => Math.round(p.y))).size).toBeGreaterThan(5);
    });

    it("leaves a point the warp has no value at where it is", () => {
        const holed = warpedMap(FLAT, () => false, "none");
        near(holed.toPoint(2, 1), 200, 100);
    });
});

describe("a number plane's transformation", () => {
    const dot: Row = { id: "dot", type: "rect", parentId: "plane", props: { x: 1, y: 1, width: 10, height: 10 } };

    it("carries everything on the plane through its matrix", () => {
        const steps: Step[] = [{ type: "transformTo", targetId: "plane", args: { matrix: [[1, 1], [0, 1]] } }];
        const played = play(scene([PLANE, dot], steps));
        played.at(0);
        near(played.node("dot").global, 100, 100);
        played.at(0.5);
        near(played.node("dot").global, 150, 100);
        played.at(1);
        near(played.node("dot").global, 200, 100);
        const plane = played.node<NumberPlane>("plane");
        expect(planeMap(plotArea(plane.layoutBounds, plane.padding as InsetsResolved), plane as never).xRange).toEqual([-6, 6]);
    });

    it("bends toward a warp point by point, the same from a seek, and flattens again", () => {
        const steps: Step[] = [
            { type: "warpTo", targetId: "plane", args: { warp: "(x + sin(y), y)" } },
            { type: "warpTo", targetId: "plane", at: 1, args: { warp: "" } },
        ];
        const played = play(scene([PLANE, dot], steps));
        const shift = Math.sin(1) * 100;
        played.at(0.5);
        near(played.node("dot").global, 100 + shift / 2, 100);
        played.at(1);
        near(played.node("dot").global, 100 + shift, 100);
        played.at(1.5);
        near(played.node("dot").global, 100 + shift / 2, 100);
        played.at(2);
        near(played.node("dot").global, 100, 100);
        played.at(0.5);
        near(played.node("dot").global, 100 + shift / 2, 100);
    });

    it("keeps itself and what is on it inside its box while it is transformed, and not otherwise", () => {
        const flat = play(scene([PLANE]));
        flat.at(0);
        expect(flat.node<NumberPlane>("plane").clip).toBe(false);
        const sheared = play(scene([{ ...PLANE, props: { ...PLANE.props, matrix: [1, 1, 0, 1] } }]));
        sheared.at(0);
        expect(sheared.node<NumberPlane>("plane").clip).toBe(true);
        const open = play(scene([{ ...PLANE, props: { ...PLANE.props, matrix: [1, 1, 0, 1], clip: false } }]));
        open.at(0);
        expect(open.node<NumberPlane>("plane").clip).toBe(false);
    });

    it("leaves its flat self behind, faintly, only while it is transformed", () => {
        const lines = (props: Record<string, unknown>) => {
            const played = play(scene([{ ...PLANE, props: { ...PLANE.props, ...props } }]));
            return played.at(0).ops().filter((op) => op.kind === "line").length;
        };
        const flat = lines({});
        expect(lines({ matrix: [1, 1, 0, 1] })).toBeGreaterThan(flat);
        expect(lines({ matrix: [1, 1, 0, 1], ghost: false })).toBeLessThanOrEqual(lines({ matrix: [1, 1, 0, 1] }) - 5);
        expect(lines({ warp: "not a field" })).toBe(flat);
    });
});

describe("a polar plane", () => {
    const POLAR: Row = { id: "polar", type: "polarPlane", props: { width: 600, height: 400, radius: 4, labels: false } };

    it("has square units, its outer ring on the shorter side", () => {
        const played = play(scene([POLAR, { id: "dot", type: "rect", parentId: "polar", props: { x: 4, y: 2, width: 6, height: 6 } }]));
        played.at(0);
        near(played.node("dot").global, 200, 100);
    });

    it("keeps room for its angles when it writes them", () => {
        const labelled: Row = { ...POLAR, props: { ...POLAR.props, labels: true, labelSize: 20 } };
        const played = play(scene([labelled, { id: "dot", type: "rect", parentId: "polar", props: { x: 4, y: 0, width: 6, height: 6 } }]));
        played.at(0);
        expect(played.node("dot").global.x).toBeCloseTo(200 - 44, 6);
    });

    it("draws a ring at each step and a spoke at each division, and zooms by its radius", () => {
        const steps: Step[] = [{ type: "rangeTo", targetId: "polar", args: { radius: 8 } }];
        const played = play(scene([{ ...POLAR, props: { ...POLAR.props, ringStep: 1, spokes: 8 } }, { id: "dot", type: "rect", parentId: "polar", props: { x: 4, y: 0, width: 6, height: 6 } }], steps));
        const ops = played.at(0).ops();
        // Rings at 1, 2, 3 and the outer one; spokes off the axes at 45, 135, 225 and 315, and the two axes.
        expect(ops.filter((op) => op.kind === "ellipse")).toHaveLength(4);
        expect(ops.filter((op) => op.kind === "line")).toHaveLength(4 + 2);
        played.at(1);
        near(played.node("dot").global, 100, 0);
    });

    it("takes the plots and marks of a graph", () => {
        const played = play(scene([POLAR, { id: "rose", type: "functionPlot", parentId: "polar", props: { expression: "r = 4 cos(2theta)" } }]));
        played.at(0);
        const ink = inkOf(played.node("rose"));
        expect(ink.width).toBeCloseTo(400, 0);
        expect(ink.height).toBeCloseTo(400, 0);
    });
});

describe("an implicit plot", () => {
    it("is drawn where the equation holds", () => {
        const played = play(scene([AXES, { id: "c", type: "functionPlot", parentId: "axes", props: { expression: "x^2 + y^2 = 2.25" } }]));
        const recorder = played.at(0);
        const ink = inkOf(played.node("c"));
        expect(ink.width).toBeCloseTo(300, 0);
        expect(ink.height).toBeCloseTo(300, 0);
        const [circle] = pathPoints(recorder.ops());
        // One closed run, every point of it a radius of 150 px from the centre of its own box.
        for (const point of circle) expect(Math.hypot(point.x, point.y)).toBeCloseTo(150, 0);
        expect(circle[0]).toEqual(circle[circle.length - 1]);
    });

    it("changes over half way through a morph, having no parameter to bend along", () => {
        const steps: Step[] = [{ type: "morphTo", targetId: "c", args: { expression: "x^2 + y^2 = 1" } }];
        const played = play(scene([AXES, { id: "c", type: "functionPlot", parentId: "axes", props: { expression: "x^2 + y^2 = 4" } }], steps));
        played.at(0.25);
        expect(inkOf(played.node("c")).width).toBeCloseTo(400, 0);
        played.at(0.75);
        expect(inkOf(played.node("c")).width).toBeCloseTo(200, 0);
    });

    it("traces separate pieces as separate runs, and a saddle without crossing them", () => {
        const hyperbola = traceContour((x, y) => x * y - 1, [-4, 4], [-4, 4], 40, 40);
        expect(hyperbola).toHaveLength(2);
        for (const run of hyperbola) for (const p of run) expect(p.x * p.y).toBeCloseTo(1, 1);
        expect(traceContour(() => NaN, [-1, 1], [-1, 1], 8, 8)).toEqual([]);
    });
});

describe("a traced path", () => {
    const trail = (props: Record<string, unknown>): Row => ({ id: "t", type: "tracedPath", parentId: "axes", props: { expression: "(t, t / 2)", ...props } });

    it("is the curve from where its value began to where it is", () => {
        const played = play(scene([AXES, trail({ from: -1, value: "=[v]" })], [{ type: "variableTo", targetId: "v", args: { value: 3 } }], [{ id: "v", value: -1 }]));
        played.at(0);
        expect(inkOf(played.node("t")).width).toBeCloseTo(0, 6);
        played.at(0.5);
        expect(inkOf(played.node("t"))).toMatchObject({ width: 200, height: 100 });
        played.at(1);
        expect(inkOf(played.node("t")).width).toBeCloseTo(400, 6);
    });

    it("is drawn on by its own command, where no variable drives it", () => {
        const played = play(scene([AXES, trail({})], [{ type: "traceTo", targetId: "t", args: { value: 2 } }]));
        played.at(0.5);
        expect(inkOf(played.node("t")).width).toBeCloseTo(100, 6);
        played.at(1);
        expect(inkOf(played.node("t")).width).toBeCloseTo(200, 6);
    });

    it("keeps only its most recent stretch when it has a tail, whichever way the value runs", () => {
        const forward = play(scene([AXES, trail({ value: 3, tail: 1 })]));
        forward.at(0);
        expect(inkOf(forward.node("t"))).toMatchObject({ x: 250, width: 100 });
        const back = play(scene([AXES, trail({ value: -3, tail: 1 })]));
        back.at(0);
        expect(inkOf(back.node("t"))).toMatchObject({ x: -250, width: 100 });
    });
});

describe("a vector field", () => {
    const field = (props: Record<string, unknown>): Row => ({ id: "f", type: "vectorField", parentId: "axes", props: { expression: "(1, 0)", ...props } });

    it("draws an arrow centred on each point of its grid, as long as the field is strong", () => {
        const played = play(scene([AXES, field({ spacing: 1, arrowScale: 0.5 })]));
        const runs = pathPoints(played.at(0).ops());
        // 9 × 5 points, a shaft and a head each.
        expect(runs).toHaveLength(9 * 5 * 2);
        const [shaft, head] = runs;
        expect(shaft[1].x - shaft[0].x).toBeCloseTo(50, 6);
        expect(head).toHaveLength(3);
        expect(head[1]).toEqual(shaft[1]);
    });

    it("never draws an arrow longer than its spacing, and none where the field is at rest", () => {
        const long = play(scene([AXES, field({ expression: "(100, 0)", spacing: 2 })]));
        const [shaft] = pathPoints(long.at(0).ops());
        expect(shaft[1].x - shaft[0].x).toBeCloseTo(180, 6);
        const still = play(scene([AXES, field({ expression: "(0, 0)" })]));
        expect(pathPoints(still.at(0).ops())).toEqual([]);
    });

    it("turns each vector from one field into another", () => {
        const steps: Step[] = [{ type: "morphTo", targetId: "f", args: { expression: "(0, 1)" } }];
        const played = play(scene([AXES, field({ spacing: 4, arrowScale: 1 })], steps));
        const [shaft] = pathPoints(played.at(0.5).ops());
        expect(shaft[1].x - shaft[0].x).toBeCloseTo(50, 6);
        expect(shaft[1].y - shaft[0].y).toBeCloseTo(50, 6);
    });

    it("is one path in its stroke, or a few shades by strength with strength fills", () => {
        const stroked = (props: Record<string, unknown>) => {
            const ops = play(scene([AXES, field({ expression: "(x, 0)", ...props })])).at(0).ops();
            return ops.filter((op, i) => op.kind === "path" && ops.slice(i + 1).find((next) => next.kind !== "shadow")?.kind === "stroke").length;
        };
        expect(stroked({})).toBe(1);
        // Strengths 1, 2, 3 and 4 of a top of 4.
        expect(stroked({ strengthFills: ["#000", "#fff"] })).toBe(4);
    });

    it("casts its shadow from every shade, as from its one path", () => {
        const shadow = { fill: "#000", blur: 4, offset: { x: 0, y: 2 } };
        // A shadow is cast by the paint op after it; one before an empty fill casts nothing.
        const shadowed = (props: Record<string, unknown>) => {
            const ops = play(scene([AXES, field({ expression: "(x, 0)", shadow, ...props })])).at(0).ops();
            return ops.filter((op, i) => op.kind === "shadow" && ops[i - 1]?.kind === "path" && ops[i + 1]?.kind === "stroke").length;
        };
        expect(shadowed({})).toBe(1);
        expect(shadowed({ strengthFills: ["#000", "#fff"] })).toBe(4);
    });

    it("widens its spacing rather than draw more arrows than can be read", () => {
        const dense = play(scene([AXES, field({ spacing: 0.01 })]));
        expect(pathPoints(dense.at(0).ops()).length).toBeLessThanOrEqual(2400 * 2);
    });
});

describe("stream lines", () => {
    const lines = (props: Record<string, unknown>): Row => ({ id: "s", type: "streamLines", parentId: "axes", props: { expression: "(-y, x)", spacing: 1, ...props } });

    it("follow the field: a turning one in circles about its centre", () => {
        const played = play(scene([AXES, lines({ length: 2 })]));
        const node = played.node<Node2D>("s");
        const runs = pathPoints(played.at(0).ops());
        expect(runs.length).toBeGreaterThan(20);
        const ink = inkOf(node);
        // A run is in pixels from its node's own centre: back to graph units about the origin.
        const radius = (p: Vector2) => Math.hypot(p.x + ink.x, p.y + ink.y) / 100;
        for (const run of runs.slice(0, 12)) {
            for (const p of run) expect(radius(p)).toBeCloseTo(radius(run[0]), 1);
        }
    });

    it("show a stretch of each line, which flowTo sends along it", () => {
        const steps: Step[] = [{ type: "flowTo", targetId: "s", args: { phase: 1 } }];
        const played = play(scene([AXES, lines({ expression: "(1, 0)", length: 2, window: 0.25 })], steps));
        const points = (time: number) => pathPoints(played.at(time).ops()).reduce((sum, run) => sum + run.length, 0);
        const whole = pathPoints(play(scene([AXES, lines({ expression: "(1, 0)", length: 2 })])).at(0).ops()).reduce((sum, run) => sum + run.length, 0);
        expect(points(0.3)).toBeLessThan(whole / 2);
        expect(points(0.3)).toBeGreaterThan(0);
        // The same frame however it is reached.
        const before = JSON.stringify(pathPoints(played.at(0.3).ops()));
        played.at(0.9);
        expect(JSON.stringify(pathPoints(played.at(0.3).ops()))).toBe(before);
    });

    it("stop where the field is at rest or has no value", () => {
        const played = play(scene([AXES, lines({ expression: "(0, 0)" })]));
        expect(pathPoints(played.at(0).ops())).toEqual([]);
    });
});

describe("a field's equation", () => {
    it("is two parts in x and y, with any other name a value of the author's own", () => {
        expect(parseField("(-y, x)")).not.toBeInstanceOf(Error);
        expect(fieldError("")).toBeNull();
        expect(fieldError("x + y")).toMatch(/two parts/);
        expect(fieldError("(x, y, 1)")).toMatch(/two parts/);
        expect(fieldParams("(a * y, -b * x)")).toEqual(["a", "b"]);
        expect(fieldError("(a * y, -b * x)")).toBeNull();
    });

    it("is the kind a field and a plane's warp declare, so a host checks it as one", () => {
        expect(registry.describe("vectorField")!.properties!.expression.kind).toBe("fieldEquation");
        expect(registry.describe("streamLines")!.properties!.expression.kind).toBe("fieldEquation");
        expect(registry.describe("numberPlane")!.properties!.warp.kind).toBe("fieldEquation");
        expect(EQUATION_KINDS.fieldEquation.error("(sin(y), cos(x))")).toBeNull();
        expect(EQUATION_KINDS.fieldEquation.error("sin(x)")).not.toBeNull();
    });
});
