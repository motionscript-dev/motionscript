import { describe, expect, it } from "vitest";
import { equationError, equationParams, parseEquation, type Equation } from "../equation";

function read(source: string, params: string[] = []): Equation {
    const equation = parseEquation(source, params);
    if (equation instanceof Error) throw equation;
    return equation;
}

describe("an equation is read the way it is written", () => {
    it("takes a bare expression, or one for y, as a function of x", () => {
        for (const source of ["x^2", "y = x^2", " y=x^2 "]) {
            const equation = read(source);
            expect(equation).toMatchObject({ kind: "function", of: "x" });
            if (equation.kind === "function") expect(equation.f(3, 0)).toBe(9);
        }
    });

    it("takes one for x as a function of y", () => {
        const equation = read("x = y^2 - 1");
        expect(equation).toMatchObject({ kind: "function", of: "y" });
        if (equation.kind === "function") expect(equation.f(2, 0)).toBe(3);
    });

    it("takes one for r as polar", () => {
        const equation = read("r = 1 + cos(theta)");
        expect(equation.kind).toBe("polar");
        if (equation.kind === "polar") expect(equation.f(0, 0)).toBe(2);
    });

    it("takes a pair as parametric", () => {
        const equation = read("(2cos(t), sin(t))");
        expect(equation.kind).toBe("parametric");
        if (equation.kind === "parametric") {
            expect(equation.x(0, 0)).toBe(2);
            expect(equation.y(Math.PI / 2, 0)).toBeCloseTo(1, 12);
        }
        // A pair of pairs inside a function is still one expression, not a pair.
        expect(read("(x + 1)(x - 1)").kind).toBe("function");
        expect(read("(x)").kind).toBe("function");
    });

    it("takes anything else with an equals sign as implicit", () => {
        const circle = read("x^2 + y^2 = 4");
        expect(circle.kind).toBe("implicit");
        if (circle.kind === "implicit") {
            expect(circle.f(2, 0)).toBe(0);
            expect(circle.f(0, 0)).toBe(-4);
        }
        // Naming its own subject on the right makes it implicit too.
        expect(read("y = x + y / 2").kind).toBe("implicit");
    });

    it("passes named parameters through to every side", () => {
        const equation = read("y = a * x + b", ["a", "b"]);
        if (equation.kind !== "function") throw new Error("not a function");
        expect(equation.f(2, 0, { a: 3, b: 1 })).toBe(7);
    });

    it("says why a line of text is not an equation", () => {
        expect(equationError("")).toBeNull();
        expect(equationError("   ")).toBeNull();
        expect(equationError("sin(x)")).toBeNull();
        expect(equationError("sin(")).toMatch(/ends early/);
        expect(equationError("sinn(x)")).not.toBeNull();
        expect(equationError("x = 1 = y")).toBe("An equation has one '='");
        expect(equationError("r = t")).toBe("Unknown name 't'");
    });

    it("takes a name it does not know as a named value, in the order written", () => {
        expect(equationParams("a * sin(k * x) + a")).toEqual(["a", "k"]);
        expect(equationParams("(r0 * cos(t), r0 * sin(w * t))")).toEqual(["r0", "w"]);
        expect(equationParams("x^2 + y^2 = c")).toEqual(["c"]);
        expect(equationError("y = q")).toBeNull();
    });

    it("never takes a variable, a function or a constant for one", () => {
        expect(equationParams("r = theta + pi * e")).toEqual([]);
        expect(equationParams("x + y + t + sin(tau)")).toEqual([]);
        expect(equationParams("sin(")).toEqual([]);
        expect(equationParams("")).toEqual([]);
    });

    it("is the same object for the same text, so a cache can key on it", () => {
        expect(parseEquation("sin(x)")).toBe(parseEquation("sin(x)"));
        expect(parseEquation("sin(x)", ["a"])).not.toBe(parseEquation("sin(x)"));
    });
});
