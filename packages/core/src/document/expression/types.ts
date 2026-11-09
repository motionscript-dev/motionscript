/**
 * Every type the expression module names, in one place.
 *
 * The vocabulary is small and worth seeing at once, because the whole module is
 * four representations and the steps between them:
 *
 *     a prop value ──▶ "=4[g]+3" ──▶ ExpressionNode ──▶ () => unknown
 *      at any depth     the marked      the AST, per       a prop binding
 *      (walk)           string          dialect (parse)    (compile)
 *
 * The `=` appears in exactly one of those steps. It marks a *document prop* as a
 * formula, which is recognition, not grammar — `=` is not a legal character in
 * any dialect — so the walk strips it and the parser never sees one.
 */

/** Thrown for a formula that cannot be parsed or whose reference resolves to nothing. */
export class ExpressionError extends Error {
    /** The formula as the parser received it: no marker, and no surrounding prop. */
    readonly source: string;
    /** Character offset into {@link source}, or `-1` when the whole thing is at fault. */
    readonly position: number;
    /** Where in the props bag it was written, JSON-Pointer style, when known. */
    readonly path?: string;

    constructor(message: string, source: string, position = -1, path?: string) {
        const where = position >= 0 ? ` (at character ${position + 1} of "${source}")` : ` (in "${source}")`;
        super(`${message}${where}${path ? ` at ${path}` : ""}`);
        this.name = "ExpressionError";
        this.source = source;
        this.position = position;
        this.path = path;
    }
}

// ── The syntax tree ──────────────────────────────────────────────────────────

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "^";

/** One node of a parsed formula. Kept public so a host can lint or rewrite one. */
export type ExpressionNode =
    | { kind: "const"; value: number }
    | { kind: "ref"; name: string }
    | { kind: "unary"; op: "-"; operand: ExpressionNode }
    | { kind: "binary"; op: BinaryOp; left: ExpressionNode; right: ExpressionNode }
    | { kind: "call"; name: string; args: ExpressionNode[] };

/** A formula, parsed. Resolver-free, so it can be checked without a scene. */
export interface ParsedExpression {
    /** The formula's text as the parser received it — no marker. */
    readonly source: string;
    readonly root: ExpressionNode;
    /** Names it reads, de-duplicated, in first-seen order. */
    readonly refs: readonly string[];
    /**
     * True when the formula is exactly one reference and nothing else.
     *
     * The passthrough case: the document's compiled binding returns the
     * variable's value untouched rather than coercing it to a number, which is
     * what lets a variable hold a colour, a `Vector2` or any other prop value.
     * A dialect whose references are bare identifiers sets it for a lone
     * variable too (`"x"`), where it means nothing — only the document's
     * compiler reads it.
     */
    readonly passthrough: boolean;
}

// ── Dialects ─────────────────────────────────────────────────────────────────

/** What the parser needs to know about a function. What it *does* is the back end's. */
export interface FnArity {
    /** Minimum and maximum argument count; `Infinity` for variadic. */
    arity: [number, number];
}

/**
 * One language over the shared grammar.
 *
 * The grammar is fixed — precedence, implicit multiplication, right-associative
 * `^`, the scientific-notation rule — and everything a language is free to
 * disagree about is here. That is what lets the document's `sin` be degrees and
 * a function plot's be radians without two parsers: the trig unit is a property
 * of a table, not of the grammar.
 */
export interface ExpressionDialect {
    /** Names callable as `f(…)`, and how many arguments each takes. */
    functions: Record<string, FnArity>;
    /** Bare identifiers that are values. Folded at parse time, so one can never also be a reference. */
    constants: Record<string, number>;
    /**
     * How a reference is spelled. `"bracket"` is `[id]`, and is the only mode in
     * which `[` is a legal character; `"bare"` makes any identifier that is not a
     * call or a constant a reference.
     */
    refs: "bracket" | "bare";
    /** What an identifier that resolves to nothing says. The document points at `[id]`; a plot does not. */
    unknownName(name: string): string;
}

// ── Compilation ──────────────────────────────────────────────────────────────

/**
 * Resolves a name to a read function, or `undefined` when nothing in the
 * document declares it. The read is what the compiled binding calls, once per
 * evaluation of the prop it drives.
 */
export type VariableResolver = (name: string) => (() => unknown) | undefined;

/**
 * A prop value, compiled: either a plain value or the binding an expression
 * somewhere inside it produced.
 */
export type CompiledValue =
    | { dynamic: false; value: unknown }
    | { dynamic: true; read: () => unknown };

/** A props bag, split into what a constructor can take and what has to be bound. */
export interface CompiledProps {
    /**
     * Props with no expression in them.
     *
     * Handed to the node's constructor as-is. A bound prop is deliberately
     * *absent* here rather than present as a placeholder: a node's constructor
     * reads its raw props to decide things like a default size, and a
     * placeholder would answer those questions with a lie.
     */
    literal: Record<string, unknown>;
    /** Field → binding, applied with `node.set()` once the variables exist. */
    bindings: Record<string, () => unknown>;
    /** True when {@link CompiledProps.bindings} has anything in it. */
    hasBindings: boolean;
}

/** One expression found in a document, and where. */
export interface ExpressionSite {
    /** JSON-Pointer-style path, matching `ValidationIssue.path`. */
    path: string;
    /** The raw prop value, `=` and all. */
    source: string;
}
