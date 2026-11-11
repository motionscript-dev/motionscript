import { memoParse } from "./cache";
import { equationError, equationNames, equationParams, EQUATION_VARIABLES, splitTopLevel, splitTuple } from "./equation";
import { compilerFor, type CompiledExpression } from "./expression";
import { fieldError, fieldParams, FIELD_VARIABLES } from "./field";

/**
 * A surface's equation, read the way it is written:
 *
 * | Written as | Is |
 * |---|---|
 * | `sin(x) * cos(y)`, `z = x^2 - y^2` | a height over `x` and `y` |
 * | `(cos(u) sin(v), sin(u) sin(v), cos(v))` | parametric, in `u` and `v` |
 */
export type SurfaceEquation =
    | { kind: "height"; f: CompiledExpression }
    | { kind: "parametric"; x: CompiledExpression; y: CompiledExpression; z: CompiledExpression };

/** A curve through space, three parts in `t`: `(cos(t), sin(t), t / 4)`. */
export interface SpaceCurveEquation {
    x: CompiledExpression;
    y: CompiledExpression;
    z: CompiledExpression;
}

/** What each 3D form is written over, for a host's help text. */
export const EQUATION_VARIABLES_3D = {
    height: ["x", "y"],
    surface: ["u", "v"],
    spaceCurve: ["t"],
} as const;

const SURFACE_NAMES: ReadonlySet<string> = new Set(["x", "y", "z", "u", "v"]);
const SPACE_CURVE_NAMES: ReadonlySet<string> = new Set(["t"]);

/** The named values a surface's equation reads: every name that is not one of its variables. */
export function surfaceParams(source: string): readonly string[] {
    return equationNames(source).filter((name) => !SURFACE_NAMES.has(name));
}

/** The named values a space curve's equation reads. */
export function spaceCurveParams(source: string): readonly string[] {
    return equationNames(source).filter((name) => !SPACE_CURVE_NAMES.has(name));
}

/** `source` as a surface, or the reason it is not one. */
export const parseSurface = memoParse<SurfaceEquation>(128, (text, params) => {
    const compile = compilerFor(params);
    const parts = splitTuple(text);
    if (parts) {
        if (parts.length !== 3) throw new Error("A parametric surface has three parts: (x, y, z)");
        const [x, y, z] = parts.map((part) => compile(part, EQUATION_VARIABLES_3D.surface));
        return { kind: "parametric", x, y, z };
    }
    const sides = splitTopLevel(text, "=");
    if (sides.length > 2) throw new Error("An equation has one '='");
    if (sides.length === 2 && sides[0].trim() !== "z") throw new Error("A surface is written z = …, or as three parts (x, y, z)");
    return { kind: "height", f: compile(sides[sides.length - 1], EQUATION_VARIABLES_3D.height) };
});

/** `source` as a space curve, or the reason it is not one. */
export const parseSpaceCurve = memoParse<SpaceCurveEquation>(128, (text, params) => {
    const compile = compilerFor(params);
    const parts = splitTuple(text);
    if (parts?.length !== 3) throw new Error("A space curve has three parts: (x, y, z)");
    const [x, y, z] = parts.map((part) => compile(part, EQUATION_VARIABLES_3D.spaceCurve));
    return { x, y, z };
});

/** Why `source` will not draw as a surface, or `null`; empty text is not an error. */
export function surfaceError(source: string): string | null {
    if (source.trim() === "") return null;
    const equation = parseSurface(source, surfaceParams(source));
    return equation instanceof Error ? equation.message : null;
}

/** Why `source` will not draw as a space curve, or `null`. */
export function spaceCurveError(source: string): string | null {
    if (source.trim() === "") return null;
    const equation = parseSpaceCurve(source, spaceCurveParams(source));
    return equation instanceof Error ? equation.message : null;
}

/** How a host checks an equation as it is typed, and finds its named values, by the `kind` its property declares. */
export interface EquationLanguage {
    error(source: string): string | null;
    params(source: string): readonly string[];
    variables: readonly string[];
}

export const EQUATION_KINDS: Readonly<
    Record<"equation" | "surfaceEquation" | "spaceCurveEquation" | "fieldEquation", EquationLanguage>
> = {
    equation: { error: equationError, params: equationParams, variables: [...new Set(Object.values(EQUATION_VARIABLES).flat())] },
    surfaceEquation: {
        error: surfaceError,
        params: surfaceParams,
        variables: [...EQUATION_VARIABLES_3D.height, ...EQUATION_VARIABLES_3D.surface],
    },
    spaceCurveEquation: { error: spaceCurveError, params: spaceCurveParams, variables: EQUATION_VARIABLES_3D.spaceCurve },
    fieldEquation: { error: fieldError, params: fieldParams, variables: FIELD_VARIABLES },
};
