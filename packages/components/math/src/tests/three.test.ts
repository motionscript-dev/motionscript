import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateParametric, Graphics3D, Registry, Scene3D, type Geometry3D, type Node3D, type Scene3DOp, type Vector3 } from "@motionscript/sdk";
import { AssetDeclaration, ManifestAssetCatalog } from "@motionscript/core";
import { EQUATION_KINDS, parseSpaceCurve, parseSurface, spaceCurveError, surfaceError, surfaceParams } from "../kit/equation3d";
import { NODES } from "../nodes";
import { aim, graphSpace } from "../three/space";
import { PLOT_COLOR } from "../kit/furniture";
import { CurvePlot3d } from "../three/curve-plot3d";
import { SurfacePlot3d } from "../three/surface-plot3d";
import { play, scene, type Row, type Step } from "./harness";

type ParametricGeometry3D = Extract<Geometry3D, { type: "parametric" }>;

const registry = new Registry({ nodes: NODES });

/** Axes twice as long as they are wide in graph units on x, and one to one on y and z. */
const AXES: Row = {
    id: "axes",
    type: "axes3d",
    props: { width: 800, height: 600, xRange: [-3, 3], yRange: [-3, 3], zRange: [-2, 2], xLength: 12, yLength: 6, zLength: 4 },
};

/** The scene a viewport records this frame. */
function sceneOf(view: unknown): Scene3D {
    return (view as { _scene3D(): Scene3D })._scene3D();
}

function recorded(rows: Row[], steps: Step[] = [], at = 0): { ops: readonly Scene3DOp[]; node(id: string): Node3D } {
    const played = play(scene([AXES, ...rows], steps));
    played.at(at);
    return { ops: sceneOf(played.node("axes")).ops(), node: (id) => played.node(id) as unknown as Node3D };
}

/** What the axes drew themselves: the drawing outside every child's group. */
function furniture(ops: readonly Scene3DOp[]): Scene3DOp[] {
    let depth = 0;
    return ops.filter((op) => {
        if (op.kind === "push") depth++;
        else if (op.kind === "pop") depth--;
        return depth === 0 && ["mesh", "instances", "sprite", "line"].includes(op.kind);
    });
}

/** What the node `id` drew itself, and where its group was put. */
function drawnBy(ops: readonly Scene3DOp[], id: string): { position: Vector3; own: Scene3DOp[] } {
    const start = ops.findIndex((op) => op.kind === "push" && op.transform?.key === id);
    expect(start, id).toBeGreaterThanOrEqual(0);
    const own: Scene3DOp[] = [];
    for (let i = start + 1; i < ops.length && ops[i].kind !== "push" && ops[i].kind !== "pop"; i++) own.push(ops[i]);
    return { position: (ops[start] as Extract<Scene3DOp, { kind: "push" }>).transform!.position as Vector3, own };
}

const image = (src: string) => ({ src, width: 8, height: 8, sizeBytes: 0 });
const catalog = new ManifestAssetCatalog({ image: { "skin.png": image("skin.png"), "bumps.png": image("bumps.png") }, video: {}, audio: {}, font: {} });

/** The images `node` declares, sorted. */
function imagesDeclared(node: Node3D): string[] {
    const scope = new AssetDeclaration(catalog);
    node.declareAssets(scope);
    return [...scope.declarations.values()].filter((decl) => decl.type === "image").map((decl) => decl.src).sort();
}

afterEach(() => {
    vi.restoreAllMocks();
});

function surfaceOf(own: Scene3DOp[]): ParametricGeometry3D {
    const mesh = own.find((op) => op.kind === "mesh") as Extract<Scene3DOp, { kind: "mesh" }>;
    expect(mesh.geometry.type).toBe("parametric");
    return mesh.geometry as ParametricGeometry3D;
}

