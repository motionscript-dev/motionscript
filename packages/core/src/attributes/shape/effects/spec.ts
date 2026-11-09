import { lerpNumber } from "@/tween/lerp";
import { lerpVector2, type Vector2 } from "@/attributes/layout/vector2";
import { lerpColor } from "@/attributes/shape/fill/lerp";
import type { Color } from "@/attributes/shape/fill/color/parser";
import type { AssetScope } from "@/assets/scope";
import type { EffectAxis, EffectData, EffectMode, EffectOptions, EffectSurface, ModedEffect } from "./effect-data";
import { resolveEffectColor, sameEffectAxis, sameEffectColor, scalarOptions, withEffectOptions } from "./effect-data";

/**
 * How a parameter's value is shaped, which decides its default interpolation,
 * equality and how a renderer encodes it into a uniform.
 */
export type EffectParamKind =
    | "number"
    | "color"
    | "vec2"
    | "enum"
    | "boolean"
    | "axis"
    | "text"
    | "colors"
    | "numbers"
    | "points"
    | "table"
    | "uniforms";

/** What a number measures, for a host's units and a renderer's scaling. */
export type EffectParamUnit = "px" | "deg" | "percent" | "factor" | "normalized";

/** The picker family an effect is listed under. */
export type EffectGroup = "blur" | "light" | "color" | "stylize" | "distort" | "glitch";

/** The control an inspector should draw for a parameter. */
export type EffectParamControl = "number" | "slider" | "angle" | "hue" | "segmented" | "select" | "text" | "color" | "point" | "toggle";

/** Per-parameter inspector hints. None of them changes what the effect does. */
export interface EffectParamHints {
    /** i18n leaf for the field's label; defaults to the parameter name. */
    readonly label?: string;
    readonly control?: EffectParamControl;
    /** Shown on the effect's row beside its name (one per effect). */
    readonly inline?: boolean;
    /** Inspector position; defaults to the declaration order. */
    readonly order?: number;
    /** For an angle: where 0° points (the bearing turns clockwise). Defaults to `"right"`. */
    readonly zero?: "right" | "top";
    /** i18n group for an enum's option labels. */
    readonly optionsLabel?: string;
    /** Not offered as a field: the value a fresh effect carries is kept as is. */
    readonly hidden?: boolean;
    /** Where a freshly inserted effect starts, when the builder default would show nothing. */
    readonly initial?: unknown;
}

/** Interpolates one parameter. `from`/`to` are the whole effects, for parameters that depend on a sibling. */
export type EffectParamLerp<T> = (a: T, b: T, t: number, from: Record<string, unknown>, to: Record<string, unknown>) => T;

/**
 * One parameter of a built-in effect: a stored field of the effect object.
 *
 * `T` is the stored type, `In` what a builder accepts for it (`normalize` maps
 * one to the other: a bare number for a per-axis count, say). Only the
 * serialisable fields reach {@link EffectDescriptor}.
 */
export interface EffectParamDef<T = unknown, In = T> extends EffectParamHints {
    readonly kind: EffectParamKind;
    /** What the builder writes when the option is omitted (an input, before `normalize`). */
    readonly default?: In;
    /** The stored field may be absent (`colorAdjustment`'s fields, `curves.channel`). */
    readonly optional?: boolean;
    /** The builder's options type requires it. */
    readonly required?: boolean;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly unit?: EffectParamUnit;
    /** An enum's values, in the order a renderer indexes them. */
    readonly options?: readonly (string | number)[];
    readonly normalize?: (input: In) => T;
    /** `"step"` switches at the midpoint; omitted uses the kind's interpolation. */
    readonly lerp?: "step" | EffectParamLerp<T>;
    readonly equals?: (a: T, b: T) => boolean;
    /** Type carrier only; never set. */
    readonly __type?: [T, In];
}

/** An effect's parameters, by stored field name, in builder (and stored-key) order. */
export type EffectParamTable = Readonly<Record<string, EffectParamDef<any, any>>>;

/**
 * The declarative definition of a built-in effect: its parameters (types,
 * defaults, ranges, inspector hints) plus the behaviour that has to stay code.
 * Core's types, builder defaults, `lerp`/`equals` and the host-facing
 * {@link EffectDescriptor} are derived from it, and the renderers bind their
 * shader uniforms to its parameter names.
 */
