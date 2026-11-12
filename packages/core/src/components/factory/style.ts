import type { PropertyEditor } from "@/attributes/properties/decorator";
import type { Fill } from "@/attributes/shape/fill/chain";
import { fillOps } from "@/attributes/shape/fill/registry";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { InOf, OutOf, StateSpec } from "@/components/factory/api";
import { defOf, type TypeDef } from "@/components/factory/type-def";

/**
 * A style's fields, written in groups: `{ colors: { palette, foreground }, text: { fontSize } }`.
 * The group says what part of the component a field paints; the value is flat
 * (`style.palette`, `style.fontSize`), so field keys are unique across groups.
 */
export type StyleGroups = { readonly [group: string]: StateSpec };

type Flatten<G> = { [K in keyof G]: (x: G[K]) => void }[keyof G] extends (x: infer I) => void ? I : never;
/** Every group's fields in one spec. */
export type StyleShape<G extends StyleGroups> = Flatten<G> extends StateSpec ? Flatten<G> : StateSpec;

/** What a document, call or preset sets: any subset of the fields, each in its loose form. */
export type StyleInput<S> = { [K in keyof S]?: InOf<S[K]> };
/** Every field resolved. */
export type StyleValues<S> = { readonly [K in keyof S]: OutOf<S[K]> };

export interface StyleOptions<S> {
    /** Ready-made looks by name, each a partial style laid over the defaults when applied. */
    readonly presets?: Readonly<Record<string, StyleInput<S>>>;
}

interface Field {
    readonly key: string;
    readonly group: string;
    readonly def: TypeDef;
}

function fieldsOf(groups: StyleGroups): Field[] {
    const fields: Field[] = [];
    const seen = new Set<string>();
    for (const group in groups) {
        for (const key in groups[group]) {
            if (seen.has(key)) throw new Error(`Style field "${key}" is declared in two groups; a style's field keys are flat.`);
            seen.add(key);
            fields.push({ key, group, def: defOf(groups[group][key]) });
        }
    }
    return fields;
}

/** A field default as an author would write it: a factory is called, so every node gets its own array. */
function inputDefault(def: TypeDef): unknown {
    return typeof def.default === "function" ? (def.default as () => unknown)() : def.default;
}

function resolveField(def: TypeDef, value: unknown, previous?: unknown): unknown {
    return def.mapper ? def.mapper(value, previous) : value;
}

/**
 * Lays `input` over `previous` (else the defaults), resolving each field it
 * names. A key no field declares is dropped, so a preset written for a richer
 * member of the family (a pie's `innerRadius` on a line chart) is harmless.
 */
function resolveStyle(fields: readonly Field[], input: Record<string, unknown> | null | undefined, previous?: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { key, def } of fields) {
        const given = input?.[key];
        if (given !== undefined && given !== null) out[key] = resolveField(def, given, previous?.[key]);
        else if (previous && key in previous) out[key] = previous[key];
        else out[key] = resolveField(def, inputDefault(def));
    }
    return out;
}

/** Field by field: a field's own tween, else numbers lerp, else it steps at the midpoint (a font, a curve, a toggle). */
function lerpStyle(fields: readonly Field[], from: Record<string, unknown>, to: Record<string, unknown>, t: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { key, def } of fields) {
        const a = from[key];
        const b = to[key];
        if (a === b) out[key] = b;
        else if (def.editor.animatable === false || a === undefined || b === undefined) out[key] = t < 0.5 ? a : b;
        else if (def.tween) out[key] = def.tween(a, b, t);
        else if (typeof a === "number" && typeof b === "number") out[key] = a + (b - a) * t;
        else out[key] = t < 0.5 ? a : b;
    }
    return out;
}

/**
 * The definition behind `Types.style`: an object entry whose fields a host can
 * edit one by one, group by group, and whose whole value can be saved and laid
 * onto any component of the same `family`.
 */
export function styleDef(family: string, groups: StyleGroups, options?: StyleOptions<unknown>): TypeDef {
    const fields = fieldsOf(groups);
    const defaults: Record<string, unknown> = {};
    const properties: Record<string, PropertyEditor> = {};
    for (const { key, group, def } of fields) {
        const initial = inputDefault(def);
        defaults[key] = initial;
        properties[key] = { ...def.editor, group, ...(initial !== undefined ? { default: initial } : {}) };
    }
    return {
        // Called once per node, so no two nodes share a palette array.
        default: () => structuredClone(defaults),
        mapper: (input: Record<string, unknown> | null | undefined, previous?: Record<string, unknown>) => resolveStyle(fields, input, previous),
        tween: (from: Record<string, unknown>, to: Record<string, unknown>, t: number) => lerpStyle(fields, from, to, t),
        editor: {
            kind: "style",
            family,
            properties,
            ...(options?.presets ? { presets: options.presets } : {}),
        },
        private: false,
    };
}


/** A colour for each series or item, cycled by index; tweened pairwise, the longer side's tail held. */
export function paletteDef(initial: readonly Fill[]): TypeDef {
    return {
        default: () => [...initial],
        mapper: (value: readonly Fill[] | null | undefined) => (value ?? []).map((fill) => fillOps.resolve(fill)),
        tween: (from: FillResolved[][], to: FillResolved[][], t: number) => {
            const n = Math.max(from.length, to.length);
            const out: FillResolved[][] = [];
            for (let i = 0; i < n; i++) out.push(fillOps.lerp(from[i] ?? to[i], to[i] ?? from[i], t));
            return out;
        },
        editor: { kind: "palette" },
        private: false,
    };
}
