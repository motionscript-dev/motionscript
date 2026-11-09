import { describe, expect, it } from "vitest";
import { parentIssue, Registry } from "@motionscript/sdk";
import { NODES } from "../nodes";

const registry = new Registry({ nodes: NODES });

/** The kit's own keys and the commands each adds to what a shape already has. */
const OWN: Record<string, string[]> = {
    latex: ["morphTo", "partFillTo", "writeTo"],
    latexMatrix: ["entriesTo", "morphTo", "partFillTo", "writeTo"],
    numberLine: ["rangeTo"],
    axes2d: ["rangeTo"],
    numberPlane: ["rangeTo", "transformTo", "warpTo"],
    polarPlane: ["rangeTo"],
    functionPlot: ["domainTo", "morphTo", "paramsTo"],
    pointsPlot: ["pointsTo"],
    vectorField: ["morphTo", "paramsTo"],
    streamLines: ["flowTo", "morphTo", "paramsTo"],
    tracedPath: ["domainTo", "morphTo", "paramsTo", "traceTo"],
    networkGraph: ["arrangeTo", "partFillTo"],
    sampleSpace: ["divideTo"],
    plotPoint: [],
    vectorArrow: ["endpointsTo"],
    curveArea: ["domainTo"],
    riemannSum: ["domainTo", "refineTo"],
    tangentLine: [],
    dropLines: [],
    curlyBrace: ["retargetTo"],
    angleMark: ["radiusTo"],
    emphasisMark: ["retargetTo"],
};

/**
 * Which of a shape's paints each node is drawn with: its fill, its stroke, and
 * its outline trim (`start`/`end`, `progressTo`, `flash`). It spreads none of the rest.
 */
const PAINTS: Record<string, string[]> = {
    latex: ["fill", "stroke"],
    latexMatrix: ["fill", "stroke"],
    numberLine: ["fill", "stroke", "trim"],
    axes2d: ["fill", "stroke", "trim"],
    numberPlane: ["fill", "stroke", "trim"],
    polarPlane: ["fill", "stroke", "trim"],
    functionPlot: ["stroke", "trim"],
    pointsPlot: ["fill", "stroke", "trim"],
    vectorField: ["stroke"],
    streamLines: ["stroke"],
    tracedPath: ["stroke"],
    networkGraph: ["fill", "stroke", "trim"],
    sampleSpace: ["stroke"],
    plotPoint: ["fill", "stroke"],
    vectorArrow: ["stroke", "trim"],
    curveArea: ["fill"],
    riemannSum: ["fill", "stroke"],
    tangentLine: ["stroke", "trim"],
    dropLines: ["stroke", "trim"],
    curlyBrace: ["stroke", "trim"],
    angleMark: ["stroke", "trim"],
    emphasisMark: ["stroke", "trim"],
};

/** The 3D nodes, and the commands each adds to what a mesh already has. */
const OWN_3D: Record<string, string[]> = {
    surfacePlot3d: ["domainTo", "morphTo", "paramsTo"],
    curvePlot3d: ["domainTo", "morphTo", "paramsTo", "progressTo"],
    plotPoint3d: [],
    vectorArrow3d: ["endpointsTo"],
};

/** The 3D graph, a viewport of its own, and the commands it adds to a 3D canvas's. */
const OWN_VIEWPORT: Record<string, string[]> = {
    axes3d: ["rangeTo"],
};

const ALL = { ...OWN, ...OWN_3D, ...OWN_VIEWPORT };

/** What a kit node may redeclare of a shape's own props: how it is painted and sized, never what a prop means. */
const RESTATED = new Set(["stroke", "fill", "width", "height", "padding"]);

const INHERITED = new Set(registry.commandKeys("rect"));
const INHERITED_3D = new Set(registry.commandKeys("mesh3d"));

