import { describe, expect, it } from "vitest";

import { ExpressionError } from "../types";
import type { ExpressionDialect } from "../types";
import { expressionOps as ops } from "../ops";
import { DOCUMENT_FUNCTIONS } from "../parse";
import { expressionRefs, splitNodeRef } from "../refs";

/** A resolver over a plain object, for tests that only care about the arithmetic. */
function env(values: Record<string, unknown>) {
    return (name: string) => (name in values ? () => values[name] : undefined);
}

/** Parse, compile and evaluate in one go. */
function evaluate(source: string, values: Record<string, unknown> = {}): unknown {
    return ops.compile(ops.parse(source), env(values))();
}

describe("recognising an expression", () => {
    it("takes a leading `=` as the marker", () => {
        expect(ops.isSource("=1+1")).toBe(true);
        expect(ops.isSource("1+1")).toBe(false);
        expect(ops.isSource(42)).toBe(false);
    });

    it("treats `==` as an escaped literal, so a string may start with `=`", () => {
        expect(ops.isSource("==total")).toBe(false);
        expect(ops.bind("==total", env({}))).toEqual({ dynamic: false, value: "=total" });
    });

    it("leaves a bare `=` alone", () => {
        expect(ops.isSource("=")).toBe(false);
    });

    it("parses a body with or without the marker, and never hands one to the grammar", () => {
        expect(ops.parse("=1+1").source).toBe("1+1");
        expect(ops.parse("1+1").source).toBe("1+1");
    });
});

describe("arithmetic", () => {
    it("reads a variable and applies precedence", () => {
        expect(evaluate("=4[g]+3", { g: 2 })).toBe(11);
        expect(evaluate("=3+4*2", {})).toBe(11);
        expect(evaluate("=(3+4)*2", {})).toBe(14);
    });

    it("multiplies juxtaposed primaries", () => {
        expect(evaluate("=4[g]", { g: 2 })).toBe(8);
        expect(evaluate("=[a][b]", { a: 3, b: 5 })).toBe(15);
        expect(evaluate("=2(1+2)", {})).toBe(6);
        expect(evaluate("=2pi", {})).toBeCloseTo(Math.PI * 2);
    });

    it("handles unary minus, right-associative `^`, and `%`", () => {
        expect(evaluate("=-[g]+1", { g: 4 })).toBe(-3);
        expect(evaluate("=2^3^2", {})).toBe(512);
        expect(evaluate("=2^-1", {})).toBe(0.5);
        expect(evaluate("=7%4", {})).toBe(3);
    });

    it("calls the built-in functions, with trig in degrees", () => {
        expect(evaluate("=max(1, [g], 3)", { g: 9 })).toBe(9);
        expect(evaluate("=clamp([g], 0, 10)", { g: 25 })).toBe(10);
        expect(evaluate("=round(1.234, 0.5)", {})).toBe(1);
        expect(evaluate("=mix(10, 20, [t])", { t: 0.25 })).toBe(12.5);
    });

    it("stays in degrees — the one assertion a shared function library would break", () => {
        expect(evaluate("=sin(30)", {})).toBeCloseTo(0.5);
        expect(evaluate("=atan2(1, 1)", {})).toBeCloseTo(45);
        expect(evaluate("=mod(-1, 3)", {})).toBe(2);
    });

    it("coerces a non-numeric variable to NaN rather than silently to zero", () => {
        expect(evaluate("=[c]+1", { c: "tomato" })).toBeNaN();
    });
});

describe("passthrough", () => {
    it("hands a lone reference over untouched, whatever it holds", () => {
        expect(evaluate("=[c]", { c: "tomato" })).toBe("tomato");
        expect(evaluate("=[p]", { p: { x: 1, y: 2 } })).toEqual({ x: 1, y: 2 });
        expect(ops.parse("=[c]").passthrough).toBe(true);
    });

    it("stops being passthrough the moment there is arithmetic", () => {
        expect(ops.parse("=[c]*1").passthrough).toBe(false);
    });

    it("lists the names it reads, de-duplicated and in first-seen order", () => {
        expect(ops.parse("=[b]+[a]+[b]").refs).toEqual(["b", "a"]);
    });
});

describe("errors", () => {
    it("names an unknown function and lists what exists", () => {
        expect(() => ops.parse("=wobble(1)")).toThrow(/unknown function "wobble"/);
    });

    it("points a bare name at the reference syntax", () => {
        expect(() => ops.parse("=g+1")).toThrow(/referenced as "\[g\]"/);
        // The document dialect never yields a bare reference; this fires the
        // moment a `refs: "bare"` dialect leaks into it.
        expect(() => ops.parse("=x")).toThrow(/referenced as "\[x\]"/);
    });

    it("checks arity at parse time, with no resolver in sight", () => {
        expect(() => ops.parse("=clamp(1, 2)")).toThrow(/clamp\(\) takes 3 arguments, got 2/);
    });

    it("rejects an unclosed reference, a stray character and a trailing operator", () => {
        expect(() => ops.parse("=4[g")).toThrow(/unclosed/);
        expect(() => ops.parse("=4 & 2")).toThrow(/unexpected character/);
        expect(() => ops.parse("=4+")).toThrow(/ends early/);
    });

    it("rejects a second decimal point rather than reading two numbers", () => {
        // `1.2.3` used to scan as `1.2` and `0.3`, juxtaposed into 0.36.
        expect(() => ops.parse("=1.2.3")).toThrow(/unexpected character "\."/);
        expect(evaluate("=1.5*2", {})).toBe(3);
        expect(evaluate("=.5+1", {})).toBe(1.5);
    });

    it("throws when a reference resolves to nothing, naming the reference", () => {
        expect(() => ops.compile(ops.parse("=[missing]"), env({})))
            .toThrow(/"missing" resolves to nothing in this document/);
    });

    /**
     * The dot costs the parser nothing: a bracket's contents are one opaque name,
     * and only the document's resolver reads a meaning into it.
     */
    it("scans a dotted node reference as one name", () => {
        expect(ops.parse("=[card.x]+20").refs).toEqual(["card.x"]);
        expect(evaluate("=[card.x]+20", { "card.x": 5 })).toBe(25);
    });

    it("names the prop a failed reference was written in, not just the formula", () => {
        expect(() => ops.bind({ fill: ["#111", { color: "=[nope]" }] }, env({})))
            .toThrow(/at props\.fill\[1\]\.color/);
    });

    it("reports rather than throws through `tryParse`", () => {
        const result = ops.tryParse("=4[g");
        expect("error" in result && result.error).toMatch(/unclosed/);
        expect(() => ops.parse("=4[g")).toThrow(ExpressionError);
    });
});

