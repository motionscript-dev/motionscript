/**
 * The one scanner and the one grammar, plus the document's own dialect.
 *
 * There were two of each — this module's, and the function-plot language in
 * `@motionscript/math` — and they agreed on every rule they documented while
 * disagreeing on the parts nobody wrote down. Plot scanned `1.2.3` as a single
 * token, which `Number` turned into a `NaN` that parsed, compiled and rendered
 * an entirely invisible surface with no diagnostic anywhere. It treated `\r` as
 * an unexpected character, so a pasted CRLF equation failed. It checked no arity
 * on its variadic functions, so `atan2(1)` was a silent `NaN`.
 *
 * What the two genuinely disagree about is a *table*: which functions exist,
 * whether `sin` takes degrees or radians, and how a reference is spelled. That
 * is {@link ExpressionDialect}, and it is the only thing this file is
 * parameterized by.
 *
 * Precedence is the ordinary arithmetic one, with `^` right-associative and
 * **implicit multiplication** between adjacent primaries — which is what makes
 * `4[g]+3` mean what it reads as. Note `unary` sits *above* `power`, so `-2^2`
 * is `-4` as in maths, and the exponent parses as a unary so `2^3^2` is 512 and
 * `2^-3` is legal.
 */
import { ExpressionError } from "./types";
import type { BinaryOp, ExpressionDialect, ExpressionNode, FnArity, ParsedExpression } from "./types";

const DEG = Math.PI / 180;

interface DocumentFn extends FnArity {
    apply(args: number[]): number;
}

/**
 * The document's function library.
 *
 * Deliberately small and closed: an expression is stored in a document and
 * evaluated by whatever version of the library opens it later, so every name
 * here is as much a public contract as an exported symbol. Trig is in **degrees**
 * because every other angle in the library is.
 */
export const DOCUMENT_FUNCTIONS: Record<string, DocumentFn> = {
    abs: { arity: [1, 1], apply: (a) => Math.abs(a[0]) },
    sign: { arity: [1, 1], apply: (a) => Math.sign(a[0]) },
    sqrt: { arity: [1, 1], apply: (a) => Math.sqrt(a[0]) },
    floor: { arity: [1, 1], apply: (a) => Math.floor(a[0]) },
    ceil: { arity: [1, 1], apply: (a) => Math.ceil(a[0]) },
    round: { arity: [1, 2], apply: (a) => (a.length > 1 && a[1] !== 0 ? Math.round(a[0] / a[1]) * a[1] : Math.round(a[0])) },
    min: { arity: [1, Infinity], apply: (a) => Math.min(...a) },
    max: { arity: [1, Infinity], apply: (a) => Math.max(...a) },
    clamp: { arity: [3, 3], apply: (a) => Math.min(Math.max(a[0], a[1]), a[2]) },
    mod: { arity: [2, 2], apply: (a) => ((a[0] % a[1]) + a[1]) % a[1] },
    pow: { arity: [2, 2], apply: (a) => a[0] ** a[1] },
    log: { arity: [1, 2], apply: (a) => (a.length > 1 ? Math.log(a[0]) / Math.log(a[1]) : Math.log(a[0])) },
    exp: { arity: [1, 1], apply: (a) => Math.exp(a[0]) },
    mix: { arity: [3, 3], apply: (a) => a[0] + (a[1] - a[0]) * a[2] },
    smoothstep: {
        arity: [3, 3],
        apply: (a) => {
            if (Number.isNaN(a[0]) || Number.isNaN(a[1]) || Number.isNaN(a[2])) return NaN;
            // Equal edges: a step at the edge, like `step` — no divide by zero.
            if (a[0] === a[1]) return a[2] < a[0] ? 0 : 1;
            const t = Math.min(Math.max((a[2] - a[0]) / (a[1] - a[0]), 0), 1);
            return t * t * (3 - 2 * t);
        },
    },
    step: { arity: [2, 2], apply: (a) => (Number.isNaN(a[0]) || Number.isNaN(a[1]) ? NaN : a[1] < a[0] ? 0 : 1) },
    sin: { arity: [1, 1], apply: (a) => Math.sin(a[0] * DEG) },
    cos: { arity: [1, 1], apply: (a) => Math.cos(a[0] * DEG) },
    tan: { arity: [1, 1], apply: (a) => Math.tan(a[0] * DEG) },
    asin: { arity: [1, 1], apply: (a) => Math.asin(a[0]) / DEG },
    acos: { arity: [1, 1], apply: (a) => Math.acos(a[0]) / DEG },
    atan: { arity: [1, 1], apply: (a) => Math.atan(a[0]) / DEG },
    atan2: { arity: [2, 2], apply: (a) => Math.atan2(a[0], a[1]) / DEG },
    hypot: { arity: [2, Infinity], apply: (a) => Math.hypot(...a) },
};