describe("the math kit's node types", () => {
    it("registers exactly these keys", () => {
        const core = new Set(new Registry().nodeKeys());
        expect(registry.nodeKeys().filter((key) => !core.has(key))).toEqual(Object.keys(ALL).sort());
        expect(NODES).toHaveLength(Object.keys(ALL).length);
    });

    it("names every node new to this kit with two words", () => {
        for (const key of Object.keys(ALL)) {
            if (key === "latex") continue;
            expect(key, key).toMatch(/^[a-z]+([A-Z][a-z]+|[0-9]+[a-z]*)+$/);
        }
    });

    it.each(Object.entries(OWN))("%s publishes its own commands beside the inherited ones", (key, own) => {
        const commands = registry.commandKeys(key);
        const added = commands.filter((name) => !INHERITED.has(name)).sort();
        expect(added).toEqual(own);
        for (const shared of ["moveTo", "fadeTo", "shadowTo"]) expect(commands).toContain(shared);
    });

    it.each(Object.entries(PAINTS))("%s takes only the shape's paints it draws: %j", (key, paints) => {
        const properties = registry.describe(key)!.properties ?? {};
        const commands = registry.commandKeys(key);
        const offers = (props: string[], names: string[]) =>
            props.every((name) => name in properties) && names.every((name) => commands.includes(name));
        const none = (props: string[], names: string[]) =>
            props.every((name) => !(name in properties)) && names.every((name) => !commands.includes(name));
        const check = (paint: string, props: string[], names: string[]) =>
            expect(paints.includes(paint) ? offers(props, names) : none(props, names), paint).toBe(true);
        check("fill", ["fill"], ["fillTo"]);
        check("stroke", ["stroke"], ["strokeTo"]);
        check("trim", ["start", "end"], ["progressTo", "flash"]);
        expect(properties).toHaveProperty("shadow");
    });

    it.each(Object.entries(OWN_3D))("%s publishes its own commands beside a 3D node's", (key, own) => {
        const commands = registry.commandKeys(key);
        expect(commands.filter((name) => !INHERITED_3D.has(name)).sort()).toEqual(own);
        for (const shared of ["moveTo", "rotateTo", "scaleTo"]) expect(commands).toContain(shared);
        expect(registry.describe(key)!.dimension).toBe("3d");
    });

    it.each(Object.entries(OWN_VIEWPORT))("%s publishes its own commands beside a 3D canvas's, and is a 2D node", (key, own) => {
        const commands = registry.commandKeys(key);
        const canvas = new Set(registry.commandKeys("canvas3d"));
        expect(commands.filter((name) => !canvas.has(name)).sort()).toEqual(own);
        expect(commands).toContain("orbitTo");
        expect(registry.describe(key)!.dimension).toBe("2d");
    });

    it("takes no name a 3D canvas already gives a prop for something else", () => {
        const canvas = registry.describe("canvas3d")!.properties ?? {};
        // The same kind and default is the same prop: one may carry more hints (a unit, a step).
        const meaning = (p: { kind?: string; default?: unknown } | undefined) => JSON.stringify([p?.kind, p?.default]);
        for (const key of Object.keys(OWN_VIEWPORT)) {
            const properties = registry.describe(key)!.properties ?? {};
            const shadowed = Object.keys(properties).filter(
                (name) => name in canvas && meaning(properties[name]) !== meaning(canvas[name]),
            );
            expect(shadowed, key).toEqual([]);
        }
    });

    it("takes no name a mesh already gives a prop for something else", () => {
        const mesh = registry.describe("mesh3d")!.properties ?? {};
        // A mark may start its fill in a colour of its own: the same prop, with its own default.
        const meaning = (name: string, p: object | undefined) => JSON.stringify(name === "fill" ? { ...p, default: undefined } : p);
        for (const key of Object.keys(OWN_3D)) {
            const properties = registry.describe(key)!.properties ?? {};
            const shadowed = Object.keys(properties).filter(
                (name) => name in mesh && meaning(name, properties[name]) !== meaning(name, mesh[name]),
            );
            expect(shadowed, key).toEqual([]);
        }
    });

    it("takes no name a shape already gives a prop for something else", () => {
        const shape = registry.describe("rect")!.properties ?? {};
        // What a prop is, not how a host lays out its control: a range or a unit is a hint.
        const meaning = (p: { kind?: string; default?: unknown; options?: unknown } | undefined) =>
            JSON.stringify({ kind: p?.kind, default: p?.default, options: p?.options });
        for (const key of Object.keys(OWN)) {
            const properties = registry.describe(key)!.properties ?? {};
            const shadowed = Object.keys(properties).filter(
                (name) => name in shape && meaning(properties[name]) !== meaning(shape[name]) && !RESTATED.has(name),
            );
            expect(shadowed, key).toEqual([]);
        }
    });

    // Where each node goes and what it needs beside it (`within`, `beside`, `closed`) are the host's to keep.
    it("stands a 3D graph on a 2D stage, never inside a 3D canvas", () => {
        expect(parentIssue(registry, "axes3d", null)).toBeNull();
        expect(parentIssue(registry, "axes3d", "rect")).toBeNull();
        expect(parentIssue(registry, "axes3d", "canvas3d")).toEqual({ kind: "dimension", parent: "canvas3d" });
    });

    it("declares its paint where a host reads it: built from its described defaults, it paints as it does bare", () => {
        for (const key of Object.keys(ALL)) {
            const { ctor } = registry.node(key)!;
            const properties = registry.describe(key)!.properties ?? {};
            const described = Object.fromEntries(["fill", "stroke"].map((name) => [name, properties[name]?.default]));
            const bare = new ctor({}) as unknown as Record<string, unknown>;
            const hosted = new ctor(described) as unknown as Record<string, unknown>;
            for (const name of Object.keys(described)) {
                expect(JSON.stringify(hosted[name]), `${key}.${name}`).toBe(JSON.stringify(bare[name]));
            }
        }
    });

    it("gives no command the name of a property, so a scene can build", () => {
        for (const key of Object.keys(ALL)) {
            const properties = registry.describe(key)!.properties ?? {};
            for (const name of registry.commandKeys(key)) expect(name in properties, `${key}.${name}`).toBe(false);
        }
    });

    it("declares a plot reference as one, so a host can offer the plots", () => {
        for (const key of ["plotPoint", "curveArea", "riemannSum", "tangentLine", "dropLines"]) {
            expect(registry.describe(key)!.properties?.on, key).toMatchObject({ kind: "nodeRef", nodeTypes: ["functionPlot"] });
        }
    });
});