describe("a 3D graph's coordinates", () => {
    const space = graphSpace([-3, 3], [-3, 3], [-2, 2], { x: 6, y: 6, z: 4 });

    it("put z up and keep the graph right-handed", () => {
        const origin = space.toLocal(0, 0, 0);
        const x = space.offset(1, 0, 0);
        const y = space.offset(0, 1, 0);
        const z = space.offset(0, 0, 1);
        expect(origin).toEqual({ x: 0, y: 0, z: 0 });
        expect(z).toEqual({ x: 0, y: 1, z: 0 });
        const cross = { x: x.y * y.z - x.z * y.y, y: x.z * y.x - x.x * y.z, z: x.x * y.y - x.y * y.x };
        expect(cross).toEqual(z);
    });

    it("centre the box on the node, whatever the ranges", () => {
        const lifted = graphSpace([0, 4], [0, 2], [0, 10], { x: 4, y: 4, z: 5 });
        expect(lifted.toLocal(2, 1, 5)).toEqual({ x: 0, y: 0, z: 0 });
        expect(lifted.toLocal(4, 2, 10)).toEqual({ x: 2, y: 2.5, z: 2 });
    });

    it("aim a shape built along +y at any direction", () => {
        const turned = (direction: Vector3): Vector3 => {
            const q = aim(direction);
            // +y rotated by q.
            return { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) };
        };
        for (const direction of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: -1, z: 0 }, { x: 0.6, y: 0, z: 0.8 }]) {
            const got = turned(direction);
            for (const key of ["x", "y", "z"] as const) expect(got[key]).toBeCloseTo(direction[key], 9);
        }
    });
});

describe("3D axes", () => {
    it("place any child in graph units, by its position only", () => {
        const { ops, node } = recorded([{ id: "ball", type: "sphere3d", parentId: "axes", props: { x: 1, y: 2, z: 0.5, scaleX: 3 } }]);
        expect(drawnBy(ops, "ball").position).toEqual({ x: 2, y: 0.5, z: 2 });
        expect((node("ball") as unknown as { scaleX: number }).scaleX).toBe(3);
    });

    it("carry what is in them when the range moves", () => {
        const steps: Step[] = [{ type: "rangeTo", targetId: "axes", args: { xRange: [-6, 6] } }];
        const { ops } = recorded([{ id: "ball", type: "sphere3d", parentId: "axes", props: { x: 3 } }], steps, 1);
        expect(drawnBy(ops, "ball").position).toEqual({ x: 0, y: 0, z: 3 });
    });

    it("draw three lines with tips, their ticks in one draw, and a title for each", () => {
        const own = furniture(recorded([]).ops);
        const meshes = own.filter((op) => op.kind === "mesh") as Extract<Scene3DOp, { kind: "mesh" }>[];
        expect(meshes.map((op) => op.geometry.type)).toEqual(["cylinder", "cone", "cylinder", "cone", "cylinder", "cone"]);
        expect(own.filter((op) => op.kind === "instances")).toHaveLength(1);
        expect(own.filter((op) => op.kind === "sprite")).toHaveLength(3);
    });

    it("rasterize each title once, one card per text", () => {
        const maps = (ops: readonly Scene3DOp[]) => furniture(ops)
            .filter((op): op is Extract<Scene3DOp, { kind: "sprite" }> => op.kind === "sprite")
            .map((op) => (op.material as { map?: { static?: boolean; identity?: string } }).map!);
        const cards = maps(recorded([]).ops);
        expect(cards.every((map) => map.static === true)).toBe(true);
        expect(new Set(cards.map((map) => map.identity)).size).toBe(3);
        expect(maps(recorded([]).ops)).toEqual(cards);
    });

    it("number the ticks and rule the plane of x and y only when asked", () => {
        const bare = furniture(recorded([]).ops);
        expect(bare.some((op) => op.kind === "line")).toBe(false);
        const full: Row = { ...AXES, props: { ...AXES.props, labels: true, grid: true, xLabel: "", yLabel: "", zLabel: "" } };
        const played = play(scene([full]));
        played.at(0);
        const own = furniture(sceneOf(played.node("axes")).ops());
        const ruled = own.find((op) => op.kind === "line") as Extract<Scene3DOp, { kind: "line" }>;
        const heights = Array.from((ruled.geometry as { position: ArrayLike<number> }).position).filter((_, i) => i % 3 === 1);
        // Where the axes cross: the graph's z = 0, which is the middle of this box.
        expect(new Set(heights)).toEqual(new Set([0]));
        // The crossing and the tipped end go unmarked: x is twice as long, so it is marked every half.
        expect(own.filter((op) => op.kind === "sprite")).toHaveLength(11 + 5 + 3);
    });
});

