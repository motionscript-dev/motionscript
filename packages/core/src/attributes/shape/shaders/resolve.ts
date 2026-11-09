import { parseColor } from "../fill/color/parser";
import type { ShaderUniformRecord, ShaderUniformValue } from "./uniforms";
import type { Shader, ShaderProperty } from "./pack";

/** Overrides for a pack's properties, by property id. */
export type ShaderPropertyValues = Record<string, unknown>;

/** Component names a multi-part property may map, in the order they index. */
const COMPONENTS = ["x", "y", "z", "w"] as const;
const COLOR_COMPONENTS = ["r", "g", "b", "a"] as const;

/**
 * Turn a pack's properties, plus any overrides, into the uniform record the
 * renderer writes.
 *
 * This is the whole job of a property: it is an *editable* value, and a uniform
 * is where that value has to end up. One property may feed several uniforms —
 * see `ShaderPropertyBase.inputs` — which is why this cannot be a rename.
 *
 * The pack's own `uniforms` are merged in first and the properties win: the
 * more specific statement of the same value takes it.
 */
export function resolveShaderProperties(
    pack: Shader,
    overrides?: ShaderPropertyValues,
): ShaderUniformRecord {
    const out: ShaderUniformRecord = { ...(pack.uniforms ?? {}) };

    for (const [id, property] of Object.entries(pack.properties)) {
        const supplied = overrides && id in overrides ? overrides[id] : property.default;
        const parts = componentsOf(property, supplied, id, pack.name);
        if (!parts) continue;
        for (const [component, uniform] of Object.entries(property.inputs)) {
            const value = parts[component];
            if (value === undefined) {
                warn(`shader "${pack.name}" property "${id}" has no "${component}" to write to "${uniform}".`);
                continue;
            }
            out[uniform] = value;
        }
    }

    if (overrides) {
        for (const id of Object.keys(overrides)) {
            if (id in pack.properties) continue;
            warn(`shader "${pack.name}" has no property "${id}"; the override is ignored.`);
        }
    }

    return out;
}

/**
 * Split one property's value across the components its `inputs` name.
 *
 * A property naming only `value` passes its whole value through, which is the
 * common case and the reason a scalar needs no ceremony. One naming `x`/`y` (or
 * `r`/`g`/`b`/`a`) indexes into the value, which is what lets a `point` drive two
 * separate `float` uniforms in a source that never declared a `float2`.
 */
function componentsOf(
    property: ShaderProperty,
    value: unknown,
    id: string,
    where: string,
): Record<string, ShaderUniformValue> | undefined {
    const flat = toUniformValue(property, value, id, where);
    if (flat === undefined) return undefined;

    const names = Object.keys(property.inputs);
    if (names.length === 1 && names[0] === "value") return { value: flat };

    const parts = typeof flat === "number" ? [flat] : flat;
    const out: Record<string, ShaderUniformValue> = { value: flat };
    for (const [index, name] of COMPONENTS.entries()) {
        if (parts[index] !== undefined) out[name] = parts[index];
    }
    for (const [index, name] of COLOR_COMPONENTS.entries()) {
        if (parts[index] !== undefined) out[name] = parts[index];
    }
    return out;
}

/** One property's value as floats, by its kind. */
function toUniformValue(
    property: ShaderProperty,
    value: unknown,
    id: string,
    where: string,
): ShaderUniformValue | undefined {
    switch (property.kind) {
        case "number":
        case "slider":
        case "angle":
        case "hue":
            return asFinite(value, id, where);

        // A `bool` cannot be a uniform member in WGSL; a float of 1 or 0 is what a shader can branch on.
        case "boolean":
            return value ? 1 : 0;

        case "color":
            return asColor(value, id, where);

        case "vector":
        case "point":
            return asFloats(value, id, where);

        // An unknown kind still resolves: its value reaches its uniforms
        // untouched, so a shader a host cannot fully draw still renders.
        default:
            return typeof value === "number" || Array.isArray(value)
                ? (value as ShaderUniformValue)
                : undefined;
    }
}

function asFinite(value: unknown, id: string, where: string): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    warn(`shader "${where}" property "${id}" expects a number, got ${JSON.stringify(value)}.`);
    return undefined;
}

/**
 * A colour as four floats in 0–1.
 *
 * A CSS string is parsed rather than refused, so a theme token, an `oklch()` and
 * the `"white/10"` opacity suffix all reach a shader — `parseColor` is the one
 * place any of those are understood, and a shader pack has no reason to be the
 * exception.
 */
function asColor(value: unknown, id: string, where: string): number[] | undefined {
    if (typeof value === "string") {
        const [r, g, b, a] = parseColor(value);
        return [r, g, b, a];
    }
    return asFloats(value, id, where);
}

function asFloats(value: unknown, id: string, where: string): number[] | undefined {
    if (Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v))) {
        return value as number[];
    }
    if (typeof value === "object" && value !== null) {
        const point = value as { x?: unknown; y?: unknown };
        if (typeof point.x === "number" && typeof point.y === "number") return [point.x, point.y];
    }
    warn(`shader "${where}" property "${id}" expects numbers, got ${JSON.stringify(value)}.`);
    return undefined;
}

const warned = new Set<string>();

function warn(message: string): void {
    if (warned.has(message)) return;
    if (warned.size > 256) warned.clear();
    warned.add(message);
    console.warn(`[shader] ${message}`);
}