/** Bare identifiers that are values rather than calls. */
const DOCUMENT_CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    tau: Math.PI * 2,
    e: Math.E,
};

/** The language a `"=…"` prop is written in. */
export const DOCUMENT_DIALECT: ExpressionDialect = {
    functions: DOCUMENT_FUNCTIONS,
    constants: DOCUMENT_CONSTANTS,
    refs: "bracket",
    unknownName: (name) =>
        `unknown name "${name}" — a variable is referenced as "[${name}]"; ` +
        `bare names are the constants ${sortedKeys(DOCUMENT_CONSTANTS).join(", ")}`,
};

/** Sorted, so a message or a completion list is stable. */
export function sortedKeys(table: Record<string, unknown>): string[] {
    return Object.keys(table).sort();
}

// ── Scanner ──────────────────────────────────────────────────────────────────

type TokenKind = "number" | "ref" | "ident" | "op" | "(" | ")" | "," | "end";

interface Token {
    kind: TokenKind;
    /** The identifier, operator or reference name. Empty for numbers. */
    text: string;
    /** Parsed value, for numbers. */
    value: number;
    pos: number;
}

const OPERATORS = new Set(["+", "-", "*", "/", "%", "^"]);

function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= "0" && ch <= "9";
}

function tokenize(source: string, dialect: ExpressionDialect): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < source.length) {
        const ch = source[i];

        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
            i++;
            continue;
        }

        if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
            const start = i;
            while (isDigit(source[i])) i++;
            if (source[i] === ".") {
                i++;
                while (isDigit(source[i])) i++;
            }
            if (source[i] === "e" || source[i] === "E") {
                const mark = i;
                i++;
                if (source[i] === "+" || source[i] === "-") i++;
                if (isDigit(source[i])) {
                    while (isDigit(source[i])) i++;
                } else {
                    // `2e` followed by something else is `2` times the identifier
                    // `e`, not a malformed exponent.
                    i = mark;
                }
            }
            // A second `.` ends a number that has already had one. Both parsers
            // this replaces got here differently and both got it wrong: one
            // scanned `1.2.3` as a single token that `Number` turned into a
            // silent `NaN`, the other split it into `1.2 * 0.3`. Neither is
            // anything anyone wrote on purpose.
            if (source[i] === ".") throw new ExpressionError('unexpected character "."', source, i);
            tokens.push({ kind: "number", text: "", value: Number(source.slice(start, i)), pos: start });
            continue;
        }

        // `[` is legal only where a reference is spelled with one, so a plot
        // equation gets "unexpected character" here rather than failing later
        // with a message about variable references it has never heard of.
        if (ch === "[" && dialect.refs === "bracket") {
            const start = i;
            const end = source.indexOf("]", i + 1);
            if (end === -1) throw new ExpressionError("unclosed `[` — a variable reference is written `[id]`", source, start);
            const name = source.slice(i + 1, end).trim();
            if (name.length === 0) throw new ExpressionError("empty variable reference `[]`", source, start);
            if (name.includes("[")) throw new ExpressionError("variable references cannot nest", source, start);
            tokens.push({ kind: "ref", text: name, value: 0, pos: start });
            i = end + 1;
            continue;
        }

        if (/[A-Za-z_]/.test(ch)) {
            const start = i;
            while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i++;
            tokens.push({ kind: "ident", text: source.slice(start, i), value: 0, pos: start });
            continue;
        }

        if (OPERATORS.has(ch)) {
            tokens.push({ kind: "op", text: ch, value: 0, pos: i++ });
            continue;
        }
        if (ch === "(" || ch === ")" || ch === ",") {
            tokens.push({ kind: ch as TokenKind, text: ch, value: 0, pos: i++ });
            continue;
        }

        throw new ExpressionError(`unexpected character "${ch}"`, source, i);
    }

    tokens.push({ kind: "end", text: "", value: 0, pos: source.length });
    return tokens;
}

// ── Grammar ──────────────────────────────────────────────────────────────────

/**
 * Parse a formula against a dialect.
 *
 * `source` is the formula alone — the document's `=` is stripped by the walk
 * that recognised it, because the marker is not part of any grammar.
 */
