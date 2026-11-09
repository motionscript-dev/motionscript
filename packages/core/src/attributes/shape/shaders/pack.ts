import type { ShaderUniformRecord } from "./uniforms";
import type { ShaderLanguage } from "./language";

/**
 * A **shader pack**: a program, plus what a host may edit about it.
 *
 * The interchange format for a shader — authored as JSON, imported as a value,
 * handed to `Fills.shader` or `Effects.shader`. It exists because a bare source
 * string says nothing about which of its uniforms are meant to be touched, what
 * they are called in a panel, or what range they take, so every host that wanted
 * to offer a slider had to keep that table itself, beside a program it did not
 * own.
 *
 * **Two scopes, one shape.** A fill paints inside a shape's path and may sample
 * textures; an effect paints over a layer and may sample what is beneath it.
 * Those are the only two differences, and making them arms of a union rather
 * than optional fields on one type is what makes `Fills.shader(anEffectShader)`
 * a compile error instead of a program that fails at the first frame.
 */
export type Shader = FillShader | EffectShader;

/** What both scopes carry. */
export interface ShaderBase {
    /**
     * Format tag, so a file that is not one of these can be told apart from one
     * that is merely from a newer version.
     */
    $kind?: string;
    /**
     * Provenance, when the pack came from a library row. **Not** how it is
     * registered — `Registry.addShader` takes the key separately, exactly as
     * `Registry.addNode` does, so the same file can be registered under whatever
     * name a project wants and the file itself stays portable.
     */
    id?: string;
    name: string;
    description?: string;
    /** The language `source` is written in; normalising a pack stamps WGSL when absent. */
    language?: ShaderLanguage;
    /**
     * The program. In WGSL, a fill defines `fn fill(in: FillIn) -> vec4f` and an
     * effect `fn effect(in: EffectIn) -> vec4f`, and the uniforms are the
     * members of `struct Params` (types, layout and all); `properties` name
     * those members in their `inputs`.
     */
    source: string;
    /** Uniform values the properties do not cover, by name. */
    uniforms?: ShaderUniformRecord;
    /** The editable values, by property id. */
    properties: Record<string, ShaderProperty>;
}

/** A shader that paints inside a shape's path. */
export interface FillShader extends ShaderBase {
    scope: "fill";
    /**
     * The images the program samples, by name. In WGSL, `sample_texture(uv)`
     * samples the first; the fill that applies the pack supplies each `src`.
     */
    textures?: readonly { name: string; description?: string }[];
}

/** A shader that paints over a layer. */
export interface EffectShader extends ShaderBase {
    scope: "effect";
    /**
     * Whether the program is meant to run on the backdrop path, where
     * `sample_src` reads what is beneath the node rather than its own layer.
     *
     * A fact about the **program**, which is why it lives here rather than on
     * the effect instance: the instance keeps `mode`, the cross-cutting field
     * five generic consumers read without knowing what type they hold. The
     * builder maps this to `mode: "backdrop"` as the default and a caller may
     * still override it.
     */
    backdrop?: boolean;
}

/** One editable value. */
export type ShaderProperty = KnownShaderProperty | UnknownShaderProperty;

export type KnownShaderProperty =
    | NumberProperty
    | SliderProperty
    | AngleProperty
    | HueProperty
    | BooleanProperty
    | ColorProperty
    | VectorProperty
    | PointProperty;

interface ShaderPropertyBase {
    /** What a panel calls it. Falls back to the property id. */
    name?: string;
    /**
     * The uniform each of this property's components writes.
     *
     * The composite mechanism, and the reason a property is not just a uniform
     * under another name: one editable value may span several uniforms. A
     * scalar names one component, `value`; a point may name `value` for a
     * `float2`, or `x` and `y` for two separate floats.
     */
    inputs: Record<string, string>;
}

/** A scalar, drawn as a number input. */
export interface NumberProperty extends ShaderPropertyBase {
    kind: "number";
    default: number;
    min?: number;
    max?: number;
    step?: number;
}

/** A scalar with a bounded range, drawn as a slider. */
export interface SliderProperty extends ShaderPropertyBase {
    kind: "slider";
    default: number;
    min: number;
    max: number;
    step?: number;
}

/** Degrees, matching every other angle in the library. */
export interface AngleProperty extends ShaderPropertyBase {
    kind: "angle";
    default: number;
}

/** Degrees around the colour wheel. */
export interface HueProperty extends ShaderPropertyBase {
    kind: "hue";
    default: number;
}

/** Written to its uniform as 1 or 0, since a `bool` cannot be a uniform member in WGSL. */
export interface BooleanProperty extends ShaderPropertyBase {
    kind: "boolean";
    default: boolean;
}

/** RGBA in 0–1. A CSS string is accepted and parsed, so theme tokens work. */
export interface ColorProperty extends ShaderPropertyBase {
    kind: "color";
    default: string | readonly number[];
}

/** A fixed-width run of floats. */
export interface VectorProperty extends ShaderPropertyBase {
    kind: "vector";
    default: readonly number[];
}

/** Two floats, as one `float2` or as separate `x`/`y` uniforms. */
export interface PointProperty extends ShaderPropertyBase {
    kind: "point";
    default: readonly number[] | { x: number; y: number };
}

/**
 * A property whose kind this version of the vocabulary does not name.
 *
 * Open at the edges on purpose: a pack written against a newer version should
 * draw the controls a host knows and say so about the rest, instead of
 * failing to load at all.
 *
 * An unknown property is still *resolved* — its `default` is written to its
 * `inputs` unchanged — so a shader whose panel a host cannot fully draw still
 * renders correctly.
 */
