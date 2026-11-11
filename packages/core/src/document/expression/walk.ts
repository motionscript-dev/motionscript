/**
 * Recognition, and the one walk over an authored prop value, parameterized by what to do with a string. `bind`
 * returns a replacement so containers are rebuilt around it; `collect` returns its input, so nothing is
 * rebuilt. Paths are carried so an `ExpressionError` from a formula nested inside a `fill` array names the
 * prop it was written in.
 */
import { compile } from "./compile";
import { parse } from "./parse";
import type { CompiledProps, CompiledValue, ExpressionSite, VariableResolver } from "./types";

/**
 * `"=="` is the escape, so `"==total"` is the literal `"=total"`, and a bare `"="` is just that string. Both
 * are handled by {@link unescape}, which every literal path runs values through.
 */
export function isSource(value: unknown): value is string {
    return typeof value === "string" && value.length > 1 && value[0] === "=" && value[1] !== "=";
}

export function unescape(value: string): string {
    return value.startsWith("==") ? value.slice(1) : value;
}

type StringHandler = (source: string, path: string) => CompiledValue;

const STATIC = (value: unknown): CompiledValue => ({ dynamic: false, value });

/**
 * An expression is recognised at any depth because half the props worth driving are compound (`{"origin":
 * {"x": "=[g]", "y": 0}}`). A container holding one is rebuilt on each recompute; one holding none is passed
 * through by identity, so a scene using no expressions allocates nothing and compares equal to its document.
 */
function walk(value: unknown, path: string, onString: StringHandler): CompiledValue {
    if (typeof value === "string") return onString(value, path);

    if (Array.isArray(value)) {
        const parts = value.map((v, i) => walk(v, `${path}[${i}]`, onString));
        if (parts.some((p) => p.dynamic)) {
            return { dynamic: true, read: () => parts.map((p) => (p.dynamic ? p.read() : p.value)) };
        }
        /** Rebuild only if a leaf changed, so the common case keeps the document's own array. */
        const rebuilt = parts.map((p) => (p as { value: unknown }).value);
        return STATIC(rebuilt.every((v, i) => v === value[i]) ? value : rebuilt);
    }

    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        const parts = keys.map((k) => walk(value[k], `${path}.${k}`, onString));
        if (parts.some((p) => p.dynamic)) {
            return {
                dynamic: true,
                read: () => {
                    const out: Record<string, unknown> = {};
                    keys.forEach((k, i) => {
                        const part = parts[i];
                        out[k] = part.dynamic ? part.read() : part.value;
                    });
                    return out;
                },
            };
        }
        if (!parts.some((p, i) => (p as { value: unknown }).value !== value[keys[i]])) return STATIC(value);
        const rebuilt: Record<string, unknown> = {};
        keys.forEach((k, i) => { rebuilt[k] = (parts[i] as { value: unknown }).value; });
        return STATIC(rebuilt);
    }

    return STATIC(value);
}

export function bind(value: unknown, resolve: VariableResolver, path = "props"): CompiledValue {
    return walk(value, path, (source, at) =>
        isSource(source)
            /**
             * The `=` is the document's marker, not the grammar's: strip it here and the parser never sees one.
             */
            ? { dynamic: true, read: compile(parse(source.slice(1)), resolve, at) }
            : STATIC(unescape(source)));
}

export function bindProps(
    props: Record<string, unknown> | undefined,
    resolve: VariableResolver,
    path = "props",
): CompiledProps {
    const literal: Record<string, unknown> = {};
    const bindings: Record<string, () => unknown> = {};
    let hasBindings = false;

    for (const key of Object.keys(props ?? {})) {
        const compiled = bind(props![key], resolve, `${path}.${key}`);
        if (compiled.dynamic) {
            bindings[key] = compiled.read;
            hasBindings = true;
        } else {
            literal[key] = compiled.value;
        }
    }
    return { literal, bindings, hasBindings };
}

/** Used by the validator, to check each parses and names a declared variable before anything is built. */
export function collect(value: unknown, path: string): ExpressionSite[] {
    const out: ExpressionSite[] = [];
    walk(value, path, (source, at) => {
        if (isSource(source)) out.push({ path: at, source });
        return STATIC(source);
    });
    return out;
}

/** The grammar has no string literals, so a `[` is always a reference. */
const REF = /\[([^[\]]+)\]/g;

/**
 * `rename` sees each reference as written (`"fade"`, `"card.x"`) and returns its replacement, or `undefined`
 * to keep it; for a host moving a subtree between documents. A value with nothing to rewrite comes back by
 * identity, as with {@link bind}.
 */
export function renameRefs<T>(value: T, rename: (ref: string) => string | undefined): T {
    const result = walk(value, "", (source) => {
        if (!isSource(source)) return STATIC(source);
        return STATIC(source.replace(REF, (whole, ref: string) => {
            // The parser trims a reference's name (`[ g ]` reads `g`), so the callback sees it trimmed too.
            const next = rename(ref.trim());
            return next === undefined ? whole : `[${next}]`;
        }));
    });
    return (result as { value: T }).value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
