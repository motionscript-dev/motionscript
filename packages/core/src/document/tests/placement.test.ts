import { describe, expect, it } from "vitest";

import { Node2D } from "@/components/trees/2d/node2d";
import { component2d } from "@/components/factory/component2d";
import { node } from "../node-decorator";
import { nodeTypeIsA, parentIssue, placementIssues, siblingIssue } from "../placement";
import { Registry } from "../registry";

class Graph extends Node2D {}
node({ key: "graph", layout: { acceptsChildren: true } })(Graph);

class BigGraph extends Graph {}
node({ key: "bigGraph", parentKey: "graph", layout: { acceptsChildren: true } })(BigGraph);

/** Goes in a graph, and takes only what is made for it. */
class Curve extends Node2D {}
node({ key: "curve", within: ["graph"], closed: true, layout: { acceptsChildren: true } })(Curve);

class Tangent extends Node2D {}
node({ key: "tangent", within: ["curve"], layout: { acceptsChildren: false } })(Tangent);

/** Sits beside the curves it reads rather than inside one of them. */
class Region extends Node2D {}
node({ key: "region", within: ["graph"], beside: ["curve"] })(Region);

/** A viewport of its own: a 2D component that takes 3D children, as a 3D graph does. */
const Plot3 = component2d({ key: "plot3", allowedChildren: ["2d", "3d"] });
const Leaf = component2d({ key: "leafCard", allowedChildren: [] });

const registry = new Registry({
    nodes: [Graph as never, BigGraph as never, Curve as never, Tangent as never, Region as never, Plot3, Leaf],
});

describe("where a node type goes", () => {
    it("is anywhere its dimension allows when it names nothing", () => {
        expect(parentIssue(registry, "rect", null)).toBeNull();
        expect(parentIssue(registry, "rect", "graph")).toBeNull();
        expect(parentIssue(registry, "graph", "rect")).toBeNull();
    });

    it("is only inside what it names, which the root is not", () => {
        expect(parentIssue(registry, "curve", "graph")).toBeNull();
        expect(parentIssue(registry, "curve", null)).toEqual({ kind: "within", within: ["graph"] });
        expect(parentIssue(registry, "curve", "rect")).toEqual({ kind: "within", within: ["graph"] });
        expect(parentIssue(registry, "tangent", "graph")).toEqual({ kind: "within", within: ["curve"] });
    });

    it("counts a type built on the one named", () => {
        expect(nodeTypeIsA(registry, "bigGraph", "graph")).toBe(true);
        expect(nodeTypeIsA(registry, "graph", "bigGraph")).toBe(false);
        expect(parentIssue(registry, "curve", "bigGraph")).toBeNull();
    });

    it("counts what a host says stands for it", () => {
        const isA = (type: string, name: string) => type === "rect" && name === "graph";
        expect(parentIssue(registry, "curve", "rect", { isA })).toBeNull();
    });

    it("keeps a closed parent to the types that name it", () => {
        expect(parentIssue(registry, "tangent", "curve")).toBeNull();
        expect(parentIssue(registry, "rect", "curve")).toEqual({ kind: "closed", parent: "curve" });
        expect(parentIssue(registry, "region", "curve")).toEqual({ kind: "within", within: ["graph"] });
    });

    it("refuses a parent that takes no children", () => {
        expect(parentIssue(registry, "rect", "tangent")).toEqual({ kind: "leaf", parent: "tangent" });
    });

    it("keeps the two dimensions apart, with the Canvas 3D as the seam", () => {
        expect(parentIssue(registry, "box3d", null)).toEqual({ kind: "dimension", parent: null });
        expect(parentIssue(registry, "box3d", "rect")).toEqual({ kind: "dimension", parent: "rect" });
        expect(parentIssue(registry, "box3d", "canvas3d")).toBeNull();
        expect(parentIssue(registry, "rect", "canvas3d")).toEqual({ kind: "dimension", parent: "canvas3d" });
        expect(parentIssue(registry, "canvas3d", null)).toBeNull();
    });

    it("reads which trees a component takes from its allowedChildren", () => {
        expect(registry.describe("plot3")?.holds).toEqual(["2d", "3d"]);
        expect(parentIssue(registry, "box3d", "plot3")).toBeNull();
        expect(parentIssue(registry, "rect", "leafCard")).toEqual({ kind: "leaf", parent: "leafCard" });
        expect(registry.describe("rect")?.holds).toEqual(["2d"]);
    });
});

describe("what a node type needs beside it", () => {
    it("is one of the types it names, under the same parent", () => {
        expect(siblingIssue(registry, "region", ["rect"])).toEqual({ kind: "beside", beside: ["curve"] });
        expect(siblingIssue(registry, "region", ["rect", "curve"])).toBeNull();
        expect(siblingIssue(registry, "rect", [])).toBeNull();
    });
});

describe("the nodes of a document that are not where they go", () => {
    const row = (id: string, type: string, parentId: string | null) => ({ id, type, parentId });

    it("are found whether the stage is a row or left out", () => {
        const explicit = [row("", "canvas2d", null), row("g", "graph", ""), row("c", "curve", "g"), row("lost", "curve", "")];
        expect([...placementIssues(registry, explicit).keys()]).toEqual(["lost"]);
        const implicit = [row("g", "graph", null), row("c", "curve", "g"), row("lost", "tangent", null)];
        expect([...placementIssues(registry, implicit).keys()]).toEqual(["lost"]);
    });

    it("include one missing the sibling it needs, and not one that has it", () => {
        const alone = [row("g", "graph", null), row("r", "region", "g")];
        expect(placementIssues(registry, alone).get("r")).toEqual({ kind: "beside", beside: ["curve"] });
        const met = [...alone, row("c", "curve", "g")];
        expect(placementIssues(registry, met).size).toBe(0);
    });

    it("leave out a type nobody registered, which fails to build on its own account", () => {
        expect(placementIssues(registry, [row("x", "nonesuch", null)]).size).toBe(0);
    });
});
