/**
 * Every expression operation on one object, the shape `pathOps` has. Unlike `pathOps` it is not an
 * `AttributeOps`: an expression is not an attribute and has no `resolve`/`lerp` pair; only the naming
 * convention transfers. One grammar is behind it, with a dialect choosing the function library and reference
 * spelling, so `sin` is degrees here and radians in a plot.
 */
import { DOCUMENT_DIALECT, parse, sortedKeys } from "./parse";
import { compile } from "./compile";
import { bind, bindProps, collect, isSource, renameRefs, unescape } from "./walk";
import type {
    CompiledProps, CompiledValue, ExpressionDialect, ExpressionSite,
    ParsedExpression, VariableResolver,
} from "./types";

function parseSource(source: string, dialect: ExpressionDialect = DOCUMENT_DIALECT): ParsedExpression {
    return parse(isSource(source) ? source.slice(1) : source, dialect);
}

export interface ExpressionOps {
    /** `"=="` escapes a literal string starting with `=`. */
    isSource(value: unknown): value is string;
    unescape(value: string): string;

    /** Parse a formula, with or without its leading `=`. */
    parse(source: string, dialect?: ExpressionDialect): ParsedExpression;
    tryParse(source: string, dialect?: ExpressionDialect): { expression: ParsedExpression } | { error: string };

    compile(parsed: ParsedExpression, resolve: VariableResolver, path?: string): () => unknown;
    bind(value: unknown, resolve: VariableResolver, path?: string): CompiledValue;
    bindProps(props: Record<string, unknown> | undefined, resolve: VariableResolver, path?: string): CompiledProps;

    collect(value: unknown, path: string): ExpressionSite[];
    /** `undefined` keeps one. */
    renameRefs<T>(value: T, rename: (ref: string) => string | undefined): T;
    functions(): string[];
    constants(): string[];
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
