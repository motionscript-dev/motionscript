import { describe, expect, it, vi } from "vitest";
import type { AssetScope, Node2D } from "@motionscript/sdk";
import { MATHJAX_LOADER } from "../tex/geometry";
import { play, scene, type Row } from "./harness";

/** What a node asks its host to load, by kind and key. */
function declared(node: Node2D): string[] {
    const asked: string[] = [];
    const scope = new Proxy({} as AssetScope, {
        get: (_, kind) => (key: unknown) => {
            asked.push(`${String(kind)}:${typeof key === "string" ? key : "?"}`);
        },
    });
    node.declareAssets(scope);
    return asked;
}

describe("MathJax", () => {
    it("is not there until something loads it, and typesetting before then says so", async () => {
        vi.resetModules();
        const fresh = await import("../tex/geometry");
        expect(fresh.mathJaxLoaded()).toBe(false);
        expect(() => fresh.buildLatexPath("x^2", 16)).toThrow(fresh.LatexNotLoaded);
        expect(fresh.latexPartNames("x^2")).toEqual([]);
        await fresh.loadMathJax();
        expect(fresh.buildLatexPath("x^2", 16).tokens.length).toBeGreaterThan(0);
    });

    it("is asked for by a formula, and by a graph only when one of its labels is a formula", () => {
        const formula: Row = { id: "f", type: "latex", props: { latex: "x^2" } };
        const plain: Row = { id: "a", type: "axes2d", props: { width: 400, height: 300, xLabel: "time" } };
        const typeset: Row = { id: "b", type: "axes2d", props: { width: 400, height: 300, xLabel: "$t$" } };
        const played = play(scene([formula, plain, typeset]));
        played.at(0);
        const loads = (id: string) => declared(played.node(id)).filter((entry) => entry === `loader:${MATHJAX_LOADER}`);
        expect(loads("f")).toHaveLength(1);
        expect(loads("a")).toHaveLength(0);
        expect(loads("b")).toHaveLength(1);
    });
});
