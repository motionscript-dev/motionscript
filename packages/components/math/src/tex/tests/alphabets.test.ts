import { describe, expect, it } from "vitest";

import { buildLatexPath } from "../geometry";
import { Latex } from "../node";

/**
 * The math alphabets whose glyphs MathJax keeps outside its core font data.
 * Each `token` is the character the glyph is keyed by, so a match says the
 * letter came from that alphabet rather than from the upright face.
 */
const ALPHABETS = [
    { tex: "\\mathbb{R}", token: "ℝ" },
    { tex: "\\mathbb{1}", token: "𝟙" },
    { tex: "\\mathcal{L}", token: "L" },
    { tex: "\\boldsymbol{\\mathcal{L}}", token: "L" },
    { tex: "\\mathfrak{g}", token: "𝔤" },
    { tex: "\\mathscr{A}", token: "𝒜" },
    { tex: "\\mathsf{A}", token: "𝖠" },
    { tex: "\\mathtt{A}", token: "𝙰" },
];

describe("math alphabets", () => {
    it.each(ALPHABETS)("typesets $tex", ({ tex, token }) => {
        const result = buildLatexPath(tex, 32);
        expect(result.tokens.map(t => t.token)).toEqual([token]);
        expect(result.tokens[0].path.length).toBeGreaterThan(0);
        expect(result.width).toBeGreaterThan(0);
    });

    it.each(ALPHABETS)("builds a Latex node for $tex", ({ tex }) => {
        expect(() => new Latex({ latex: tex, fontSize: 32 } as never)).not.toThrow();
    });

    it("typesets every alphabet in one formula", () => {
        const tex = "\\mathbb{R} \\mathcal{L} \\mathfrak{g} \\mathscr{A} \\mathsf{A} \\mathtt{A}";
        expect(buildLatexPath(tex, 32).tokens.map(t => t.token)).toEqual(["ℝ", "L", "𝔤", "𝒜", "𝖠", "𝙰"]);
    });
});