export interface UnknownShaderProperty extends ShaderPropertyBase {
    kind: string;
    default?: unknown;
    [option: string]: unknown;
}

const KNOWN_KINDS = new Set([
    "number", "slider", "angle", "hue", "boolean", "color", "vector", "point",
]);

/** Whether `property` is one this version knows how to draw. */
export function isKnownShaderProperty(property: ShaderProperty): property is KnownShaderProperty {
    return KNOWN_KINDS.has(property.kind);
}

/** Ceiling on properties in one pack, so a malformed import cannot exhaust a host. */
export const MAX_SHADER_PROPERTIES = 64;

/** Ceiling on source length, matching what a compile cache can reasonably hold. */
export const MAX_SHADER_SOURCE = 64_000;

/**
 * Validate and normalise an authored pack.
 *
 * **Throws** when the pack is structurally not one — no source, no usable
 * scope — because there is nothing to render and a silent empty shader is a
 * blank frame with no explanation. **Warns and drops** an individual malformed
 * property, because the rest of the shader still works and a panel missing one
 * control is a better answer than a scene that will not build. That split is the
 * same one `normalizeUniforms` makes.
 */
export function normalizeShaderPack(input: unknown): Shader {
    if (typeof input !== "object" || input === null) {
        throw new Error("A shader pack must be an object.");
    }
    const raw = input as Record<string, unknown>;

    const scope = raw.scope;
    if (scope !== "fill" && scope !== "effect") {
        throw new Error(
            `A shader pack needs scope "fill" or "effect", got ${JSON.stringify(scope)}. ` +
            `The two are written against different contracts — a fill has no backdrop to ` +
            `sample and an effect has no shape box to map coordinates onto.`,
        );
    }

    const source = typeof raw.source === "string" ? raw.source.trim() : "";
    if (source === "") throw new Error(`Shader pack "${String(raw.name ?? "?")}" has no source.`);
    if (source.length > MAX_SHADER_SOURCE) {
        throw new Error(
            `Shader pack "${String(raw.name ?? "?")}" source is ${source.length} characters, ` +
            `over the ${MAX_SHADER_SOURCE} ceiling.`,
        );
    }

    if (raw.language !== undefined && raw.language !== "wgsl") {
        throw new Error(
            `Shader pack "${String(raw.name ?? "?")}" is written in ${JSON.stringify(raw.language)}; ` +
            `only WGSL is supported. Port it to WGSL.`,
        );
    }

    const base: ShaderBase = {
        ...(typeof raw.$kind === "string" ? { $kind: raw.$kind } : {}),
        ...(typeof raw.id === "string" ? { id: raw.id } : {}),
        name: typeof raw.name === "string" && raw.name !== "" ? raw.name : "Shader",
        ...(typeof raw.description === "string" ? { description: raw.description } : {}),
        language: "wgsl",
        source,
        ...(isRecord(raw.uniforms) ? { uniforms: raw.uniforms as ShaderUniformRecord } : {}),
        properties: normalizeProperties(raw.properties, String(raw.name ?? "?")),
    };

    if (scope === "fill") {
        const textures = Array.isArray(raw.textures)
            ? (raw.textures as unknown[]).filter((t): t is { name: string; description?: string } =>
                isRecord(t) && typeof t.name === "string").map((t) => ({ name: t.name, ...(typeof t.description === "string" ? { description: t.description } : {}) }))
            : [];
        return {
            ...base,
            scope: "fill",
            ...(textures.length ? { textures } : {}),
        };
    }
    return { ...base, scope: "effect", ...(raw.backdrop === true ? { backdrop: true } : {}) };
}

function normalizeProperties(input: unknown, where: string): Record<string, ShaderProperty> {
    if (!isRecord(input)) return {};
    const out: Record<string, ShaderProperty> = {};
    const claimed = new Map<string, string>();

    for (const [id, value] of Object.entries(input)) {
        if (Object.keys(out).length >= MAX_SHADER_PROPERTIES) {
            warn(`shader "${where}" declares more than ${MAX_SHADER_PROPERTIES} properties; the rest are ignored.`);
            break;
        }
        if (!isRecord(value) || typeof value.kind !== "string") {
            warn(`shader "${where}" property "${id}" has no kind; ignored.`);
            continue;
        }
        const inputs = value.inputs;
        if (!isRecord(inputs) || Object.keys(inputs).length === 0) {
            warn(`shader "${where}" property "${id}" names no uniform in "inputs"; ignored.`);
            continue;
        }
        let conflict = false;
        for (const uniform of Object.values(inputs)) {
            if (typeof uniform !== "string") {
                warn(`shader "${where}" property "${id}" has a non-string uniform name; ignored.`);
                conflict = true;
                break;
            }
            const prior = claimed.get(uniform);
            if (prior !== undefined) {
                // Two properties writing one uniform means the panel has two
                // controls for one value and whichever resolves last silently wins.
                warn(`shader "${where}" properties "${prior}" and "${id}" both write uniform "${uniform}"; "${id}" ignored.`);
                conflict = true;
                break;
            }
            claimed.set(uniform, id);
        }
        if (conflict) continue;

        out[id] = value as unknown as ShaderProperty;
    }
    return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const warned = new Set<string>();

/** Warn once per message — a pack may be normalised on every scene build. */
function warn(message: string): void {
    if (warned.has(message)) return;
    if (warned.size > 256) warned.clear();
    warned.add(message);
    console.warn(`[shader] ${message}`);
}