export function parse(source: string, dialect: ExpressionDialect = DOCUMENT_DIALECT): ParsedExpression {
    if (source.trim().length === 0) throw new ExpressionError("empty expression", source);

    const tokens = tokenize(source, dialect);
    const refs: string[] = [];
    let index = 0;

    const peek = (): Token => tokens[index];
    const next = (): Token => tokens[index++];

    const addRef = (name: string): ExpressionNode => {
        if (!refs.includes(name)) refs.push(name);
        return { kind: "ref", name };
    };

    /** True when the token can begin a primary — the test implicit `*` turns on. */
    const startsPrimary = (t: Token): boolean =>
        t.kind === "number" || t.kind === "ref" || t.kind === "ident" || t.kind === "(";

    function parseAdditive(): ExpressionNode {
        let left = parseMultiplicative();
        for (;;) {
            const t = peek();
            if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
                next();
                left = { kind: "binary", op: t.text, left, right: parseMultiplicative() };
                continue;
            }
            return left;
        }
    }

    function parseMultiplicative(): ExpressionNode {
        let left = parseUnary();
        for (;;) {
            const t = peek();
            if (t.kind === "op" && (t.text === "*" || t.text === "/" || t.text === "%")) {
                next();
                left = { kind: "binary", op: t.text as BinaryOp, left, right: parseUnary() };
                continue;
            }
            // `4[g]`, `2(x+1)`, `[a][b]`, `2pi` — juxtaposition is multiplication.
            if (startsPrimary(t)) {
                left = { kind: "binary", op: "*", left, right: parseUnary() };
                continue;
            }
            return left;
        }
    }

    function parseUnary(): ExpressionNode {
        const t = peek();
        if (t.kind === "op" && (t.text === "-" || t.text === "+")) {
            next();
            const operand = parseUnary();
            return t.text === "-" ? { kind: "unary", op: "-", operand } : operand;
        }
        return parsePower();
    }

    function parsePower(): ExpressionNode {
        const base = parsePrimary();
        const t = peek();
        if (t.kind === "op" && t.text === "^") {
            next();
            // Right-associative, and binding tighter than unary minus on its
            // right: `2^-1` is a half, not an error.
            return { kind: "binary", op: "^", left: base, right: parseUnary() };
        }
        return base;
    }

    function parseCall(name: string, pos: number): ExpressionNode {
        // Own keys only: `toString(1)` must be an unknown function, not a lookup
        // that finds `Object.prototype`'s.
        const def = Object.hasOwn(dialect.functions, name) ? dialect.functions[name] : undefined;
        if (!def) {
            throw new ExpressionError(
                `unknown function "${name}" — available: ${sortedKeys(dialect.functions).join(", ")}`,
                source, pos,
            );
        }
        const args: ExpressionNode[] = [];
        if (peek().kind !== ")") {
            for (;;) {
                args.push(parseAdditive());
                if (peek().kind !== ",") break;
                next();
            }
        }
        const close = next();
        if (close.kind !== ")") throw new ExpressionError(`expected \`)\` closing ${name}(`, source, close.pos);

        const [min, max] = def.arity;
        if (args.length < min || args.length > max) {
            const want = max === Infinity ? `at least ${min}` : min === max ? `${min}` : `${min}–${max}`;
            // Singular only when `want` names the number one (`1`, `at least 1`), never for a range.
            const plural = (max === Infinity || min === max) && min === 1 ? "" : "s";
            throw new ExpressionError(
                `${name}() takes ${want} argument${plural}, got ${args.length}`,
                source, pos,
            );
        }
        return { kind: "call", name, args };
    }

    function parsePrimary(): ExpressionNode {
        const t = next();
        switch (t.kind) {
            case "number":
                return { kind: "const", value: t.value };
            case "ref":
                return addRef(t.text);
            case "(": {
                const inner = parseAdditive();
                const close = next();
                if (close.kind !== ")") throw new ExpressionError("expected `)`", source, close.pos);
                return inner;
            }
            case "ident": {
                if (peek().kind === "(") {
                    next();
                    return parseCall(t.text, t.pos);
                }
                // A constant is folded here, before a bare identifier can become
                // a reference — so a dialect's constant name can never also be
                // one of its free variables.
                const constant = Object.hasOwn(dialect.constants, t.text) ? dialect.constants[t.text] : undefined;
                if (constant !== undefined) return { kind: "const", value: constant };
                if (dialect.refs === "bare") return addRef(t.text);
                throw new ExpressionError(dialect.unknownName(t.text), source, t.pos);
            }
            default:
                throw new ExpressionError(
                    t.kind === "end" ? "expression ends early" : `unexpected "${t.text}"`,
                    source, t.pos,
                );
        }
    }

    const root = parseAdditive();
    const trailing = peek();
    if (trailing.kind !== "end") throw new ExpressionError(`unexpected "${trailing.text}"`, source, trailing.pos);

    return { source, root, refs, passthrough: root.kind === "ref" };
}