export interface EffectSpec<T extends string = string, P extends EffectParamTable = EffectParamTable> {
    readonly type: T;
    readonly params: P;
    readonly group: EffectGroup;
    /** The option a bare number passed to the builder sets. */
    readonly scalar?: string;
    /** The builder's `mode` when none is given. */
    readonly defaultMode?: EffectMode;
    /** The one layer the effect does anything on. */
    readonly onlyOn?: EffectMode;
    /** Builder options at which the effect draws nothing, or `null` when it has none. */
    readonly neutral: Readonly<Record<string, unknown>> | null;
    readonly surface?: EffectData<any>["surface"];
    readonly resolve?: (effect: any) => any;
    readonly declare?: (effect: any, assets: AssetScope) => void;
    /** Wraps or replaces the derived interpolation, which it is handed as `derived`. */
    readonly lerp?: (from: any, to: any, t: number, derived: (from: any, to: any, t: number) => any) => any;
    readonly equals?: (a: any, b: any) => boolean;
}

type ParamValue<D> = D extends { readonly __type?: [infer T, unknown] } ? T : never;
type ParamInput<D> = D extends { readonly __type?: [unknown, infer I] } ? I : never;
type IsOptional<D> = D extends { readonly optional: true } ? true : false;
type IsRequired<D> = D extends { readonly required: true } ? true : false;

/** The stored fields an effect's parameters describe. */
export type EffectFields<P extends EffectParamTable> = {
    -readonly [K in keyof P as IsOptional<P[K]> extends true ? never : K]: ParamValue<P[K]>;
} & {
    -readonly [K in keyof P as IsOptional<P[K]> extends true ? K : never]?: ParamValue<P[K]>;
};

/** A builder's options for an effect: every parameter as input, plus `mode`/`clip`. */
export type EffectOptionsOf<P extends EffectParamTable> = {
    -readonly [K in keyof P as IsRequired<P[K]> extends true ? K : never]: ParamInput<P[K]>;
} & {
    -readonly [K in keyof P as IsRequired<P[K]> extends true ? never : K]?: ParamInput<P[K]>;
} & EffectOptions;

/** The effect object a spec describes. */
export type EffectOf<S extends EffectSpec> = { type: S["type"] } & ModedEffect & EffectFields<S["params"]>;

/** Declares a built-in effect; see {@link EffectSpec}. */
export function defineEffect<const T extends string, const P extends EffectParamTable>(
    spec: EffectSpec<T, P>,
): EffectSpec<T, P> {
    return spec;
}

/** The middle of the layer, every centre option's default. Shared, as it always was. */
export const CENTER: Vector2 = { x: 0.5, y: 0.5 };

type Options<T, In = T> = Omit<EffectParamDef<T, In>, "kind" | "__type" | "options" | "normalize" | "lerp" | "equals">;
// Kept out of the inferred options so a lambda here is typed by its parameter.
type Behaviour<T> = Pick<EffectParamDef<T>, "lerp" | "equals">;

/** Parameter constructors for {@link defineEffect}. */
export const param = {
    number<const O extends Options<number>>(o: O & Behaviour<number> & { normalize?: (input: number) => number }): EffectParamDef<number> & NoInfer<O> & { kind: "number" } {
        return { kind: "number", ...o };
    },
    color<const O extends Options<Color>>(o: O & Behaviour<Color>): EffectParamDef<Color> & NoInfer<O> & { kind: "color" } {
        return { kind: "color", ...o };
    },
    /** A point or per-axis pair. `fromNumber` lets the builder take a bare number for it. */
    vec2<const O extends Options<Vector2, number | Vector2> & { fromNumber?: "both" | "y" }>(
        o: O & Behaviour<Vector2>,
    ): EffectParamDef<Vector2, O extends { fromNumber: string } ? number | Vector2 : Vector2> & NoInfer<O> & { kind: "vec2" } {
        const normalize = o.fromNumber === undefined
            ? undefined
            : o.fromNumber === "both"
                ? (v: number | Vector2) => (typeof v === "number" ? { x: v, y: v } : v)
                : (v: number | Vector2) => (typeof v === "number" ? { x: 0, y: v } : v);
        return { kind: "vec2", ...(normalize ? { normalize } : {}), ...o } as never;
    },
    choice<const V extends string | number, const O extends Options<V>>(
        options: readonly V[],
        o: O & Behaviour<V>,
    ): EffectParamDef<V> & NoInfer<O> & { kind: "enum"; options: readonly V[] } {
        return { kind: "enum", options, lerp: "step", ...o };
    },
    boolean<const O extends Options<boolean>>(o: O & Behaviour<boolean>): EffectParamDef<boolean> & NoInfer<O> & { kind: "boolean" } {
        return { kind: "boolean", lerp: "step", ...o };
    },
    axis<const O extends Options<EffectAxis>>(o: O & Behaviour<EffectAxis>): EffectParamDef<EffectAxis> & NoInfer<O> & { kind: "axis" } {
        return { kind: "axis", lerp: "step", ...o };
    },
    text<V extends string = string, const O extends Options<V> = Options<V>>(o: O & Behaviour<V>): EffectParamDef<V> & NoInfer<O> & { kind: "text" } {
        return { kind: "text", lerp: "step", ...o };
    },
    /**
     * A parameter of stored type `T` that no generic kind covers, curried so
     * `T` is given and the options inferred: `param.of<Color[]>()({ kind: "colors", … })`.
     * It steps and compares by `===` unless given `lerp`/`equals`.
     */
    of<T>() {
        return <const O extends Options<T> & { kind: EffectParamKind }>(o: O & Behaviour<T>): EffectParamDef<T> & NoInfer<O> =>
            ({ lerp: "step", ...o }) as never;
    },
};