describe("a surface", () => {
    const at = (geometry: ParametricGeometry3D, u: number, v: number): Vector3 => geometry.vertex(u, v) as Vector3;

    it("is a height over the axes' x and y, in their units", () => {
        const { ops } = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "x + y / 2" } }]);
        const geometry = surfaceOf(drawnBy(ops, "s").own);
        // Graph (3, -3, 1.5): x is doubled along the scene's z, y runs along its x, and the height is its y.
        expect(at(geometry, 1, 0)).toEqual({ x: -3, y: 1.5, z: 6 });
        expect(at(geometry, 0.5, 0.5)).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("is held inside the axes where it would leave them, and flat where it has no value", () => {
        const { ops } = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "10 / x" } }]);
        const geometry = surfaceOf(drawnBy(ops, "s").own);
        expect(at(geometry, 0.75, 0.5).y).toBe(2);
        expect(at(geometry, 0.25, 0.5).y).toBe(-2);
        const { ops: holed } = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "sqrt(x)" } }]);
        expect(at(surfaceOf(drawnBy(holed, "s").own), 0, 0.5).y).toBe(0);
    });

    it("is three parts in u and v when written as three", () => {
        const props = { expression: "(u, v, u * v)", uDomain: [0, 2], vDomain: [0, 2] };
        const { ops } = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props }]);
        expect(at(surfaceOf(drawnBy(ops, "s").own), 1, 0.5)).toEqual({ x: 1, y: 2, z: 4 });
    });

    it("bends from one equation into another, the same from a seek", () => {
        const steps: Step[] = [{ type: "morphTo", targetId: "s", args: { expression: "2" } }];
        const rows: Row[] = [{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "0" } }];
        const half = at(surfaceOf(drawnBy(recorded(rows, steps, 0.5).ops, "s").own), 0.5, 0.5);
        expect(half.y).toBeCloseTo(1, 9);
        expect(at(surfaceOf(drawnBy(recorded(rows, steps, 1).ops, "s").own), 0.5, 0.5).y).toBe(2);
    });

    it("re-evaluates only when what it draws changes", () => {
        const rows: Row[] = [{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "a * x" } }];
        const steps: Step[] = [{ type: "paramsTo", targetId: "s", args: { params: { a: 2 } }, at: 1 }];
        const revision = (time: number) => surfaceOf(drawnBy(recorded(rows, steps, time).ops, "s").own).revision;
        expect(revision(0)).toBe(revision(0.5));
        expect(revision(1.5)).not.toBe(revision(0));
    });

    it("is coloured by height over the axes' z range when given a scale", () => {
        const plain = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "x" } }]);
        expect(surfaceOf(drawnBy(plain.ops, "s").own).color).toBeUndefined();
        const props = { expression: "x", colorScale: ["#000000", "#ffffff"], meshLines: 0 };
        const { own } = drawnBy(recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props }]).ops, "s");
        const mesh = own.find((op) => op.kind === "mesh") as Extract<Scene3DOp, { kind: "mesh" }>;
        expect(mesh.material).toMatchObject({ vertexColors: true, faces: "both" });
        const colours = evaluateParametric({ ...surfaceOf(own), segments: 2 }).color!;
        // Three columns of x: -3, 0 and 3, held at the range's -2 and 2.
        expect([colours[0], colours[3], colours[6]].map((value) => Number(value.toFixed(3)))).toEqual([0, 0.214, 1]);
    });

    it("draws its mesh lines on top, and none when there are none", () => {
        const lined = drawnBy(recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "x", meshLines: 4, segments: 8 } }]).ops, "s").own;
        const line = lined.find((op) => op.kind === "line") as Extract<Scene3DOp, { kind: "line" }>;
        // Five lines each way, eight pieces each, two ends a piece.
        expect((line.geometry as { position: ArrayLike<number> }).position.length / 3).toBe(5 * 8 * 2 * 2);
        expect(lined.find((op) => op.kind === "mesh")).toMatchObject({ material: { polygonOffset: true } });
        const bare = drawnBy(recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "x", meshLines: 0 } }]).ops, "s").own;
        expect(bare.some((op) => op.kind === "line")).toBe(false);
    });

    it("lays a shadow on the floor, coloured by the height above it, only when asked", () => {
        const meshes = (props: Record<string, unknown>) =>
            drawnBy(recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props }]).ops, "s").own
                .filter((op): op is Extract<Scene3DOp, { kind: "mesh" }> => op.kind === "mesh");
        const props = { expression: "x", colorScale: ["#000000", "#ffffff"], meshLines: 0 };
        expect(meshes(props)).toHaveLength(1);
        const [surface, shadow] = meshes({ ...props, floorShadow: 0.3 });
        expect(shadow.material).toMatchObject({ type: "basic", vertexColors: true, opacity: 0.3, depthWrite: false });
        const flat = evaluateParametric({ ...(shadow.geometry as ParametricGeometry3D), segments: 2 });
        const heights = Array.from({ length: flat.position.length / 3 }, (_, i) => flat.position[i * 3 + 1]);
        // The floor is the bottom of the z range, which is 2 below the axes' middle.
        expect(new Set(heights)).toEqual(new Set([-2]));
        const lit = evaluateParametric({ ...(surface.geometry as ParametricGeometry3D), segments: 2 });
        expect(Array.from(flat.color!)).toEqual(Array.from(lit.color!));
    });

    it("declares the textures it is painted with, without sampling its equation", () => {
        const props = { expression: "x", fill: "skin.png", normalMap: "bumps.png", meshLines: 6 };
        const { node } = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props }]);
        const lines = vi.spyOn(Graphics3D.prototype, "line");
        expect(imagesDeclared(node("s"))).toEqual(["bumps.png", "skin.png"]);
        expect(lines).not.toHaveBeenCalled();
        // A scale paints the surface white, so its fill's image is never drawn.
        const scaled = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { ...props, colorScale: ["#000000", "#ffffff"] } }]);
        expect(imagesDeclared(scaled.node("s"))).toEqual(["bumps.png"]);
    });

    it("carries a point put inside it at its own height", () => {
        const rows: Row[] = [
            { id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "x + y / 2" } },
            { id: "p", type: "plotPoint3d", parentId: "s", props: { x: 1, y: 2, z: -9 } },
            { id: "free", type: "plotPoint3d", parentId: "axes", props: { x: 1, y: 2, z: 1 } },
        ];
        const { ops } = recorded(rows);
        expect(drawnBy(ops, "p").position).toEqual({ x: 2, y: 2, z: 2 });
        expect(drawnBy(ops, "free").position).toEqual({ x: 2, y: 1, z: 2 });
    });

    it("draws nothing outside a graph, or from an equation that will not parse", () => {
        const view: Row = { id: "view", type: "canvas3d", props: { width: 800, height: 600 } };
        const loose = play(scene([view, { id: "s", type: "surfacePlot3d", parentId: "view", props: { expression: "x" } }]));
        loose.at(0);
        const recording = new Scene3D();
        (loose.node("s") as unknown as Node3D).render(recording);
        expect(recording.ops().some((op) => op.kind === "mesh")).toBe(false);
        const broken = recorded([{ id: "s", type: "surfacePlot3d", parentId: "axes", props: { expression: "x +" } }]);
        expect(drawnBy(broken.ops, "s").own).toEqual([]);
    });
});

