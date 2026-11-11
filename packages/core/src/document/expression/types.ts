/**
 * The module is four representations and the steps between them: a prop value, the marked string `"=4[g]+3"`,
 * the AST per dialect (parse), and a prop binding (compile). The `=` marks a document prop as a formula, which
 * is recognition, not grammar (`=` is no dialect's character), so the walk strips it and the parser never sees
 * one.
 */

/** Thrown for a formula that cannot be parsed or whose reference resolves to nothing. */
export class ExpressionError extends Error {
    readonly source: string;
    readonly position: number;
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

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "^";

/** Public so a host can lint or rewrite one. */
export type ExpressionNode =
    | { kind: "const"; value: number }
    | { kind: "ref"; name: string }
    | { kind: "unary"; op: "-"; operand: ExpressionNode }
    | { kind: "binary"; op: BinaryOp; left: ExpressionNode; right: ExpressionNode }
    | { kind: "call"; name: string; args: ExpressionNode[] };

/** Resolver-free, so it can be checked without a scene. */
export interface ParsedExpression {
    readonly source: string;
    readonly root: ExpressionNode;
    readonly refs: readonly string[];
    /**
     * True when the formula is exactly one reference. The document's compiled binding then returns the variable's
     * value untouched rather than coercing it to a number, which lets a variable hold a colour or `Vector2`. A
     * dialect with bare-identifier references sets it for a lone variable too (`"x"`), where it means nothing;
     * only the document's compiler reads it.
     */
    readonly passthrough: boolean;
}

export interface FnArity {
    arity: [number, number];
}

/**
 * The grammar is fixed (precedence, implicit multiplication, right-associative `^`, scientific notation); what
 * a language may disagree about is here. That is how the document's `sin` is degrees and a function plot's
 * radians without two parsers.
 */
export interface ExpressionDialect {
    functions: Record<string, FnArity>;
    constants: Record<string, number>;
    /**
     * `"bracket"` is `[id]` and the only mode where `[` is a legal character; `"bare"` makes any identifier that
     * is not a call or a constant a reference.
     */
    refs: "bracket" | "bare";
    unknownName(name: string): string;
}

/** The read is what the compiled binding calls, once per evaluation of the prop it drives. */
export type VariableResolver = (name: string) => (() => unknown) | undefined;

export type CompiledValue =
    | { dynamic: false; value: unknown }
    | { dynamic: true; read: () => unknown };

export interface CompiledProps {
    /**
     * Handed to the node's constructor as-is. A bound prop is absent here rather than a placeholder: a constructor
     * reads raw props for things like a default size, and a placeholder would answer with a lie.
     */
    literal: Record<string, unknown>;
    bindings: Record<string, () => unknown>;
    hasBindings: boolean;
}

export interface ExpressionSite {
    path: string;
    source: string;
}
