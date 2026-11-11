import { expressionOps, type ExpressionNode } from "@motionscript/sdk";
import { createBoundedCache, memoParse } from "./cache";
import { compilerFor, MATH_DIALECT, type CompiledExpression } from "./expression";

/**
 * A plotted equation, read the way it is written rather than by a `kind` prop:
 * `sin(x)` or `y = sin(x)` is a function of `x`, `x = y^2` of `y`,
 * `r = 1 + cos(theta)` polar, `(cos(t), sin(t))` parametric, and
 * `x^2 + y^2 = 4` implicit.
 */
export type Equation =
    | { kind: "function"; of: "x" | "y"; f: CompiledExpression }
    | { kind: "polar"; f: CompiledExpression }
    | { kind: "parametric"; x: CompiledExpression; y: CompiledExpression }
    | { kind: "implicit"; f: CompiledExpression };

/** The free variable each kind is sampled over, for a host's help. */
export const EQUATION_VARIABLES = {
    function: ["x"],
    polar: ["theta"],
    parametric: ["t"],
    implicit: ["x", "y"],
} as const satisfies Record<Equation["kind"], readonly string[]>;

/** `source` as an {@link Equation}, or the reason it is not one. */
export const parseEquation = memoParse<Equation>(256, read);

/** Why `source` will not plot, or `null`. Empty text is no error, and neither is an unknown name: that is a named value ({@link equationParams}). */
export function equationError(source: string): string | null {
    if (source.trim() === "") return null;
    const equation = parseEquation(source, equationParams(source));
    return equation instanceof Error ? equation.message : null;
}

/** A name that is always a variable of some kind of equation, so never a named value. */
const VARIABLE_NAMES: ReadonlySet<string> = new Set(["r", ...Object.values(EQUATION_VARIABLES).flat()]);

const named = createBoundedCache<readonly string[]>(256);

/** Every name `source` reads, in the order first named, variables included; empty for text that does not parse. */
export function equationNames(source: string): readonly string[] {
    const hit = named.get(source);
    if (hit !== undefined) return hit;
    const names = new Set<string>();
    const text = source.trim();
    try {
        for (const part of splitTuple(text) ?? splitTopLevel(text, "=")) {
            collectNames(expressionOps.parse(part.trim(), MATH_DIALECT).root, names);
        }
    } catch {
        names.clear();
    }
    const result = [...names];
    named.set(source, result);
    return result;
}

/** The named values `source` reads: every name that is not a variable, function or constant. */
export function equationParams(source: string): readonly string[] {
    return equationNames(source).filter((name) => !VARIABLE_NAMES.has(name));
}

function collectNames(node: ExpressionNode, into: Set<string>): void {
    switch (node.kind) {
        case "ref":
            into.add(node.name);
            return;
        case "unary":
            collectNames(node.operand, into);
            return;
        case "binary":
            collectNames(node.left, into);
            collectNames(node.right, into);
            return;
        case "call":
            for (const arg of node.args) collectNames(arg, into);
            return;
        default:
    }
}

function read(source: string, params: readonly string[]): Equation {
    const compile = compilerFor(params);

    const pair = splitTuple(source);
    if (pair?.length === 2) return { kind: "parametric", x: compile(pair[0], ["t"]), y: compile(pair[1], ["t"]) };

    const sides = splitTopLevel(source, "=");
    if (sides.length > 2) throw new Error("An equation has one '='");
    if (sides.length === 1) return { kind: "function", of: "x", f: compile(source, ["x"]) };

    const [left, right] = sides;
    const subject = left.trim();
    const implicit = (): Equation => {
        const l = compile(left, ["x", "y"]);
        const r = compile(right, ["x", "y"]);
        return { kind: "implicit", f: (x, y, scope) => l(x, y, scope) - r(x, y, scope) };
    };
    if (subject === "r") return { kind: "polar", f: compile(right, ["theta"]) };
    if (subject === "y" || subject === "x") {
        const of = subject === "y" ? "x" : "y";
        // `y = x + y` names its own subject on the right, so it is not a function of one variable.
        try {
            return { kind: "function", of, f: compile(right, [of]) };
        } catch (error) {
            try {
                return implicit();
            } catch {
                throw error;
            }
        }
    }
    return implicit();
}

/** `(a, b, …)` as its parts, or `null` when `source` is not one parenthesised list of two or more. */
export function splitTuple(source: string): string[] | null {
    if (!source.startsWith("(") || !source.endsWith(")")) return null;
    let depth = 0;
    for (let i = 0; i < source.length - 1; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")" && --depth === 0) return null;
    }
    const parts = splitTopLevel(source.slice(1, -1), ",");
    return parts.length >= 2 ? parts : null;
}

export function splitTopLevel(source: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === separator && depth === 0) {
            parts.push(source.slice(from, i));
            from = i + 1;
        }
    }
    parts.push(source.slice(from));
    return parts;
}
