import { createBoundedCache } from "./cache";
import { equationNames, splitTuple } from "./equation";
import { compileExpressionCached, type CompiledExpression } from "./expression";

/** A vector at every point of the plane, two parts in `x` and `y`: `(-y, x)`. A warp is written the same way. */
export interface FieldEquation {
    x: CompiledExpression;
    y: CompiledExpression;
}

export const FIELD_VARIABLES = ["x", "y"] as const;

const NAMES: ReadonlySet<string> = new Set(FIELD_VARIABLES);
const fields = createBoundedCache<FieldEquation | Error>(128);

/** The named values a field's equation reads: every name that is not `x` or `y`. */
export function fieldParams(source: string): readonly string[] {
    return equationNames(source).filter((name) => !NAMES.has(name));
}

/** `source` as a field, or the reason it is not one. Memoised, so an unchanged equation is the identical object. */
export function parseField(source: string, params: readonly string[] = []): FieldEquation | Error {
    const key = `${params.join(",")}|${source}`;
    const hit = fields.get(key);
    if (hit !== undefined) return hit;
    let result: FieldEquation | Error;
    try {
        const text = source.trim();
        if (text === "") throw new Error("Empty equation");
        const parts = splitTuple(text);
        if (parts?.length !== 2) throw new Error("A field has two parts: (x, y)");
        const [x, y] = parts.map((part) => {
            const compiled = compileExpressionCached(part.trim(), FIELD_VARIABLES, params);
            if (compiled instanceof Error) throw compiled;
            return compiled;
        });
        result = { x, y };
    } catch (error) {
        result = error instanceof Error ? error : new Error(String(error));
    }
    fields.set(key, result);
    return result;
}

/** Why `source` is not a field, or `null`; empty text is not an error. */
export function fieldError(source: string): string | null {
    if (source.trim() === "") return null;
    const field = parseField(source, fieldParams(source));
    return field instanceof Error ? field.message : null;
}