describe("prop values", () => {
    it("splits a props bag into literals and bindings", () => {
        const values = { g: 2 };
        const { literal, bindings, hasBindings } = ops.bindProps(
            { width: 100, x: "=4[g]+3", text: "hello" },
            env(values),
        );
        expect(literal).toEqual({ width: 100, text: "hello" });
        expect(hasBindings).toBe(true);
        expect(bindings.x()).toBe(11);
        values.g = 10;
        expect(bindings.x()).toBe(43);
    });

    it("finds an expression nested in an array or an object, and rebuilds the container", () => {
        const values = { g: 1 };
        const compiled = ops.bind({ x: "=[g]*10", y: 5 }, env(values));
        expect(compiled.dynamic).toBe(true);
        expect(compiled.dynamic && compiled.read()).toEqual({ x: 10, y: 5 });
        values.g = 3;
        expect(compiled.dynamic && compiled.read()).toEqual({ x: 30, y: 5 });

        const list = ops.bind(["#111", { color: "=[g]" }], env(values));
        expect(list.dynamic && list.read()).toEqual(["#111", { color: 3 }]);
    });

    it("passes a container with no expression through by identity", () => {
        const value = { x: 1, nested: [1, 2] };
        const compiled = ops.bind(value, env({}));
        expect(compiled).toEqual({ dynamic: false, value });
        expect(compiled.dynamic === false && compiled.value).toBe(value);
        // Nested containers keep their identity too, so nothing reallocates.
        expect(compiled.dynamic === false && (compiled.value as typeof value).nested).toBe(value.nested);
    });

    it("collects every expression with a path, for a validator to point at", () => {
        expect(ops.collect({ fill: ["#111", { color: "=[c]" }], x: "=[g]" }, "props"))
            .toEqual([
                { path: "props.fill[1].color", source: "=[c]" },
                { path: "props.x", source: "=[g]" },
            ]);
    });

    it("leaves the value it walked untouched while collecting", () => {
        const value = { fill: ["#111", { color: "=[c]" }] };
        const before = JSON.stringify(value);
        ops.collect(value, "props");
        expect(JSON.stringify(value)).toBe(before);
    });
});

describe("completion lists", () => {
    it("reports the dialect's own names, sorted", () => {
        expect(ops.constants()).toEqual(["e", "pi", "tau"]);
        expect(ops.functions()).toContain("smoothstep");
        expect([...ops.functions()]).toEqual([...ops.functions()].sort());
    });
});

describe("names on Object.prototype", () => {
    it("are not functions", () => {
        for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
            expect(() => ops.parse(`=${name}(1)`)).toThrow(ExpressionError);
            expect(() => ops.parse(`=${name}(1)`)).toThrow(new RegExp(`unknown function "${name}"`));
        }
    });

    it("are not constants", () => {
        for (const name of ["constructor", "toString", "__proto__"]) {
            expect(() => ops.parse(`=${name}+1`)).toThrow(ExpressionError);
            expect(() => ops.parse(`=${name}+1`)).toThrow(/unknown name/);
        }
    });
});

describe("string operands", () => {
    it("read as numbers unless they are blank, which is NaN", () => {
        expect(evaluate("=[s]+1", { s: "5" })).toBe(6);
        expect(evaluate("=[s]+1", { s: "" })).toBeNaN();
        expect(evaluate("=[s]+1", { s: "   " })).toBeNaN();
        expect(evaluate("=[s]+1", { s: "abc" })).toBeNaN();
        expect(evaluate("=[s]+1", { s: true })).toBe(2);
        expect(evaluate("=[s]+1", { s: null })).toBeNaN();
    });
});

describe("step and smoothstep", () => {
    it("propagate NaN from any operand", () => {
        expect(evaluate("=step(1, [n])", { n: NaN })).toBeNaN();
        expect(evaluate("=step([n], 1)", { n: NaN })).toBeNaN();
        expect(evaluate("=smoothstep(0, 1, [n])", { n: NaN })).toBeNaN();
        expect(evaluate("=smoothstep(0, [n], 1)", { n: NaN })).toBeNaN();
        expect(evaluate("=smoothstep([n], 1, 0.5)", { n: NaN })).toBeNaN();
    });

    it("keep their finite results", () => {
        expect(evaluate("=step(1, 2)")).toBe(1);
        expect(evaluate("=step(1, 0)")).toBe(0);
        expect(evaluate("=smoothstep(0, 1, 0.5)")).toBe(0.5);
        expect(evaluate("=smoothstep(0, 1, -1)")).toBe(0);
    });

    it("treat equal edges as a step at the edge", () => {
        expect(evaluate("=smoothstep(2, 2, 1)")).toBe(0);
        expect(evaluate("=smoothstep(2, 2, 2)")).toBe(1);
        expect(evaluate("=smoothstep(2, 2, 3)")).toBe(1);
    });
});

