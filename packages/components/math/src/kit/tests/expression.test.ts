import { describe, expect, it } from "vitest";
import { compileExpression, compileExpressionCached, expressionVocabulary } from "../expression";

const f = (source: string, variables = ["x"], params: string[] = []) => compileExpression(source, variables, params);

describe("the plot expression language", () => {
    it("takes trig in radians and knows the constants a plot wants", () => {
        expect(f("sin(pi / 2)")(0, 0)).toBeCloseTo(1, 12);
        expect(f("cos(tau)")(0, 0)).toBeCloseTo(1, 12);
        expect(f("ln(e)")(0, 0)).toBeCloseTo(1, 12);
        expect(f("log10(1000)")(0, 0)).toBeCloseTo(3, 12);
    });

    it("reads its variables from the two slots, in order", () => {
        expect(f("x^2 + 1")(3, 0)).toBe(10);
        expect(f("x - y", ["x", "y"])(5, 2)).toBe(3);
        expect(f("theta * 2", ["theta"])(4, 0)).toBe(8);
    });

    it("multiplies by juxtaposition and raises right to left", () => {
        expect(f("2x")(4, 0)).toBe(8);
        expect(f("2(x + 1)")(4, 0)).toBe(10);
        expect(f("2^3^2")(0, 0)).toBe(512);
        expect(f("-x^2")(3, 0)).toBe(-9);
    });

    it("reads named parameters from the scope it is called with", () => {
        const wave = f("a * sin(k * x)", ["x"], ["a", "k"]);
        expect(wave(Math.PI / 2, 0, { a: 3, k: 1 })).toBeCloseTo(3, 12);
        expect(wave(Math.PI / 2, 0, { a: 3, k: 2 })).toBeCloseTo(0, 12);
        expect(wave(1, 0)).toBeNaN();
    });

    it("refuses a name it was not given, so a curve cannot quietly plot a zero", () => {
        expect(() => f("x + y")).toThrow("Unknown name 'y'");
        expect(() => f("a * x")).toThrow("Unknown name 'a'");
        expect(() => f("alert(1)")).toThrow(/unknown function "alert"/);
        expect(() => f("constructor(1)")).toThrow(/unknown function/);
    });

    it("checks how many arguments a function takes", () => {
        expect(() => f("atan2(1)")).toThrow(/atan2\(\) takes 2 arguments/);
        expect(f("min(x)")(4, 0)).toBe(4);
        expect(f("max(1, x, 3)")(7, 0)).toBe(7);
    });

    it("will not let a constant be a variable", () => {
        expect(() => f("e", ["e"])).toThrow("'e' is a constant");
    });

    it("hands back the same closure for the same text, and remembers a failure", () => {
        const first = compileExpressionCached("x + 1", ["x"]);
        expect(compileExpressionCached("x + 1", ["x"])).toBe(first);
        expect(compileExpressionCached("x + 1", ["y"])).not.toBe(first);
        const failed = compileExpressionCached("x +", ["x"]);
        expect(failed).toBeInstanceOf(Error);
        expect(compileExpressionCached("x +", ["x"])).toBe(failed);
    });

    it("lists what can be written, from the tables it compiles with", () => {
        const { variables, functions, constants } = expressionVocabulary(["x"]);
        expect(variables).toEqual(["x"]);
        expect(functions).toContain("atan2");
        expect(functions).toContain("sinh");
        expect(constants).toEqual(["pi", "e", "tau", "phi"]);
    });
});
