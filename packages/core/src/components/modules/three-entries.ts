import type { Color, NormalizedColor } from "@/attributes/shape/fill/color/parser";
import { colorOps } from "@/attributes/shape/fill/lerp";
import { lerpOptionalVector3, resolveOptionalVector3, type Vector3, type Vector3Input } from "@/render3d/vector3";
import type { Type } from "@/components/factory/api";
import { Types, type EntryOptions } from "@/components/factory/types";

/** The 3D tree's entries that start unset: the renderer's own default applies until one is given. */

export function optional<T>(): Type<T | undefined> {
    return Types.custom<T | undefined>(undefined);
}

/** A number, unset until given, with a number's hints. */
export function optionalNumber<const H extends NumberHints>(hints: H): Type<number | undefined> {
    return Types.custom<number | undefined, number | undefined, H>(undefined, { kind: "number", ...hints }) as Type<number | undefined>;
}

interface NumberHints extends EntryOptions {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly unit?: string;
}

export function optionalColor(): Type<Color | undefined, NormalizedColor | undefined> {
    return Types.custom<Color | undefined, NormalizedColor | undefined>(undefined, {
        resolve: (v) => (v === undefined ? undefined : colorOps.resolve(v)),
        lerp: colorOps.lerp as (from: NormalizedColor | undefined, to: NormalizedColor | undefined, t: number) => NormalizedColor | undefined,
        kind: "color",
    });
}

/** A point, unset until given: tweening from unset starts at the origin, or snaps. */
export function optionalVector3(unset: "origin" | "snap"): Type<Vector3Input | undefined, Vector3 | undefined> {
    return Types.custom<Vector3Input | undefined, Vector3 | undefined>(undefined, {
        resolve: resolveOptionalVector3,
        lerp: (from, to, t) => lerpOptionalVector3(from, to, t, unset),
        kind: "vector3",
    });
}

/** Each of `keys` the state has set: what a scene descriptor takes. */
export function defined<T>(s: object, keys: readonly string[]): T {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
        const value = (s as Record<string, unknown>)[key];
        if (value !== undefined) out[key] = value;
    }
    return out as T;
}

/** `{ type, ...defined(s, keys) }`. */
export function stated<T>(type: string, s: object, keys: readonly string[]): T {
    return { type, ...defined<object>(s, keys) } as T;
}
