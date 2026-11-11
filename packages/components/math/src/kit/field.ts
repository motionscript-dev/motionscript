import { memoParse } from "./cache";
import { equationNames, splitTuple } from "./equation";
import { compilerFor, type CompiledExpression } from "./expression";

/** A vector at every point of the plane, two parts in `x` and `y`: `(-y, x)`. A warp is written the same way. */
export interface FieldEquation {
    x: CompiledExpression;
    y: CompiledExpression;
}

export const FIELD_VARIABLES = ["x", "y"] as const;

const NAMES: ReadonlySet<string> = new Set(FIELD_VARIABLES);

/** The named values a field's equation reads: every name that is not `x` or `y`. */
export function fieldParams(source: string): readonly string[] {
    return equationNames(source).filter((name) => !NAMES.has(name));
}

/** `source` as a field, or the reason it is not one. */
export const parseField = memoParse<FieldEquation>(128, (text, params) => {
    const parts = splitTuple(text);
    if (parts?.length !== 2) throw new Error("A field has two parts: (x, y)");
    const compile = compilerFor(params);
    const [x, y] = parts.map((part) => compile(part, FIELD_VARIABLES));
    return { x, y };
});

/** Why `source` is not a field, or `null`; empty text is not an error. */
export function fieldError(source: string): string | null {
    if (source.trim() === "") return null;
    const field = parseField(source, fieldParams(source));
    return field instanceof Error ? field.message : null;
}
