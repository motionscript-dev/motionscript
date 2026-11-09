import { describe, expect, it } from "vitest";
import { buildLatexPath, findLatexParts, latexPartNames } from "../geometry";
import { matrixSource } from "../matrix";

const chars = (latex: string, selector: string): string[] => {
    const { tokens, parts } = buildLatexPath(latex, 40);
    return findLatexParts(parts, selector).map(([from, to]) =>
        tokens.slice(from, to).map((token) => token.token).join(""),
    );
};

describe("a formula's parts", () => {
    it("are the pieces of its source, each holding the glyphs it drew", () => {
        const { tokens, parts } = buildLatexPath("a^2 + b^2 = c^2", 40);
        expect(tokens).toHaveLength(8);
        const top = parts.filter((part) => part.parent === -1).map((part) => part.latex);
        expect(top).toEqual(["a^2", "+", "b^2", "=", "c^2"]);
        const [first] = parts;
        expect(tokens.slice(first.from, first.to)).toHaveLength(2);
    });

    it("names every place a piece of source is written, in order", () => {
        expect(chars("a^2 + b^2 = c^2", "2")).toEqual(["2", "2", "2"]);
        expect(chars("a^2 + b^2 = c^2", "b^2")).toHaveLength(1);
        expect(chars("a^2 + b^2 = c^2", "q")).toEqual([]);
        expect(chars("a^2 + b^2 = c^2", "")).toEqual([]);
    });

    it("names neighbours that spell the selector together", () => {
        const [run] = chars("a^2 + b^2 = c^2", "b^2 = c^2");
        expect([...run]).toHaveLength(5);
        expect(chars("a^2 + b^2 = c^2", "+ b^2")).toHaveLength(1);
    });

    it("reads past spacing and grouping braces, which are not what the source says", () => {
        expect(chars("x^{2}", "x^2")).toHaveLength(1);
        expect(chars("\\frac{d}{dx} f(x)", "\\frac{d}{dx}")).toHaveLength(1);
        expect(chars("\\frac{d}{dx} f(x)", "f(x)")).toHaveLength(1);
    });

    it("says which top-level term a glyph belongs to", () => {
        const { tokens } = buildLatexPath("a^2 + b", 40);
        expect(tokens.map((token) => token.term)).toEqual(["a^2", "a^2", "+", "b"]);
    });

    it("has none for an empty formula", () => {
        expect(buildLatexPath("", 40).parts).toEqual([]);
    });
});

describe("the names a host offers to pick a part from", () => {
    it("are each part's source once, outermost first, in the order written", () => {
        expect(latexPartNames("a^2 + a^2 = c")).toEqual(["a^2", "a", "2", "+", "=", "c"]);
    });

    it("are a matrix's entries among them", () => {
        const names = latexPartNames(matrixSource([["x^2", "0"], ["0", "y"]], "round"));
        for (const entry of ["x^2", "0", "y"]) expect(names).toContain(entry);
    });

    it("are none for an empty formula or one that will not typeset", () => {
        expect(latexPartNames("")).toEqual([]);
        expect(latexPartNames("\\frac{")).toEqual([]);
        expect(matrixSource([])).toBe("");
    });
});
