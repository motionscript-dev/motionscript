/**
 * Recognition, and the one walk over an authored prop value.
 *
 * There were two walks — one compiling, one collecting — with the same three
 * cases and different leaves, and they had already drifted: the compiling one
 * read `Object.keys`, the collecting one `for…in`. Neither carried a path, so an
 * `ExpressionError` from a formula nested inside a `fill` array named the
 * formula and left the reader to find which prop it was written in.
 *
 * One recursion now, parameterized by what to do with a string. `bind` returns a
 * replacement, so containers are rebuilt around it; `collect` returns its input,
 * so nothing is rebuilt and the result is thrown away.
 */
import { compile } from "./compile";
import { parse } from "./parse";
import type { CompiledProps, CompiledValue, ExpressionSite, VariableResolver } from "./types";

/**
 * True when a value is a formula rather than a string.
 *
 * `"=="` is the escape, so `"==total"` is the literal `"=total"` and not an
 * expression; a bare `"="` is likewise just that string. Both are handled by
 * {@link unescape}, which every literal path runs values through.
 */
export function isSource(value: unknown): value is string {
    return typeof value === "string" && value.length > 1 && value[0] === "=" && value[1] !== "=";
}

/** Strip the escape from a literal string that begins with `=`. `"==x"` → `"=x"`. */
export function unescape(value: string): string {
    return value.startsWith("==") ? value.slice(1) : value;
}

/** What the walk does with each string it reaches. Returns the value to put back. */
type StringHandler = (source: string, path: string) => CompiledValue;

const STATIC = (value: unknown): CompiledValue => ({ dynamic: false, value });

/**
 * Visit every string in an authored value, at any depth.
 *
 * An expression is recognised at any depth, not just as a whole prop, because
 * half the props worth driving are compound: `{"origin": {"x": "=[g]", "y": 0}}`,
 * `{"fill": ["#111", {"type": "solid", "color": "=[c]"}]}`. A container holding
 * one is rebuilt on each recompute; a container holding none is passed through
 * **by identity**, so a scene that uses no expressions allocates nothing and
 * compares equal to the document it came from.
 */
function walk(value: unknown, path: string, onString: StringHandler): CompiledValue {
    if (typeof value === "string") return onString(value, path);

    if (Array.isArray(value)) {
        const parts = value.map((v, i) => walk(v, `${path}[${i}]`, onString));
        if (parts.some((p) => p.dynamic)) {
            return { dynamic: true, read: () => parts.map((p) => (p.dynamic ? p.read() : p.value)) };
        }
        // Rebuild only if a leaf actually changed, so the common case keeps the
        // document's own array.
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

/** Compile one authored prop value: a plain value, or the binding it produced. */
export function bind(value: unknown, resolve: VariableResolver, path = "props"): CompiledValue {
    return walk(value, path, (source, at) =>
        isSource(source)
            // The `=` is the document's marker, not the grammar's — strip it here
            // and the parser never sees one.
            ? { dynamic: true, read: compile(parse(source.slice(1)), resolve, at) }
            : STATIC(unescape(source)));
}

/** Compile a whole props bag. See {@link CompiledProps}. */
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

/**
 * Find every expression inside an authored value, at any depth.
 *
 * Used by the validator, which checks that each one parses and names a declared
 * variable — the two failures worth catching before anything is built.
 */
export function collect(value: unknown, path: string): ExpressionSite[] {
    const out: ExpressionSite[] = [];
    walk(value, path, (source, at) => {
        if (isSource(source)) out.push({ path: at, source });
        return STATIC(source);
    });
    return out;
}

/** A bracketed reference. The grammar has no string literals, so a `[` is always one. */
const REF = /\[([^[\]]+)\]/g;

/**
 * Rewrite the references inside every expression in an authored value.
 *
 * `rename` sees each reference as written (`"fade"`, `"card.x"`) and returns its
 * replacement, or `undefined` to keep it. What a host moving a subtree between
 * documents needs when ids or keys change on the way; a value with nothing to
 * rewrite comes back **by identity**, the same as {@link bind}'s static path.
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
