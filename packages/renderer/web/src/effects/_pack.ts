// The generic packer: a port names its pass's parameters, and this lays them
// out, encodes them and writes them, by name. scripts/gen-effect-params.mjs
// generates the matching WGSL accessors (`param_<name>()`) from the same
// layout, so the TS and WGSL sides never agree by position.
import { describeEffect, resolveEffectAxis, resolveEffectColor, type EffectParamDescriptor } from "@motionscript/core";
import type { EffectPort, Packed } from "./_port";

/** Floats a pass can take (`EffectU.p` in _header.wgsl). */
export const MAX_PARAMS = 64;

export type ScalarType = "f32" | "vec2f" | "vec3f" | "vec4f";
/** A WGSL-side type: a scalar/vector, or a fixed-length array of them. */
export type FieldType = ScalarType | { array: number; of: ScalarType };

/**
 * One parameter of a pass.
 *
 * `"param"` is the core spec's parameter of the same name, encoded by its kind
 * (a number as is, a colour as straight RGBA, a point or axis as a vec2, a
 * boolean as 0/1, an enum as its index in the spec's options). A derived field
 * computes its value and names the spec parameters it reads in `uses`.
 */
export type Field<E, C> =
    | "param"
    | { type: FieldType; uses?: readonly string[]; value(effect: E, ctx: C): number | readonly number[] };

export interface PortSpec<E, C> {
    /** core's effect `type`; also the WGSL file name. */
    type: string;
    surface: "shader" | "filter";
    backdropOnly?: boolean;
    /** The pass's parameters, in layout order. */
    params: Record<string, Field<E, C>>;
    /** Spec parameters read on the host side only (a no-op check, `reach`, `blur`, an atlas). */
    uses?: readonly string[];
    /** Per-effect work shared by the fields and `extras`, or null for a no-op. Defaults to `{}`. */
    prepare?(effect: E): C | null;
    /** Everything a pass takes besides its parameters. */
    extras?(effect: E, ctx: C): Omit<Packed, "params">;
    cases(): object[];
}

export interface LaidOutField {
    name: string;
    type: FieldType;
    /** Offset into the pass's floats. */
    offset: number;
    floats: number;
}

const WIDTH: Record<ScalarType, number> = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 };

export const fieldFloats = (type: FieldType) => (typeof type === "string" ? WIDTH[type] : type.array * WIDTH[type.of]);

const KIND_TYPE: Partial<Record<EffectParamDescriptor["kind"], ScalarType>> = {
    number: "f32",
    boolean: "f32",
    enum: "f32",
    color: "vec4f",
    vec2: "vec2f",
    axis: "vec2f",
};

function encode(p: EffectParamDescriptor, value: unknown): number | readonly number[] {
    switch (p.kind) {
        case "number": return value as number;
        case "boolean": return value ? 1 : 0;
        case "enum": return Math.max(0, p.options!.indexOf(value as string | number));
        case "color": return resolveEffectColor(value as Parameters<typeof resolveEffectColor>[0]);
        case "vec2": { const v = value as { x: number; y: number }; return [v.x, v.y]; }
        case "axis": { const v = resolveEffectAxis(value as Parameters<typeof resolveEffectAxis>[0]); return [v.x, v.y]; }
        default: throw new Error(`effect param "${p.name}" (${p.kind}) has no default encoding; give it a value()`);
    }
}

/** The spec parameter a `"param"` field names, or a thrown error naming what is wrong. */
function specParam(type: string, name: string): EffectParamDescriptor {
    const p = describeEffect(type)?.params.find((q) => q.name === name);
    if (!p) throw new Error(`effect "${type}": "${name}" is not a parameter of its core spec`);
    if (!KIND_TYPE[p.kind]) throw new Error(`effect "${type}": "${name}" (${p.kind}) has no default encoding`);
    return p;
}

/** The pass's parameters with their WGSL types and offsets. Throws past {@link MAX_PARAMS}. */
export function layout(spec: Pick<PortSpec<any, any>, "type" | "params">): LaidOutField[] {
    let offset = 0;
    const out = Object.entries(spec.params).map(([name, field]) => {
        const type = field === "param" ? KIND_TYPE[specParam(spec.type, name).kind]! : field.type;
        const floats = fieldFloats(type);
        const f = { name, type, offset, floats };
        offset += floats;
        return f;
    });
    if (offset > MAX_PARAMS) throw new Error(`effect "${spec.type}" lays out ${offset} params; a pass takes ${MAX_PARAMS}`);
    return out;
}

/** An {@link EffectPort} whose `pack` writes `spec.params` by name. */
export function definePort<E, C = Record<string, never>>(spec: PortSpec<E, C>): EffectPort<E> & { spec: PortSpec<E, C> } {
    const fields = layout(spec);
    const total = fields.reduce((n, f) => n + f.floats, 0);
    const encoders = fields.map((f) => {
        const field = spec.params[f.name];
        if (field !== "param") return field.value;
        const p = specParam(spec.type, f.name);
        return (e: E) => encode(p, (e as Record<string, unknown>)[f.name]);
    });
    return {
        type: spec.type,
        surface: spec.surface,
        backdropOnly: spec.backdropOnly,
        spec,
        cases: spec.cases,
        pack(effect) {
            const ctx = spec.prepare ? spec.prepare(effect) : ({} as C);
            if (ctx === null) return null;
            const params = new Array<number>(total).fill(0);
            fields.forEach((f, i) => {
                const v = encoders[i](effect, ctx);
                const n = typeof v === "number" ? 1 : v.length;
                if (n > f.floats) throw new Error(`effect "${spec.type}": "${f.name}" is ${n} floats, laid out as ${f.floats}`);
                if (typeof v === "number") params[f.offset] = v;
                else for (let k = 0; k < n; k++) params[f.offset + k] = v[k];
            });
            return { params, ...(spec.extras ? spec.extras(effect, ctx) : {}) };
        },
    };
}