const step = <T>(a: T, b: T, t: number): T => (t < 0.5 ? a : b);
const same = (a: unknown, b: unknown) => a === b;
const sameVector = (a: Vector2, b: Vector2) => a.x === b.x && a.y === b.y;

const KIND_LERP: Partial<Record<EffectParamKind, EffectParamLerp<any>>> = {
    number: lerpNumber,
    color: (a: Color, b: Color, t) => lerpColor(resolveEffectColor(a), resolveEffectColor(b), t),
    vec2: lerpVector2,
};

const KIND_EQUALS: Partial<Record<EffectParamKind, (a: any, b: any) => boolean>> = {
    color: sameEffectColor,
    vec2: sameVector,
    axis: sameEffectAxis,
};

function paramLerp(def: EffectParamDef<any, any>): EffectParamLerp<unknown> {
    if (typeof def.lerp === "function") return def.lerp;
    const kind = def.lerp === "step" ? undefined : KIND_LERP[def.kind];
    if (!kind) return step;
    // An absent optional field tweens from what it means when absent.
    if (def.optional && def.default !== undefined) {
        const fallback = def.default;
        return (a, b, t, from, to) => kind(a ?? fallback, b ?? fallback, t, from, to);
    }
    return kind;
}

/** The derived `EffectData` of a spec: generic per-kind `lerp`/`equals` unless the spec gives its own. */
export function effectDataOf<S extends EffectSpec>(spec: S): EffectData<EffectOf<S>> {
    const entries = Object.entries(spec.params);
    const lerps = entries.map(([name, def]) => [name, paramLerp(def)] as const);
    const equals = entries.map(([name, def]) => [name, def.equals ?? KIND_EQUALS[def.kind] ?? same] as const);
    const derived = (from: EffectOf<S>, to: EffectOf<S>, t: number): EffectOf<S> => {
        const out: Record<string, unknown> = { type: spec.type };
        const f = from as unknown as Record<string, unknown>;
        const g = to as unknown as Record<string, unknown>;
        for (const [name, lerp] of lerps) out[name] = lerp(f[name], g[name], t, f, g);
        return out as EffectOf<S>;
    };
    const custom = spec.lerp;
    const data: EffectData<EffectOf<S>> = {
        lerp: custom ? (from, to, t) => custom(from, to, t, derived) : derived,
        equals: spec.equals ?? ((a, b) => {
            const x = a as unknown as Record<string, unknown>;
            const y = b as unknown as Record<string, unknown>;
            return equals.every(([name, eq]) => eq(x[name], y[name]));
        }),
    };
    if (spec.surface !== undefined) data.surface = spec.surface;
    if (spec.resolve) data.resolve = spec.resolve;
    if (spec.declare) data.declare = spec.declare;
    return data;
}

// Arrays are copied so editing one effect's list never reaches another's;
// objects (a centre point) are shared, as they always were.
const copyDefault = (value: unknown) => (Array.isArray(value) ? [...value] : value);

/**
 * Builds an effect from builder input: the scalar shorthand, then each
 * parameter's option or default (normalised), then `mode`/`clip`.
 */
