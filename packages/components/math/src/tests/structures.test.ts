import { describe, expect, it } from "vitest";
import type { GraphicsOp } from "@motionscript/sdk";
import { layOut } from "../structures/graph-layout";
import { vertexPoints, type NetworkGraph } from "../structures/network-graph";
import { sampleParts, type SampleSpace } from "../structures/sample-space";
import { play, scene, type Row, type Step } from "./harness";

const EDGES = [
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "b", to: "e" },
];
const GRAPH: Row = {
    id: "g",
    type: "networkGraph",
    props: { width: 400, height: 300, vertexRadius: 10, labelSize: 10, vertices: ["a", "b", "c", "d", "e"], edges: EDGES },
};

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const pointsOf = (graph: NetworkGraph) => vertexPoints(graph, graph.layoutBounds);
const partsOf = (space: SampleSpace) => sampleParts(space, space.layoutBounds);

describe("a graph's layouts", () => {
    const names = ["a", "b", "c", "d", "e"];

    it("puts the vertices round a circle from the top, clockwise", () => {
        const placed = layOut("circular", names, EDGES, "");
        near(placed.get("a")!.x, 0);
        near(placed.get("a")!.y, 1);
        expect(placed.get("b")!.x).toBeGreaterThan(0);
        for (const p of placed.values()) near(Math.hypot(p.x, p.y), 1);
    });

    it("hangs a tree from its root, a level down for each step away, a parent over its children", () => {
        const placed = layOut("tree", names, EDGES, "a");
        expect(placed.get("a")!.y).toBe(1);
        expect(placed.get("b")!.y).toBe(placed.get("c")!.y);
        expect(placed.get("d")!.y).toBe(-1);
        near(placed.get("b")!.x, (placed.get("d")!.x + placed.get("e")!.x) / 2);
        // Another root turns it over.
        expect(layOut("tree", names, EDGES, "e").get("e")!.y).toBe(1);
    });

    it("springs to the same place every time, linked vertices nearer than unlinked ones", () => {
        const once = layOut("spring", names, EDGES, "");
        expect(layOut("spring", names, EDGES, "")).toEqual(once);
        const gap = (u: string, v: string) => Math.hypot(once.get(u)!.x - once.get(v)!.x, once.get(u)!.y - once.get(v)!.y);
        expect(gap("b", "d")).toBeLessThan(gap("c", "d"));
    });

    it("lays a grid in rows from the top left, and a lone vertex in the middle", () => {
        const placed = layOut("grid", names, [], "");
        expect(placed.get("a")).toEqual({ x: -1, y: 1 });
        expect(placed.get("d")).toEqual({ x: -1, y: -1 });
        expect(layOut("spring", ["x"], [], "")).toEqual(new Map([["x", { x: 0, y: 0 }]]));
    });
});

