import type { LerpFunction } from "@/tween/lerp";
import type { RectCornerRadius, CornerRadiusResolved } from "@/attributes/shape/corners/corner-radius";

/** The mapper + lerp pair behind every tweenable attribute: `resolve` turns loose author input (a CSS string, a shorthand object, a resolved value) into the strict `TResolved` a renderer reads, and `lerp` interpolates two resolved values. It is the pair `property`'s `mapper`/`tween` options take (see `attributes/properties/typed.ts`). */
export interface AttributeOps<TInput, TResolved> {
    resolve(value: TInput, previous?: TResolved): TResolved;
    lerp: LerpFunction<TResolved>;
}

/** An attribute whose resolved value can collapse to one value shared by every component. */
export interface HasUniformCheck<TInput, T> {
    isUniformInput(value: TInput): boolean;
    isUniform(value: T): boolean;
}

/** An attribute whose resolved value can be entirely zero. */
export interface HasZeroCheck<TResolved> {
    isZero(value: TResolved): boolean;
}

/** The corner-radius attribute's full op set — see `shape/corners/corner-radius.ts`. */
export type CornerRadiusOps = AttributeOps<RectCornerRadius, CornerRadiusResolved>
    & HasUniformCheck<RectCornerRadius, CornerRadiusResolved>
    & HasZeroCheck<CornerRadiusResolved>;