export function buildEffect<S extends EffectSpec>(
    spec: S,
    arg: number | EffectOptionsOf<S["params"]> | undefined,
): EffectOf<S> {
    const o = (spec.scalar
        ? scalarOptions(arg as number | Record<string, unknown> | undefined, spec.scalar as never)
        : (arg ?? {})) as Record<string, unknown> & EffectOptions;
    const out: Record<string, unknown> = { type: spec.type };
    for (const [name, def] of Object.entries(spec.params)) {
        const value = o[name] ?? copyDefault(def.default);
        if (value === undefined) continue;
        out[name] = def.normalize ? def.normalize(value) : value;
    }
    const options = spec.defaultMode && o.mode === undefined ? { ...o, mode: spec.defaultMode } : o;
    return withEffectOptions(out, options) as unknown as EffectOf<S>;
}

/** A JSON value — what every field of an {@link EffectDescriptor} is made of. */
export type EffectJson = string | number | boolean | null | EffectJson[] | { [key: string]: EffectJson };

/** One parameter of an {@link EffectDescriptor}. */
export interface EffectParamDescriptor {
    /** The stored field it writes. */
    name: string;
    kind: EffectParamKind;
    /** What the builder writes when it is omitted, as stored (colours as authored). */
    default?: EffectJson;
    /** The builder's options require it. */
    required?: boolean;
    /** The stored field may be absent. */
    optional?: boolean;
    min?: number;
    max?: number;
    step?: number;
    unit?: EffectParamUnit;
    options?: (string | number)[];
    /** Tweens continuously (false: switches at the midpoint). */
    animatable: boolean;
    /** i18n leaf for the label; the name unless the spec says otherwise. */
    label: string;
    control?: EffectParamControl;
    inline?: boolean;
    /** Inspector position. */
    order: number;
    zero?: "right" | "top";
    optionsLabel?: string;
    hidden?: boolean;
    initial?: EffectJson;
}

/**
 * A built-in effect, described for a host: what its fields are, their kinds,
 * defaults and ranges, and how an inspector should lay them out. Plain JSON, so
 * it can be shipped to a UI as is.
 */
export interface EffectDescriptor {
    type: string;
    group: EffectGroup;
    /** `"dynamic"`: depends on the effect's `mode` (the user shader). */
    surface: EffectSurface | "dynamic";
    scalar?: string;
    defaultMode?: EffectMode;
    onlyOn?: EffectMode;
    /** Stored fields at which it draws nothing (the rest at their defaults); `null` when it has none. */
    neutral: { [key: string]: EffectJson } | null;
    /** In stored-key order; sort by `order` for the inspector's. */
    params: EffectParamDescriptor[];
}

const json = (value: unknown): EffectJson | undefined =>
    value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as EffectJson);

/** The serialisable {@link EffectDescriptor} of a spec. */
export function describeSpec(spec: EffectSpec): EffectDescriptor {
    const params = Object.entries(spec.params).map(([name, def], index): EffectParamDescriptor => {
        const stored = def.default !== undefined && def.normalize ? def.normalize(def.default) : def.default;
        const out: EffectParamDescriptor = {
            name,
            kind: def.kind,
            animatable: def.lerp !== "step",
            label: def.label ?? name,
            order: def.order ?? index,
        };
        const optional = {
            default: json(stored),
            required: def.required,
            optional: def.optional,
            min: def.min,
            max: def.max,
            step: def.step,
            unit: def.unit,
            options: def.options ? [...def.options] : undefined,
            control: def.control,
            inline: def.inline,
            zero: def.zero,
            optionsLabel: def.optionsLabel,
            hidden: def.hidden,
            initial: json(def.initial),
        };
        for (const [key, value] of Object.entries(optional)) {
            if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
        }
        return out;
    });
    const out: EffectDescriptor = {
        type: spec.type,
        group: spec.group,
        surface: typeof spec.surface === "function" ? "dynamic" : (spec.surface ?? "filter"),
        neutral: spec.neutral === null ? null : (json(Object.fromEntries(Object.entries(spec.neutral).map(([name, value]) => {
            const normalize = spec.params[name]?.normalize;
            return [name, normalize ? normalize(value) : value];
        }))) as { [key: string]: EffectJson }),
        params,
    };
    if (spec.scalar) out.scalar = spec.scalar;
    if (spec.defaultMode) out.defaultMode = spec.defaultMode;
    if (spec.onlyOn) out.onlyOn = spec.onlyOn;
    return out;
}
