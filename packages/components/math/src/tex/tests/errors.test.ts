import { describe, expect, it } from "vitest";

import { buildLatexPath, LatexError } from "../geometry";
import { NullRenderContext } from "@motionscript/core";
import { Latex } from "../node";
import { play, scene } from "../../tests/harness";

/**
 * MathJax does not throw on malformed TeX: it typesets an error box and tags it.
 * What the box turned into used to depend on the adaptor (nothing in a browser,
 * a filled bar under the DOM-free one), so a host could not tell a bad formula
 * from a blank one. Both now report the same typed error.
 */
const MALFORMED = [
    { tex: "\\fra", reason: /Undefined control sequence \\fra/ },
    { tex: "\\frac{a", reason: /Missing close brace/ },
    { tex: "{", reason: /Extra open brace/ },
    { tex: "\\badcommand{x}", reason: /Undefined control sequence \\badcommand/ },
];

describe("malformed TeX", () => {
    it.each(MALFORMED)("buildLatexPath throws a LatexError for $tex", ({ tex, reason }) => {
        let caught: unknown;
        try {
            buildLatexPath(tex, 64);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(LatexError);
        const error = caught as LatexError;
        expect(error.latex).toBe(tex);
        expect(error.reason).toMatch(reason);
        // The message names the formula, so a command that carries it is findable.
        expect(error.message).toContain(tex);
    });

    it("throws again on the next ask rather than remembering the failure as a blank formula", () => {
        expect(() => buildLatexPath("\\fra", 64)).toThrow(LatexError);
        expect(() => buildLatexPath("\\fra", 64)).toThrow(LatexError);
        expect(() => buildLatexPath("\\fra", 32)).toThrow(LatexError);
    });

    it("leaves a valid formula alone", () => {
        expect(buildLatexPath("x^2", 64).tokens.length).toBeGreaterThan(0);
    });

    // A component runs no code when it is built: the formula is typeset when the node is first laid out, which a
    // document's build does, so a scene holding a bad one still fails to build.
    it("fails a scene built with one", () => {
        expect(() => play(scene([{ id: "f", type: "latex", props: { latex: "\\frac{a", fontSize: 32 } }]))).toThrow(LatexError);
    });

    it("keeps failing on every read of a node whose formula is bad", () => {
        const node = new Latex({ latex: "x", fontSize: 32 } as never);
        node.set({ latex: "\\frac{a" });
        const constraints = { maxWidth: 100, maxHeight: 100 } as never;
        const measurer = new NullRenderContext();
        expect(() => node.measure(constraints, measurer)).toThrow(LatexError);
        expect(() => node.measure(constraints, measurer)).toThrow(LatexError);
    });

    it("treats \\require as an error too, because that package is not loaded", () => {
        expect(() => buildLatexPath("\\require{cancel} \\cancel{x}", 64)).toThrow(LatexError);
    });
});
