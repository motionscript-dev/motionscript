import { describe, expect, it } from "vitest";
import * as root from "..";
import * as kit from "../unstable";
import * as shared0 from "../engine";

/**
 * The root of `@motionscript/math` is the promised surface, named one by one: a name leaving it breaks a host, a name
 * arriving widens what the package keeps. `./kit` (`unstable.ts`) is everything, and any release may change it.
 */
const STABLE = [
    "AngleMark",
    "Axes2d",
    "Axes3d",
    "CurlyBrace",
    "CurveArea",
    "CurvePlot3d",
    "DropLines",
    "EmphasisMark",
    "FunctionPlot",
    "Latex",
    "LatexMatrix",
    "NODES",
    "NetworkGraph",
    "NumberLine",
    "NumberPlane",
    "PlotPoint",
    "PlotPoint3d",
    "PointsPlot",
    "PolarPlane",
    "RiemannSum",
    "SampleSpace",
    "StreamLines",
    "SurfacePlot3d",
    "TangentLine",
    "TracedPath",
    "VectorArrow",
    "VectorArrow3d",
    "VectorField",
    "loadMathJax",
];

const values = (module: object) => module as Record<string, unknown>;

describe("the package surface", () => {
    it("exports the stable names from the root, and nothing else", () => {
        expect(Object.keys(root).sort()).toEqual([...STABLE].sort());
    });

    it("hands out each stable value from the kit too", () => {
        for (const name of STABLE.filter((n) => n !== "NODES")) expect(values(kit)[name], name).toBe(values(root)[name]);
    });

    it("carries everything a copied component imports from the kit", () => {
        for (const module of [shared0]) {
            for (const [name, value] of Object.entries(module)) expect(values(kit)[name], name).toBe(value);
        }
    });
});