describe("a space curve", () => {
    const tube = (own: Scene3DOp[]) => (own.find((op) => op.kind === "mesh") as Extract<Scene3DOp, { kind: "mesh" }>).geometry as { type: string; points: Vector3[] };

    it("is a tube through the points of its three parts", () => {
        const props = { expression: "(t, 2t, t / 2)", domain: [0, 1], samples: 4 };
        const { own } = drawnBy(recorded([{ id: "c", type: "curvePlot3d", parentId: "axes", props }]).ops, "c");
        expect(tube(own).type).toBe("tube");
        expect(tube(own).points).toHaveLength(5);
        expect(tube(own).points[4]).toEqual({ x: 2, y: 0.5, z: 2 });
    });

    it("declares the textures it is painted with", () => {
        const { node } = recorded([{ id: "c", type: "curvePlot3d", parentId: "axes", props: { expression: "(cos(t), sin(t), t)", fill: "skin.png" } }]);
        expect(imagesDeclared(node("c"))).toEqual(["skin.png"]);
    });

    it("is drawn on by its progress", () => {
        const rows: Row[] = [{ id: "c", type: "curvePlot3d", parentId: "axes", props: { expression: "(t, 0, 0)", samples: 10, end: 0 } }];
        const steps: Step[] = [{ type: "progressTo", targetId: "c", args: { end: 1 } }];
        expect(drawnBy(recorded(rows, steps, 0).ops, "c").own).toEqual([]);
        const half = tube(drawnBy(recorded(rows, steps, 0.5).ops, "c").own).points;
        expect(half).toHaveLength(6);
        expect(half[5].z).toBeCloseTo(1, 9);
    });

    it("leaves out the points it has no value at", () => {
        const props = { expression: "(t, 0, sqrt(t))", domain: [-1, 1], samples: 4 };
        const { own } = drawnBy(recorded([{ id: "c", type: "curvePlot3d", parentId: "axes", props }]).ops, "c");
        expect(tube(own).points).toHaveLength(3);
    });
});