describe("a network graph", () => {
    it("keeps a blank or repeated entry an editor just added, and draws only what is complete", () => {
        const played = play(scene([{
            ...GRAPH,
            props: {
                ...GRAPH.props,
                vertices: ["a", "b", "", "a "],
                edges: [{ from: "a", to: "b" }, { from: "", to: "" }],
                positions: [{ vertex: "", x: 0, y: 0 }],
                partFills: [{ part: "", fill: "#ff0000" }],
            },
        }]));
        const ops = played.at(0).ops();
        const graph = played.node<NetworkGraph>("g");
        expect(graph.vertices).toEqual(["a", "b", "", "a "]);
        expect(graph.edges).toEqual([{ from: "a", to: "b" }, { from: "", to: "" }]);
        expect(graph.positions).toHaveLength(1);
        expect(graph.partFills).toHaveLength(1);
        expect([...pointsOf(graph).keys()]).toEqual(["a", "b"]);
        expect(ops.filter((op) => op.kind === "line")).toHaveLength(1);
        expect(ops.filter((op) => op.kind === "ellipse")).toHaveLength(2);
    });

    it("fits its layout to its box, short of the vertices' own size", () => {
        const played = play(scene([GRAPH]));
        played.at(0);
        const points = pointsOf(played.node<NetworkGraph>("g"));
        // Room for a vertex and its label: 10 px and 2 more.
        near(points.get("a")!.y, 150 - 12);
    });

    it("moves each vertex from one arrangement to the next, the same from a seek", () => {
        const steps: Step[] = [{ type: "arrangeTo", targetId: "g", args: { arrangement: "grid" } }];
        const played = play(scene([GRAPH], steps));
        played.at(1);
        const grid = pointsOf(played.node<NetworkGraph>("g")).get("a")!;
        played.at(0);
        const circle = pointsOf(played.node<NetworkGraph>("g")).get("a")!;
        played.at(0.5);
        const half = pointsOf(played.node<NetworkGraph>("g")).get("a")!;
        near(half.x, (circle.x + grid.x) / 2);
        near(half.y, (circle.y + grid.y) / 2);
        expect(played.node<NetworkGraph>("g").arrangement).toBe("grid");
    });

    it("draws a line per edge from rim to rim, and a disc and a name per vertex", () => {
        const played = play(scene([GRAPH]));
        const ops = played.at(0).ops();
        const lines = ops.filter((op) => op.kind === "line");
        expect(lines).toHaveLength(EDGES.length);
        const [first] = lines as Extract<GraphicsOp, { kind: "line" }>[];
        const points = pointsOf(played.node<NetworkGraph>("g"));
        const [start] = first.state.points as { x: number; y: number }[];
        near(Math.hypot(start.x - points.get("a")!.x, start.y - points.get("a")!.y), 10);
        expect(ops.filter((op) => op.kind === "ellipse")).toHaveLength(5);
        expect(ops.filter((op) => op.kind === "text")).toHaveLength(5);
    });

    it("draws each directed edge on its own, ending in an arrowhead, and an edge both ways as two bows", () => {
        const both: Row = { ...GRAPH, props: { ...GRAPH.props, directed: true, edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] } };
        const ops = play(scene([both])).at(0).ops();
        const strokes = ops.filter((op) => op.kind === "stroke") as Extract<GraphicsOp, { kind: "stroke" }>[];
        expect(strokes).toHaveLength(2);
        for (const stroke of strokes) expect((stroke.strokes as { endCap?: string }[])[0].endCap).toBe("triangle");
        const runs = ops.filter((op) => op.kind === "line") as Extract<GraphicsOp, { kind: "line" }>[];
        for (const run of runs) expect((run.state.points as unknown[]).length).toBeGreaterThan(2);
    });

    it("paints a vertex by its name and an edge as a-b, arriving over its own paint", () => {
        const steps: Step[] = [
            { type: "partFillTo", targetId: "g", args: { part: "b", fill: "#ff0000" } },
            { type: "partFillTo", targetId: "g", at: 1, args: { part: "b-a", fill: "#00ff00" } },
        ];
        const played = play(scene([{ ...GRAPH, props: { ...GRAPH.props, fill: "#000000" } }], steps));
        type Layer = { color: number[]; opacity?: number };
        const fills = (time: number) =>
            played.at(time).ops().flatMap((op) => (op.kind === "fill" ? [(op as { fills: Layer[] }).fills] : []));
        expect(fills(1)).toContainEqual([expect.objectContaining({ color: [1, 0, 0, 1] })]);
        // Half way the red is laid over the vertex's black at half strength.
        expect(fills(0.5)).toContainEqual([
            expect.objectContaining({ color: [0, 0, 0, 1] }),
            expect.objectContaining({ color: [1, 0, 0, 1], opacity: 0.5 }),
        ]);
        const ops = played.at(2).ops();
        const coloured = ops.filter((op) => op.kind === "stroke" && JSON.stringify(op).includes("[0,1,0,1]"));
        expect(coloured).toHaveLength(1);
    });

    it("places a vertex by hand where it is told, whatever the arrangement", () => {
        const placed: Row = { ...GRAPH, props: { ...GRAPH.props, positions: [{ vertex: "c", x: 1, y: -1 }] } };
        const played = play(scene([placed]));
        played.at(0);
        const c = pointsOf(played.node<NetworkGraph>("g")).get("c")!;
        near(c.x, 200 - 12);
        near(c.y, -150 + 12);
    });
});

describe("a sample space", () => {
    const SPACE: Row = { id: "s", type: "sampleSpace", props: { width: 400, height: 300, columnShares: [1, 3], rowShares: [0.5] } };

    it("cuts its box into parts whose areas are their probabilities", () => {
        const played = play(scene([SPACE]));
        played.at(0);
        const parts = partsOf(played.node<SampleSpace>("s"));
        expect(parts.map((part) => part.probability)).toEqual([0.125, 0.125, 0.75]);
        expect(parts.map((part) => part.width)).toEqual([100, 100, 300]);
        expect(parts[0]).toMatchObject({ y: 75, height: 150, upper: true });
        const area = parts.reduce((sum, part) => sum + part.width * part.height, 0);
        for (const part of parts) near((part.width * part.height) / area, part.probability);
    });

    it("moves its cuts, one share at a time", () => {
        const steps: Step[] = [{ type: "divideTo", targetId: "s", args: { columnShares: [3, 1], rowShares: [1] } }];
        const played = play(scene([SPACE], steps));
        played.at(0.5);
        const parts = partsOf(played.node<SampleSpace>("s"));
        expect(parts[0].width).toBe(200);
        near(parts[0].probability, 0.375);
    });

    it("keeps room below and on the left for the braces that name its parts", () => {
        const named: Row = { ...SPACE, props: { ...SPACE.props, columnLabels: ["A", "not A"], rowLabels: ["B", "not B"], labelSize: 20 } };
        const played = play(scene([named]));
        const ops = played.at(0).ops();
        const parts = partsOf(played.node<SampleSpace>("s"));
        expect(parts.reduce((sum, part) => sum + (part.upper ? part.width : 0), 0)).toBeCloseTo(400 - 20 * 2.6 * 1.6, 6);
        // Two under the columns and two beside the first column.
        expect(ops.filter((op) => op.kind === "path")).toHaveLength(4);
        expect(ops.filter((op) => op.kind === "text")).toHaveLength(4);
    });

    it("writes each part's probability when asked", () => {
        const played = play(scene([{ ...SPACE, props: { ...SPACE.props, values: true } }]));
        const texts = played.at(0).ops().filter((op) => op.kind === "text") as { state: { text: string } }[];
        expect(texts.map((op) => op.state.text)).toEqual(["0.125", "0.125", "0.75"]);
    });
});
