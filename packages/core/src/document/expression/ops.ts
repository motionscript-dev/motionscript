/**
 * Every expression operation, on one object.
 *
 * The same shape `pathOps` has, for the same reason — one value to import, and a
 * call site one grep from its implementation. Unlike `pathOps`, `insetsOps` and
 * the rest, this is **not** an `AttributeOps`: an expression is not an attribute,
 * has no `resolve`/`lerp` pair, and nothing in `attributes/properties/typed.ts`
 * builds a property from it. Only the naming convention transfers.
 *
 * Behind it is one grammar. There were two — this one and the function-plot
 * language in `@motionscript/math` — agreeing on every rule they documented and
 * disagreeing everywhere they hadn't. The pipeline is now:
 *
 *     a prop value ── bind/collect ──▶ "=4[g]+3" ── parse ──▶ ExpressionNode
 *                       (one walk)      the marker              │
 *                                       stripped here           ▼
 *                                                        compile ──▶ () => unknown
 *
 * A dialect chooses the function library and how a reference is spelled, so
 * `sin` can be degrees here and radians in a plot without a second parser.
 */
import { DOCUMENT_DIALECT, parse, sortedKeys } from "./parse";
import { compile } from "./compile";
import { bind, bindProps, collect, isSource, renameRefs, unescape } from "./walk";
import type {
    CompiledProps, CompiledValue, ExpressionDialect, ExpressionSite,
    ParsedExpression, VariableResolver,
} from "./types";

/** {@link parse}, tolerating the `=` a raw prop value still carries. */
function parseSource(source: string, dialect: ExpressionDialect = DOCUMENT_DIALECT): ParsedExpression {
    return parse(isSource(source) ? source.slice(1) : source, dialect);
}

export interface ExpressionOps {
    // ── Recognition ────────────────────────────────────────────────────────
    /** True for a formula. `"=="` escapes a literal string starting with `=`. */
    isSource(value: unknown): value is string;
    /** Strip that escape: `"==x"` → `"=x"`. Everything else passes through. */
    unescape(value: string): string;

    // ── Reading ────────────────────────────────────────────────────────────
    /** Parse a formula, with or without its leading `=`. Throws `ExpressionError`. */
    parse(source: string, dialect?: ExpressionDialect): ParsedExpression;
    /** {@link ExpressionOps.parse} without throwing — the shape a validator wants. */
    tryParse(source: string, dialect?: ExpressionDialect): { expression: ParsedExpression } | { error: string };

    // ── Binding ────────────────────────────────────────────────────────────
    /** A parsed formula into the binding a `PropSlot` takes. */
    compile(parsed: ParsedExpression, resolve: VariableResolver, path?: string): () => unknown;
    /** One authored prop value: a plain value, or the binding an expression inside it produced. */
    bind(value: unknown, resolve: VariableResolver, path?: string): CompiledValue;
    /** A whole props bag, split into what a constructor can take and what has to be bound. */
    bindProps(props: Record<string, unknown> | undefined, resolve: VariableResolver, path?: string): CompiledProps;

    // ── Inspecting ─────────────────────────────────────────────────────────
    /** Every expression inside an authored value, with a JSON-Pointer-style path. */
    collect(value: unknown, path: string): ExpressionSite[];
    /** Rewrite the `[ref]`s inside every expression in a value; `undefined` keeps one. */
    renameRefs<T>(value: T, rename: (ref: string) => string | undefined): T;
    /** Every function name, for a host offering completion. Sorted. */
    functions(): string[];
    /** Every constant name, for a host offering completion. Sorted. */
    constants(): string[];
    /** The language a document's props are written in. */
    readonly dialect: ExpressionDialect;
}

export const expressionOps: ExpressionOps = {
    isSource,
    unescape,

    parse: parseSource,
    tryParse: (source, dialect) => {
        try {
            return { expression: parseSource(source, dialect) };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    },

    compile,
    bind,
    bindProps,

    collect,
    renameRefs,
    functions: () => sortedKeys(DOCUMENT_DIALECT.functions),
    constants: () => sortedKeys(DOCUMENT_DIALECT.constants),
    dialect: DOCUMENT_DIALECT,
};