describe("arity messages", () => {
    it("pluralise on the number they name", () => {
        expect(() => ops.parse("=min()")).toThrow(/min\(\) takes at least 1 argument, got 0/);
        expect(() => ops.parse("=hypot(1)")).toThrow(/hypot\(\) takes at least 2 arguments, got 1/);
        expect(() => ops.parse("=abs(1, 2)")).toThrow(/abs\(\) takes 1 argument, got 2/);
        expect(() => ops.parse("=round()")).toThrow(/round\(\) takes 1–2 arguments, got 0/);
        expect(() => ops.parse("=clamp(1)")).toThrow(/clamp\(\) takes 3 arguments, got 1/);
    });
});

describe("renaming references", () => {
    it("hands the callback the trimmed name and writes the replacement without spaces", () => {
        const seen: string[] = [];
        const out = ops.renameRefs({ x: "=[ g ]*2+[h]" }, (ref) => {
            seen.push(ref);
            return ref === "g" ? "fade" : undefined;
        });
        expect(seen).toEqual(["g", "h"]);
        expect(out).toEqual({ x: "=[fade]*2+[h]" });
    });

    it("keeps a reference as written when the callback declines", () => {
        const value = { x: "=[ g ]" };
        expect(ops.renameRefs(value, () => undefined)).toEqual({ x: "=[ g ]" });
    });
});

describe("the function library", () => {
    const ALL = [
        "abs", "acos", "asin", "atan", "atan2", "ceil", "clamp", "cos", "exp", "floor", "hypot", "log",
        "max", "min", "mix", "mod", "pow", "round", "sign", "sin", "smoothstep", "sqrt", "step", "tan",
    ];

    it("is the closed set of 24, sorted for a host's completion list", () => {
        expect(ops.functions()).toEqual(ALL);
        expect(ALL).toHaveLength(24);
    });

    it("pins each function's arity, since a stored document is evaluated by whatever opens it later", () => {
        const arity = Object.fromEntries(Object.entries(DOCUMENT_FUNCTIONS).map(([name, fn]) => [name, fn.arity]));
        expect(arity).toEqual({
            abs: [1, 1], sign: [1, 1], sqrt: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 2],
            min: [1, Infinity], max: [1, Infinity], clamp: [3, 3], mod: [2, 2], pow: [2, 2], log: [1, 2],
            exp: [1, 1], mix: [3, 3], smoothstep: [3, 3], step: [2, 2],
            sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1], atan2: [2, 2],
            hypot: [2, Infinity],
        });
    });

    it("abs, sign, floor, ceil and sqrt", () => {
        expect(evaluate("=abs(-3)")).toBe(3);
        expect(evaluate("=abs(3)")).toBe(3);
        expect(evaluate("=sign(-5)")).toBe(-1);
        expect(evaluate("=sign(0)")).toBe(0);
        expect(evaluate("=sign(3)")).toBe(1);
        expect(evaluate("=floor(-1.5)")).toBe(-2);
        expect(evaluate("=floor(1.9)")).toBe(1);
        expect(evaluate("=ceil(1.2)")).toBe(2);
        expect(evaluate("=ceil(-1.2)")).toBe(-1);
        expect(evaluate("=sqrt(9)")).toBe(3);
    });

    it("min takes any number of arguments, at least one", () => {
        expect(evaluate("=min(3, 1, 2)")).toBe(1);
        expect(evaluate("=min(7)")).toBe(7);
        expect(evaluate("=min(-1, [g])", { g: -4 })).toBe(-4);
    });

    it("pow, exp and log, with the natural log by default and a base as a second argument", () => {
        expect(evaluate("=pow(2, 10)")).toBe(1024);
        expect(evaluate("=pow(2, 0.5)")).toBeCloseTo(Math.SQRT2, 12);
        expect(evaluate("=pow(0, 0)")).toBe(1);
        expect(evaluate("=exp(0)")).toBe(1);
        expect(evaluate("=exp(1)")).toBeCloseTo(Math.E, 12);
        expect(evaluate("=log(e)")).toBeCloseTo(1, 12);
        expect(evaluate("=log(8, 2)")).toBeCloseTo(3, 12);
        expect(evaluate("=log(100, 10)")).toBeCloseTo(2, 12);
        expect(evaluate("=log(0)")).toBe(-Infinity);
    });

    it("smoothstep eases between its edges and clamps outside them", () => {
        expect(evaluate("=smoothstep(0, 10, 2.5)")).toBeCloseTo(0.15625, 12);
        expect(evaluate("=smoothstep(0, 10, 5)")).toBe(0.5);
        expect(evaluate("=smoothstep(0, 10, -3)")).toBe(0);
        expect(evaluate("=smoothstep(0, 10, 30)")).toBe(1);
        // A reversed pair of edges runs the other way.
        expect(evaluate("=smoothstep(10, 0, 2.5)")).toBeCloseTo(1 - 0.15625, 12);
    });

    it("step is 0 below the edge and 1 at or above it", () => {
        expect(evaluate("=step(2, 1.99)")).toBe(0);
        expect(evaluate("=step(2, 2)")).toBe(1);
        expect(evaluate("=step(2, 9)")).toBe(1);
    });

    it("tan, asin, acos and atan work in degrees", () => {
        expect(evaluate("=tan(45)")).toBeCloseTo(1, 12);
        expect(evaluate("=tan(0)")).toBe(0);
        expect(evaluate("=asin(1)")).toBeCloseTo(90, 12);
        expect(evaluate("=asin(0.5)")).toBeCloseTo(30, 12);
        expect(evaluate("=acos(0)")).toBeCloseTo(90, 12);
        expect(evaluate("=acos(1)")).toBe(0);
        expect(evaluate("=atan(1)")).toBeCloseTo(45, 12);
        expect(evaluate("=atan(0)")).toBe(0);
    });

    it("sin, cos and atan2 agree on the quadrant", () => {
        expect(evaluate("=sin(90)")).toBeCloseTo(1, 12);
        expect(evaluate("=cos(180)")).toBeCloseTo(-1, 12);
        expect(evaluate("=atan2(0, -1)")).toBeCloseTo(180, 12);
        expect(evaluate("=atan2(1, 0)")).toBeCloseTo(90, 12);
    });

    it("hypot takes two or more arguments", () => {
        expect(evaluate("=hypot(3, 4)")).toBe(5);
        expect(evaluate("=hypot(1, 2, 2)")).toBe(3);
        expect(evaluate("=hypot([a], [b])", { a: 6, b: 8 })).toBe(10);
    });

    it("round to a step, to the nearest integer without one, and half up", () => {
        expect(evaluate("=round(2.5)")).toBe(3);
        expect(evaluate("=round(-2.5)")).toBe(-2);
        expect(evaluate("=round(7, 5)")).toBe(5);
        expect(evaluate("=round(8, 5)")).toBe(10);
        expect(evaluate("=round(7, 0)")).toBe(7);
    });

    it("clamp, mix and mod keep their documented shapes", () => {
        expect(evaluate("=clamp(5, 10, 0)")).toBe(0);
        expect(evaluate("=clamp(-5, 0, 10)")).toBe(0);
        expect(evaluate("=mix(0, 10, 2)")).toBe(20);
        expect(evaluate("=mod(7, 3)")).toBe(1);
        expect(evaluate("=mod(-7, 3)")).toBe(2);
    });

    it("exposes the three constants, which are not callable", () => {
        expect(evaluate("=pi")).toBe(Math.PI);
        expect(evaluate("=tau")).toBe(Math.PI * 2);
        expect(evaluate("=e")).toBe(Math.E);
        expect(() => ops.parse("=pi(2)")).toThrow(/unknown function "pi"/);
        expect(() => ops.parse("=e(2)")).toThrow(/unknown function "e"/);
    });

    it("lists what exists in the unknown-function message, sorted", () => {
        expect(() => ops.parse("=wobble(1)")).toThrow(`available: ${ALL.join(", ")}`);
    });
});