describe("a 3D arrow", () => {
    it("is a shaft and a tip from tail to head, in graph units", () => {
        const props = { tail: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 2 }, thickness: 0.05 };
        const { own } = drawnBy(recorded([{ id: "v", type: "vectorArrow3d", parentId: "axes", props }]).ops, "v");
        const [shaft, tip] = own as Extract<Scene3DOp, { kind: "mesh" }>[];
        expect([shaft.geometry.type, tip.geometry.type]).toEqual(["cylinder", "cone"]);
        expect(shaft.transform?.position).toEqual({ x: 0, y: 0.8, z: 0 });
        expect(tip.transform?.position).toEqual({ x: 0, y: 1.8, z: 0 });
    });

    it("moves either end, and draws nothing with no length", () => {
        const rows: Row[] = [{ id: "v", type: "vectorArrow3d", parentId: "axes", props: { head: { x: 0, y: 0, z: 0 } } }];
        const steps: Step[] = [{ type: "endpointsTo", targetId: "v", args: { head: { x: 0, y: 2, z: 0 } } }];
        expect(drawnBy(recorded(rows, steps, 0).ops, "v").own).toEqual([]);
        const [, tip] = drawnBy(recorded(rows, steps, 1).ops, "v").own as Extract<Scene3DOp, { kind: "mesh" }>[];
        expect((tip.transform?.position as Vector3).x).toBeGreaterThan(1.5);
    });
});

describe("3D equations", () => {
    it("read a height, written bare or as z =", () => {
        const bare = parseSurface("x * y");
        const stated = parseSurface("z = x * y");
        expect(bare).toMatchObject({ kind: "height" });
        expect(bare).toBe(parseSurface("x * y"));
        expect(stated).toMatchObject({ kind: "height" });
    });

    it("say why a surface or a curve will not draw", () => {
        expect(surfaceError("")).toBeNull();
        expect(surfaceError("(u, v)")).toMatch(/three parts/);
        expect(surfaceError("y = x")).toMatch(/z =/);
        expect(spaceCurveError("cos(t)")).toMatch(/three parts/);
        expect(spaceCurveError("(cos(t), sin(t), t)")).toBeNull();
        expect(parseSpaceCurve("(t, t, x)")).toBeInstanceOf(Error);
    });

    it("tell a host how to check each kind of equation a property declares", () => {
        const kinds = Object.fromEntries(
            ["functionPlot", "surfacePlot3d", "curvePlot3d", "vectorField"].map((key) => [key, registry.describe(key)!.properties!.expression.kind]),
        );
        expect(kinds).toEqual({
            functionPlot: "equation",
            surfacePlot3d: "surfaceEquation",
            curvePlot3d: "spaceCurveEquation",
            vectorField: "fieldEquation",
        });
        expect(Object.keys(EQUATION_KINDS).sort()).toEqual(Object.values(kinds).sort());
        expect(EQUATION_KINDS.surfaceEquation.params("a * u + v")).toEqual(["a"]);
        expect(EQUATION_KINDS.equation.params("a * u + v")).toEqual(["a", "u", "v"]);
        expect(EQUATION_KINDS.spaceCurveEquation.error("sin(t)")).not.toBeNull();
    });

    it("take any other name as a named value", () => {
        expect(surfaceParams("a * sin(x) + b * y")).toEqual(["a", "b"]);
        expect(surfaceError("a * sin(x) + b * y")).toBeNull();
    });
});

describe("a 3D plot as a host builds it", () => {
    // The classes set their colour in their constructors, which their descriptions never said: a host started them white.
    it("paints a surface and a curve in the plot colour, unset or from their described default", () => {
        const registry = new Registry({ nodes: NODES });
        for (const [key, Plot] of [["surfacePlot3d", SurfacePlot3d], ["curvePlot3d", CurvePlot3d]] as const) {
            expect(new Plot({}).fill, key).toBe(PLOT_COLOR);
            expect(new Plot({ fill: "red" }).fill, key).toBe("red");
            expect(registry.describe(key)!.properties!.fill.default, key).toBe(PLOT_COLOR);
        }
    });
});
