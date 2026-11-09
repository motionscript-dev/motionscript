import { expressionOps } from "@motionscript/sdk";
import type { ExpressionDialect, ExpressionNode } from "@motionscript/sdk";
import { createBoundedCache } from "./cache";

/**
 * The language a plot's equation is written in: the engine's own expression
 * grammar (`expressionOps.parse`) under a dialect of its own, where trig is in
 * radians, names are bare identifiers, and the logs and hyperbolics a plot
 * wants are present. Never `new Function`: an equation is text stored in a
 * document, and the shared parser can only produce arithmetic.
 */

/** Named values an expression reads at call time, beside its two variables. */
export type ExpressionScope = Readonly<Record<string, number>>;

/**
 * A compiled expression. The two variables are fixed slots because this is the
 * hot path of every sampled curve; a one-variable expression never reads `b`.
 */
export type CompiledExpression = (a: number, b: number, scope?: ExpressionScope) => number;

const UNARY: Record<string, (v: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
    log: Math.log, ln: Math.log, log2: Math.log2, log10: Math.log10,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, trunc: Math.trunc,
};

const NARY: Record<string, { fn: (...args: number[]) => number; arity: [number, number] }> = {
    atan2: { fn: Math.atan2, arity: [2, 2] },
    pow: { fn: Math.pow, arity: [2, 2] },
    mod: { fn: (a, b) => a % b, arity: [2, 2] },
    hypot: { fn: Math.hypot, arity: [1, Infinity] },
    min: { fn: Math.min, arity: [1, Infinity] },
    max: { fn: Math.max, arity: [1, Infinity] },
};

const CONSTANTS: Record<string, number> = {
    pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
};

export const MATH_DIALECT: ExpressionDialect = {
    functions: {
        ...Object.fromEntries(Object.keys(UNARY).map((name) => [name, { arity: [1, 1] as [number, number] }])),
        ...Object.fromEntries(Object.entries(NARY).map(([name, { arity }]) => [name, { arity }])),
    },
    constants: CONSTANTS,
    refs: "bare",
    unknownName: (name) => `Unknown name '${name}'`,
};

/** What an expression may name, for a host's "what can I write here" help. */
export interface ExpressionVocabulary {
    variables: readonly string[];
    functions: readonly string[];
    constants: readonly string[];
}

export function expressionVocabulary(variables: readonly string[]): ExpressionVocabulary {
    return {
        variables,
        functions: [...Object.keys(UNARY), ...Object.keys(NARY)].sort(),
        constants: ["pi", "e", "tau", "phi"],
    };
}

/**
 * Compile `source` over up to two `variables`, in slot order, and any `params`
 * it may read from the scope. Throws on a syntax error or an unknown name.
 */
export function compileExpression(
    source: string,
    variables: readonly string[],
    params: readonly string[] = [],
): CompiledExpression {
    // The parser folds a constant before it yields a reference, so a name that
    // is both would silently stop being the variable it was passed as.
    for (const name of [...variables, ...params]) {
        if (Object.hasOwn(CONSTANTS, name)) throw new Error(`'${name}' is a constant, so it cannot be a variable`);
    }
    return emit(expressionOps.parse(source, MATH_DIALECT).root, variables, params);
}

function emit(node: ExpressionNode, variables: readonly string[], params: readonly string[]): CompiledExpression {
    switch (node.kind) {
        case "const": {
            const { value } = node;
            return () => value;
        }
        case "ref": {
            const { name } = node;
            const slot = variables.indexOf(name);
            if (slot === 0) return (a) => a;
            if (slot === 1) return (_a, b) => b;
            if (params.includes(name)) return (_a, _b, scope) => scope?.[name] ?? NaN;
            throw new Error(MATH_DIALECT.unknownName(name));
        }
        case "unary": {
            const operand = emit(node.operand, variables, params);
            return (a, b, s) => -operand(a, b, s);
        }
        case "binary": {
            const l = emit(node.left, variables, params);
            const r = emit(node.right, variables, params);
            switch (node.op) {
                case "+": return (a, b, s) => l(a, b, s) + r(a, b, s);
                case "-": return (a, b, s) => l(a, b, s) - r(a, b, s);
                case "*": return (a, b, s) => l(a, b, s) * r(a, b, s);
                case "/": return (a, b, s) => l(a, b, s) / r(a, b, s);
                case "%": return (a, b, s) => l(a, b, s) % r(a, b, s);
                case "^": return (a, b, s) => Math.pow(l(a, b, s), r(a, b, s));
            }
            break;
        }
        case "call": {
            const args = node.args.map((arg) => emit(arg, variables, params));
            const unary = UNARY[node.name];
            if (unary) {
                const [x] = args;
                return (a, b, s) => unary(x(a, b, s));
            }
            const { fn } = NARY[node.name];
            // The common arity, so the hot path allocates no array per sample.
            if (args.length === 2) {
                const [x, y] = args;
                return (a, b, s) => fn(x(a, b, s), y(a, b, s));
            }
            return (a, b, s) => fn(...args.map((arg) => arg(a, b, s)));
        }
    }
    throw new Error("Unsupported expression");
}

const compiled = createBoundedCache<CompiledExpression | Error>(256);

/**
 * {@link compileExpression}, memoised: equal source under equal names is the
 * identical closure, so "did this expression change" is an `===`, and a failure
 * is remembered rather than re-parsed every frame.
 */
export function compileExpressionCached(
    source: string,
    variables: readonly string[],
    params: readonly string[] = [],
): CompiledExpression | Error {
    const key = `${variables.join(",")}|${params.join(",")}|${source}`;
    const hit = compiled.get(key);
    if (hit !== undefined) return hit;
    let result: CompiledExpression | Error;
    try {
        result = compileExpression(source, variables, params);
    } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
    }
    compiled.set(key, result);
    return result;
}