describe("number forms", () => {
    it("reads an exponent in either case, signed or not", () => {
        expect(evaluate("=2e3")).toBe(2000);
        expect(evaluate("=2E3")).toBe(2000);
        expect(evaluate("=1e-2")).toBe(0.01);
        expect(evaluate("=2e+1")).toBe(20);
        expect(evaluate("=.5e1")).toBe(5);
    });

    it("reads a trailing point as part of the number", () => {
        expect(evaluate("=3.")).toBe(3);
        expect(evaluate("=3.+1")).toBe(4);
    });

    it("reads `2e` as two times the constant, not a broken exponent", () => {
        expect(evaluate("=2e")).toBeCloseTo(2 * Math.E, 12);
        expect(evaluate("=2e2")).toBe(200);
    });

    it("fails `2e+` as an operator with nothing after it", () => {
        expect(() => ops.parse("=2e+")).toThrow(/ends early/);
    });

    it("overflows to Infinity rather than failing", () => {
        expect(evaluate("=1e400")).toBe(Infinity);
    });
});

describe("whitespace and emptiness", () => {
    it("ignores spaces, tabs and both kinds of line break", () => {
        expect(evaluate("=1 +\r\n\t2")).toBe(3);
        expect(evaluate("=\t[g]\n*\r2", { g: 4 })).toBe(8);
    });

    it("rejects an empty expression, whatever blank it is made of", () => {
        expect(() => ops.parse("")).toThrow(/empty expression/);
        expect(() => ops.parse("   ")).toThrow(/empty expression/);
        expect(() => ops.parse("= ")).toThrow(/empty expression/);
    });

    it("does not take a lone `=` for the marker", () => {
        expect(() => ops.parse("=")).toThrow(/unexpected character "="/);
    });

    it("rejects an empty reference and one holding nothing but spaces", () => {
        expect(() => ops.parse("=[]")).toThrow(/empty variable reference/);
        expect(() => ops.parse("=[   ]")).toThrow(/empty variable reference/);
    });

    it("rejects a nested reference", () => {
        expect(() => ops.parse("=[[a]]")).toThrow(/variable references cannot nest/);
    });

    it("trims a reference's name", () => {
        expect(ops.parse("=[ g ]").refs).toEqual(["g"]);
        expect(evaluate("=[ g ]+1", { g: 2 })).toBe(3);
    });
});

describe("grammar corners", () => {
    it("binds unary minus below `^`, so `-2^2` is -4 and `(-2)^2` is 4", () => {
        expect(evaluate("=-2^2")).toBe(-4);
        expect(evaluate("=(-2)^2")).toBe(4);
        expect(evaluate("=-2^-2")).toBe(-0.25);
    });

    it("takes a unary plus as the identity, stacked with a minus too", () => {
        expect(evaluate("=+3")).toBe(3);
        expect(evaluate("=--3")).toBe(3);
        expect(evaluate("=-+3")).toBe(-3);
        expect(evaluate("=2*-3")).toBe(-6);
        expect(evaluate("=2--3")).toBe(5);
    });

    it("lets implicit multiplication bind at the level of `/`, left to right", () => {
        // (1/2)*pi, not 1/(2*pi): juxtaposition is the same precedence as `*` and `/`.
        expect(evaluate("=1/2pi")).toBeCloseTo(Math.PI / 2, 12);
        expect(evaluate("=4/2[g]", { g: 3 })).toBe(6);
        expect(evaluate("=8/2(1+1)")).toBe(8);
    });

    it("multiplies adjacent operands of every kind", () => {
        expect(evaluate("=1 2")).toBe(2);
        expect(evaluate("=3(2)")).toBe(6);
        expect(evaluate("=(2)3")).toBe(6);
        expect(evaluate("=(1)(2)")).toBe(2);
        expect(evaluate("=pi pi")).toBeCloseTo(Math.PI ** 2, 12);
        expect(evaluate("=[a][b]", { a: 2, b: 5 })).toBe(10);
    });

    it("multiplies a call's result by whatever follows it", () => {
        expect(evaluate("=abs(-3)2")).toBe(6);
        expect(evaluate("=abs(-3)[g]", { g: 4 })).toBe(12);
    });

    it("lets a call's argument juxtapose", () => {
        expect(evaluate("=max(2 3, 1)")).toBe(6);
    });

    it("rejects a trailing or leading comma and a call left open", () => {
        expect(() => ops.parse("=max(1, 2,)")).toThrow(/unexpected "\)"/);
        expect(() => ops.parse("=abs(,1)")).toThrow(/unexpected ","/);
        expect(() => ops.parse("=max(1, 2")).toThrow(/expected `\)` closing max\(/);
        expect(() => ops.parse("=((1)")).toThrow(/expected `\)`/);
        expect(() => ops.parse("=1)")).toThrow(/unexpected "\)"/);
    });

    it("rejects a call with no arguments for a function that needs one", () => {
        expect(() => ops.parse("=max()")).toThrow(/max\(\) takes at least 1 argument, got 0/);
        expect(() => ops.parse("=abs()")).toThrow(/abs\(\) takes 1 argument, got 0/);
    });

    it("rejects a bare name after a reference as an unknown name, not a second reference", () => {
        expect(() => ops.parse("=[a]b")).toThrow(/unknown name "b"/);
    });

    it("rejects the characters the grammar has no use for", () => {
        for (const bad of ["$x", "'a'", "x = 1", "1 & 2", "{1}", "1;2"]) {
            expect(() => ops.parse(`=${bad}`), bad).toThrow(ExpressionError);
        }
    });

    it("rejects a doubled point, which is neither one number nor two", () => {
        expect(() => ops.parse("=1..2")).toThrow(/unexpected character "\."/);
    });
});

describe("a lone reference in parentheses or behind a plus", () => {
    // Both still parse to a bare reference, so the value passes through untouched.
    it("passes the value through, because the tree is still only a reference", () => {
        expect(ops.parse("=([c])").passthrough).toBe(true);
        expect(ops.parse("=(([c]))").passthrough).toBe(true);
        expect(ops.parse("=+[c]").passthrough).toBe(true);
        expect(evaluate("=([c])", { c: "tomato" })).toBe("tomato");
        expect(evaluate("=+[c]", { c: { x: 1 } })).toEqual({ x: 1 });
    });

    it("stops passing through at a minus, a product or an operand beside it", () => {
        for (const source of ["=-[c]", "=[c]*1", "=1*[c]", "=[c]+0", "=abs([c])"]) {
            expect(ops.parse(source).passthrough, source).toBe(false);
        }
    });
});

describe("coercing a variable to a number", () => {
    const plusOne = (value: unknown) => evaluate("=[v]+1", { v: value });

    it("reads a number as itself and a boolean as 1 or 0", () => {
        expect(plusOne(2)).toBe(3);
        expect(plusOne(true)).toBe(2);
        expect(plusOne(false)).toBe(1);
    });

    it("reads a numeric string the way Number does, spaces and radix included", () => {
        expect(plusOne("5")).toBe(6);
        expect(plusOne(" 5 ")).toBe(6);
        expect(plusOne("1e3")).toBe(1001);
        expect(plusOne("0x10")).toBe(17);
        expect(plusOne("-3")).toBe(-2);
        expect(plusOne("Infinity")).toBe(Infinity);
    });

    it("gives NaN for anything that is not a number, so the first frame shows it", () => {
        for (const value of [{}, [], [5], undefined, null, "", "  ", "tomato", () => 1, Symbol.iterator, 5n]) {
            expect(plusOne(value), String(typeof value)).toBeNaN();
        }
    });

    it("leaves a lone reference to any of them untouched", () => {
        for (const value of [{}, [], undefined, null, "", "tomato", 5n]) {
            expect(evaluate("=[v]", { v: value })).toBe(value);
        }
    });
});

describe("arithmetic that leaves the reals", () => {
    it("divides by zero to an infinity or NaN, and never throws", () => {
        expect(evaluate("=1/0")).toBe(Infinity);
        expect(evaluate("=-1/0")).toBe(-Infinity);
        expect(evaluate("=0/0")).toBeNaN();
        expect(evaluate("=1/[g]", { g: 0 })).toBe(Infinity);
    });

    it("takes a remainder with the sign of the dividend, and NaN for a zero divisor", () => {
        expect(evaluate("=5.5%2")).toBe(1.5);
        expect(evaluate("=-5%3")).toBe(-2);
        expect(evaluate("=5%0")).toBeNaN();
        expect(evaluate("=mod(5, 0)")).toBeNaN();
    });

    it("gives NaN outside a function's domain", () => {
        expect(evaluate("=sqrt(-1)")).toBeNaN();
        expect(evaluate("=asin(2)")).toBeNaN();
        expect(evaluate("=acos(-2)")).toBeNaN();
        expect(evaluate("=log(-1)")).toBeNaN();
    });

    it("lets NaN through every operator", () => {
        expect(evaluate("=[v]*0", { v: Number.NaN })).toBeNaN();
        expect(evaluate("=max(1, [v])", { v: Number.NaN })).toBeNaN();
        expect(evaluate("=clamp([v], 0, 1)", { v: Number.NaN })).toBeNaN();
    });
});

describe("purity", () => {
    it("leaves the formula and the parsed tree as they were", () => {
        const source = "=max(1, [a]*2) + abs(-[b])";
        const parsed = ops.parse(source);
        const snapshot = structuredClone(parsed);
        ops.compile(parsed, env({ a: 1, b: 2 }))();
        expect(parsed).toEqual(snapshot);
        expect(ops.parse(source)).toEqual(parsed);
    });

    it("parses equal sources to equal trees, and hands back a fresh one each time", () => {
        const a = ops.parse("=4[g]+3");
        const b = ops.parse("=4[g]+3");
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        expect(a.root).not.toBe(b.root);
    });

    it("compiles one parsed formula into independent bindings", () => {
        const parsed = ops.parse("=[g]*2");
        const first = ops.compile(parsed, env({ g: 1 }));
        const second = ops.compile(parsed, env({ g: 10 }));
        expect(first()).toBe(2);
        expect(second()).toBe(20);
        expect(first()).toBe(2);
    });

    it("reads what the resolver holds at each call, not what it held when compiled", () => {
        const values = { g: 1 };
        const read = ops.compile(ops.parse("=[g]+1"), env(values));
        expect(read()).toBe(2);
        values.g = 5;
        expect(read()).toBe(6);
    });

    it("walks a value without writing to it, frozen or not", () => {
        const value = Object.freeze({
            fill: Object.freeze(["#111", Object.freeze({ color: "=[c]" })]),
            nested: Object.freeze({ list: Object.freeze(["==x", "=[g]*2"]) }),
        });
        const before = JSON.stringify(value);

        const bound = ops.bind(value, env({ c: "red", g: 3 }));
        expect(bound.dynamic && bound.read()).toEqual({ fill: ["#111", { color: "red" }], nested: { list: ["=x", 6] } });
        expect(ops.collect(value, "props")).toHaveLength(2);
        expect(ops.renameRefs(value, (ref) => (ref === "g" ? "h" : undefined))).toEqual({
            fill: ["#111", { color: "=[c]" }],
            nested: { list: ["==x", "=[h]*2"] },
        });
        expect(JSON.stringify(value)).toBe(before);
    });

    it("returns equal results for equal inputs from renameRefs", () => {
        const value = { x: "=[a]+[b]" };
        const rename = (ref: string) => (ref === "a" ? "z" : undefined);
        expect(ops.renameRefs(value, rename)).toEqual(ops.renameRefs(value, rename));
        expect(value).toEqual({ x: "=[a]+[b]" });
    });
});

describe("ExpressionError", () => {
    const thrown = (run: () => unknown): ExpressionError => {
        try {
            run();
        } catch (error) {
            return error as ExpressionError;
        }
        throw new Error("did not throw");
    };

    it("is an Error with its own name", () => {
        const error = thrown(() => ops.parse("=4+"));
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(ExpressionError);
        expect(error.name).toBe("ExpressionError");
    });

    it("carries the formula without the marker, whether or not it had one", () => {
        expect(thrown(() => ops.parse("=4[g")).source).toBe("4[g");
        expect(thrown(() => ops.parse("4[g")).source).toBe("4[g");
        expect(thrown(() => ops.bind("=4[g", env({}))).source).toBe("4[g");
    });

    it("counts the position from zero, at the offending character", () => {
        expect(thrown(() => ops.parse("=4[g")).position).toBe(1);       // the `[`
        expect(thrown(() => ops.parse("=4 & 2")).position).toBe(2);     // the `&`
        expect(thrown(() => ops.parse("=1.2.3")).position).toBe(3);     // the second point
        expect(thrown(() => ops.parse("=1)")).position).toBe(1);        // the stray `)`
    });

    it("puts an early end just past the last character", () => {
        const error = thrown(() => ops.parse("=4+"));
        expect(error.position).toBe(2);
        expect(error.source.length).toBe(2);
    });

    it("says where in the message, one-based, so a reader can count", () => {
        const error = thrown(() => ops.parse("=4 & 2"));
        expect(error.message).toBe('unexpected character "&" (at character 3 of "4 & 2")');
    });

    it("has no position when the whole formula is at fault, and says so in the message", () => {
        const empty = thrown(() => ops.parse("   "));
        expect(empty.position).toBe(-1);
        expect(empty.message).toBe('empty expression (in "   ")');
    });

    it("has no path from a bare parse", () => {
        expect(thrown(() => ops.parse("=4+")).path).toBeUndefined();
    });

    it("carries the path of a reference that resolved to nothing, in the message too", () => {
        const error = thrown(() => ops.bind({ fill: ["#111", { color: "=[ghost]" }] }, env({})));
        expect(error.path).toBe("props.fill[1].color");
        expect(error.position).toBe(-1);
        expect(error.source).toBe("[ghost]");
        expect(error.message).toMatch(/ at props\.fill\[1\]\.color$/);
    });

    it("roots the path at the name it is given", () => {
        expect(thrown(() => ops.bind("=[ghost]", env({}), "args")).path).toBe("args");
        expect(thrown(() => ops.bindProps({ x: "=[ghost]" }, env({}), "args")).path).toBe("args.x");
        expect(thrown(() => ops.bindProps({ x: ["=[ghost]"] }, env({}))).path).toBe("props.x[0]");
    });

    // A formula that does not parse is reported without the path it was
    // written at, though one that parses and names nothing is.
    it.todo("carries the prop's path on a parse error as it does on an unresolved reference");
});

describe("escaping and nesting", () => {
    it("keeps a `==` escape inside a container that holds a formula", () => {
        const bound = ops.bind({ a: ["==x", "=[g]"] }, env({ g: 1 }));
        expect(bound.dynamic && bound.read()).toEqual({ a: ["=x", 1] });
    });

    it("unescapes in a container with no formula, rebuilding it", () => {
        const value = { label: "==total", n: 1 };
        const bound = ops.bind(value, env({}));
        expect(bound).toEqual({ dynamic: false, value: { label: "=total", n: 1 } });
        expect(bound.dynamic === false && bound.value).not.toBe(value);
    });

    it("unescapes at any depth and keeps untouched siblings by identity", () => {
        const untouched = { deep: [1, 2] };
        const bound = ops.bind({ a: { b: ["==y"] }, keep: untouched }, env({}));
        expect(bound.dynamic).toBe(false);
        const value = (bound as { value: { a: { b: string[] }; keep: object } }).value;
        expect(value.a.b).toEqual(["=y"]);
        expect(value.keep).toBe(untouched);
    });

    it("leaves a plain string, a number, null and undefined as they are", () => {
        for (const value of ["plain", 3, null, undefined, true]) {
            expect(ops.bind(value, env({}))).toEqual({ dynamic: false, value });
        }
    });

    it("splits a nested escape between props: the literal one goes to the constructor", () => {
        const { literal, bindings, hasBindings } = ops.bindProps({ text: "==total", n: 1, x: "=[g]" }, env({ g: 2 }));
        expect(literal).toEqual({ text: "=total", n: 1 });
        expect(Object.keys(bindings)).toEqual(["x"]);
        expect(hasBindings).toBe(true);
    });

    it("binds no props at all for undefined, and for an empty bag", () => {
        expect(ops.bindProps(undefined, env({}))).toEqual({ literal: {}, bindings: {}, hasBindings: false });
        expect(ops.bindProps({}, env({}))).toEqual({ literal: {}, bindings: {}, hasBindings: false });
    });

    it("recognises the escape only at the start of the string", () => {
        expect(ops.isSource("a==b")).toBe(false);
        expect(ops.unescape("a==b")).toBe("a==b");
        expect(ops.unescape("==")).toBe("=");
        expect(ops.unescape("===x")).toBe("==x");
        expect(ops.unescape("=x")).toBe("=x");
    });
});

describe("renaming references in more shapes", () => {
    it("renames every occurrence in a formula, node references included", () => {
        expect(ops.renameRefs({ x: "=[a]+[a]*[card.x]" }, (ref) => (ref === "a" ? "b" : ref === "card.x" ? "panel.x" : undefined)))
            .toEqual({ x: "=[b]+[b]*[panel.x]" });
    });

    it("calls back once per occurrence, in reading order", () => {
        const seen: string[] = [];
        ops.renameRefs({ x: "=[a]+[b]+[a]" }, (ref) => { seen.push(ref); return undefined; });
        expect(seen).toEqual(["a", "b", "a"]);
    });

    it("leaves an escaped literal and a plain string alone", () => {
        const value = { a: "==[a]", b: "[a]", c: "text [a]" };
        expect(ops.renameRefs(value, () => "z")).toEqual(value);
    });

    it("leaves an unclosed bracket, which no reference can be read from", () => {
        expect(ops.renameRefs({ x: "=[a" }, () => "z")).toEqual({ x: "=[a" });
        expect(ops.renameRefs({ x: "=a]" }, () => "z")).toEqual({ x: "=a]" });
    });

    it("hands back the very same value when nothing was renamed", () => {
        const value = { x: "=[a]", nested: [{ y: "=[b]*2" }, 3], plain: "text" };
        expect(ops.renameRefs(value, () => undefined)).toBe(value);
        expect(ops.renameRefs(value, (ref) => ref)).toEqual(value);
        const none = { plain: 1, nested: [1, { deep: "x" }] };
        expect(ops.renameRefs(none, () => "z")).toBe(none);
    });

    it("renames through nested arrays and objects, copying only the path that changed", () => {
        const untouched = { y: "=[b]" };
        const value = { fill: ["#111", { color: "=[a]" }], keep: untouched };
        const out = ops.renameRefs(value, (ref) => (ref === "a" ? "c" : undefined));
        expect(out).toEqual({ fill: ["#111", { color: "=[c]" }], keep: { y: "=[b]" } });
        expect(out.keep).toBe(untouched);
        expect(out).not.toBe(value);
    });

    it("renames inside a formula even when a rename maps to the same text", () => {
        const value = { x: "=[a]" };
        expect(ops.renameRefs(value, (ref) => ref)).toEqual({ x: "=[a]" });
    });

    it("renames a top-level string formula", () => {
        expect(ops.renameRefs("=[a]+1", () => "b")).toBe("=[b]+1");
        expect(ops.renameRefs("plain", () => "b")).toBe("plain");
    });
});

describe("reference helpers", () => {
    describe("splitNodeRef", () => {
        it("splits at the first dot into a key and a prop", () => {
            expect(splitNodeRef("card.x")).toEqual({ key: "card", prop: "x" });
        });

        it("keeps everything after the first dot as the prop", () => {
            expect(splitNodeRef("card.padding.top")).toEqual({ key: "card", prop: "padding.top" });
        });

        it("is undefined with no dot, which is a variable", () => {
            expect(splitNodeRef("g")).toBeUndefined();
            expect(splitNodeRef("")).toBeUndefined();
        });

        it("reads a leading or trailing dot as an empty key or prop", () => {
            expect(splitNodeRef(".x")).toEqual({ key: "", prop: "x" });
            expect(splitNodeRef("card.")).toEqual({ key: "card", prop: "" });
            expect(splitNodeRef(".")).toEqual({ key: "", prop: "" });
        });
    });

    describe("expressionRefs", () => {
        it("splits variables from node references, in first-seen order", () => {
            expect(expressionRefs({ x: "=[b]+[card.x]+[a]", y: "=[card.y]" })).toEqual({
                vars: ["b", "a"],
                keys: [["card", "x"], ["card", "y"]],
                unparsable: 0,
            });
        });

        it("lists a reference once however often, and where, it appears", () => {
            const refs = expressionRefs({ x: "=[g]+[g]", y: "=[g]*[card.x]", z: ["=[card.x]", { w: "=[g]" }] });
            expect(refs.vars).toEqual(["g"]);
            expect(refs.keys).toEqual([["card", "x"]]);
        });

        it("counts a formula that does not parse and reads none of its references", () => {
            expect(expressionRefs({ x: "=[g", y: "=[h]*", z: "=[ok]" })).toEqual({ vars: ["ok"], keys: [], unparsable: 2 });
        });

        it("finds a formula at any depth, and none in a plain value", () => {
            expect(expressionRefs({ a: { b: [{ c: "=[deep]" }] } }).vars).toEqual(["deep"]);
            expect(expressionRefs({ a: 1, b: "text", c: "==[no]" })).toEqual({ vars: [], keys: [], unparsable: 0 });
            expect(expressionRefs(undefined)).toEqual({ vars: [], keys: [], unparsable: 0 });
        });

        it("reads the reference's name as written inside the brackets, trimmed", () => {
            expect(expressionRefs("=[ g ]+[ card.x ]")).toEqual({ vars: ["g"], keys: [["card", "x"]], unparsable: 0 });
        });

        it("splits a leading-dot reference into an empty key rather than a variable", () => {
            expect(expressionRefs("=[.x]").keys).toEqual([["", "x"]]);
        });
    });
});

describe("a dialect other than the document's", () => {
    const plot: ExpressionDialect = {
        functions: { double: { arity: [1, 1] }, hyp: { arity: [2, 2] } },
        constants: { k: 2 },
        refs: "bare",
        unknownName: (name) => `no such name ${name}`,
    };

    it("reads a bare identifier as a reference", () => {
        const parsed = ops.parse("double(x) + k + y", plot);
        expect(parsed.refs).toEqual(["x", "y"]);
        expect(parsed.passthrough).toBe(false);
    });

    it("folds a constant before it can be a reference", () => {
        expect(ops.parse("k*k", plot).refs).toEqual([]);
    });

    it("marks a lone name as passthrough, which only the document's compiler reads", () => {
        expect(ops.parse("x", plot).passthrough).toBe(true);
    });

    it("takes its function table from the dialect, not the document's", () => {
        expect(() => ops.parse("sin(x)", plot)).toThrow('unknown function "sin" — available: double, hyp');
        expect(() => ops.parse("double(x, y)", plot)).toThrow("double() takes 1 argument, got 2");
        expect(() => ops.parse("toString(x)", plot)).toThrow(/unknown function "toString"/);
    });

    it("has no bracket reference, so a `[` is an unexpected character", () => {
        expect(() => ops.parse("[x]", plot)).toThrow('unexpected character "["');
        expect(() => ops.parse("x[1]", plot)).toThrow('unexpected character "["');
    });

    it("tolerates the marker only through the document-aware entry points", () => {
        expect(ops.parse("=x+1", plot).refs).toEqual(["x"]);
        expect(ops.tryParse("=x+1", plot)).toMatchObject({ expression: { refs: ["x"] } });
        expect(ops.tryParse("x+", plot)).toEqual({ error: 'expression ends early (at character 3 of "x+")' });
    });

    it("takes the same grammar: precedence, juxtaposition, right-associative power", () => {
        expect(ops.parse("2x^2^3", plot).refs).toEqual(["x"]);
        expect(ops.parse("2(x+y)", plot).refs).toEqual(["x", "y"]);
        expect(() => ops.parse("1.2.3", plot)).toThrow(/unexpected character "\."/);
    });

    it("leaves the document's own dialect untouched", () => {
        expect(() => ops.parse("=x+1")).toThrow(/referenced as "\[x\]"/);
        expect(ops.dialect.refs).toBe("bracket");
    });
});
