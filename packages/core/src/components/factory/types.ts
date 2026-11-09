import { alignmentOps, type Alignment } from "@/attributes/layout/alignment";
import { insetsOps, type InsetsProps, type InsetsResolved } from "@/attributes/layout/insets";
import { sizeInputOps, type SizeInput } from "@/attributes/layout/size";
import { vector2Ops, type Vector2 } from "@/attributes/layout/vector2";
import type { PropertyEditor } from "@/attributes/properties/decorator";
import { cornerRadiusOps, type CornerRadiusResolved, type RectCornerRadius } from "@/attributes/shape/corners/corner-radius";
import { cornerStyleOps, type CornerStyleResolved, type RectCornerStyle } from "@/attributes/shape/corners/corner-style";
import { effectsOps, type Effect } from "@/attributes/shape/effects/chain";
import type { NodeEffect } from "@/attributes/shape/effects/union";
import type { Fill } from "@/attributes/shape/fill/chain";
import type { Color, NormalizedColor } from "@/attributes/shape/fill/color/parser";
import { colorOps } from "@/attributes/shape/fill/lerp";
import { fillOps } from "@/attributes/shape/fill/registry";
import type { FillResolved } from "@/attributes/shape/fill/union";
import { pathOps } from "@/attributes/shape/path/ops";
import { shadowOps, type Shadow, type ShadowResolved } from "@/attributes/shape/shadow/shadow";
import { strokeOps, type Stroke, type StrokeResolved } from "@/attributes/shape/stroke/stroke";
import { textOps } from "@/attributes/text/ops";
import type { TweenFn } from "@/props/host";
import type { PathData } from "@/render/descriptors/path";
import type { AnyType, InOf, Inputs, NodeView, OutOf, StateSpec, Type, Values } from "@/components/factory/api";
import { defOf, type Inherit, type TypeDef } from "@/components/factory/type-def";

export interface EntryOptions {
    /** Not in documents or calls; only commands write it. A seek restores it like any entry. */
    readonly private?: boolean;
    /** `false`: `to` switches it rather than moving it. */
    readonly animatable?: boolean;
    /** Where it comes from when the author leaves it unset: what an ancestor provides. */
    readonly inherit?: Inherit;
}

export interface NumberOptions extends EntryOptions {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly unit?: string;
    /** Shown multiplied by this: `100` with `unit: "%"` for a 0–1 fraction. */
    readonly scale?: number;
}

export interface TextOptions extends EntryOptions {
    /** `to` types the text out instead of switching at the end. */
    readonly typing?: boolean;
    /** It holds lines, not a label. */
    readonly multiline?: boolean;
}

type PrivateOf<O> = O extends { readonly private: true } ? true : false;

/** An attribute type: usable bare (`Types.fill`) or called with a default (`Types.fill('red')`). */
export interface Attribute<In, Out> extends Type<In, Out, false> {
    <const O extends EntryOptions = {}>(initial?: In, options?: EntryOptions & O): Type<In, Out, PrivateOf<O>>;
}

function make<In, Out, P extends boolean>(def: TypeDef): Type<In, Out, P> {
    return { _def: def } as Type<In, Out, P>;
}

/** The editor half of an options object: what the value means, never how an app shows it. */
function meaning(kind: string, options: object | undefined, extra?: PropertyEditor): PropertyEditor {
    const { private: _private, typing: _typing, inherit: _inherit, ...rest } = (options ?? {}) as Record<string, unknown>;
    return { kind, ...extra, ...rest };
}

function attribute<In, Out>(
    kind: string, fallback: In, mapper?: (ext: any, prev?: any) => Out, tween?: TweenFn<Out>,
): Attribute<In, Out> {
    const base: TypeDef = { default: fallback, mapper, tween, editor: { kind }, private: false };
    const call = <const O extends EntryOptions = {}>(initial?: In, options?: EntryOptions & O): Type<In, Out, PrivateOf<O>> =>
        make({ ...base, default: initial === undefined ? base.default : initial, editor: meaning(kind, options), private: options?.private === true, inherit: options?.inherit });
    return Object.assign(call, { _def: base }) as unknown as Attribute<In, Out>;
}

function defaultsOf(shape: StateSpec): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key in shape) out[key] = defOf(shape[key]).default;
    return out;
}

/**
 * What a state entry can be. Each lowers onto the `property` options of the
 * attribute it names, so a Type and a typed property are the same pair.
 */
export const Types = {
    number<const O extends NumberOptions = {}>(initial = 0, options?: NumberOptions & O): Type<number, number, PrivateOf<O>> {
        return make({ default: initial, editor: meaning("number", options), private: options?.private === true, inherit: options?.inherit });
    },
    text<const O extends TextOptions = {}>(initial = "", options?: TextOptions & O): Type<string, string, PrivateOf<O>> {
        return make({ default: initial, tween: options?.typing ? textOps.lerp : undefined, editor: meaning("text", options), private: options?.private === true, inherit: options?.inherit });
    },
    boolean<const O extends EntryOptions = {}>(initial = false, options?: EntryOptions & O): Type<boolean, boolean, PrivateOf<O>> {
        return make({ default: initial, editor: meaning("boolean", options), private: options?.private === true, inherit: options?.inherit });
    },
    oneOf<const V extends readonly string[], const O extends EntryOptions = {}>(
        values: V, options?: EntryOptions & O & { readonly default?: V[number] },
    ): Type<V[number], V[number], PrivateOf<O>> {
        const { default: initial, ...rest } = options ?? ({} as O & { default?: V[number] });
        return make({ default: initial ?? values[0], editor: meaning("enum", rest, { options: values }), private: options?.private === true, inherit: options?.inherit });
    },

    fill: attribute<Fill, FillResolved[]>("fills", [], fillOps.resolve, fillOps.lerp),
    stroke: attribute<Stroke, StrokeResolved[]>("strokes", [], strokeOps.resolve, strokeOps.lerp),
    shadow: attribute<Shadow, ShadowResolved[]>("shadows", [], shadowOps.resolve, shadowOps.lerp),
    effects: attribute<Effect, NodeEffect[]>("effects", [], effectsOps.resolve, effectsOps.lerp),
    color: attribute<Color, NormalizedColor>("color", "black", colorOps.resolve, colorOps.lerp),
    cornerRadius: attribute<RectCornerRadius, CornerRadiusResolved>("cornerRadius", 0, cornerRadiusOps.resolve, cornerRadiusOps.lerp),
    cornerStyle: attribute<RectCornerStyle, CornerStyleResolved>("cornerStyle", "rounded", cornerStyleOps.resolve, cornerStyleOps.lerp),
    path: attribute<PathData, PathData>("path", "", undefined, pathOps.lerp),
    insets: attribute<InsetsProps, InsetsResolved>("insets", 0, insetsOps.resolve, insetsOps.lerp),
    alignment: attribute<Alignment, Vector2>("alignment", "center", alignmentOps.resolve, alignmentOps.lerp),
    vector2: attribute<Vector2, Vector2>("vector2", { x: 0, y: 0 }, undefined, vector2Ops.lerp),
    size: attribute<SizeInput, SizeInput>("size", "fill", undefined, sizeInputOps.lerp),

    /** A point in the component's own frame: an editor can drag it. */
    point<const O extends EntryOptions = {}>(initial: Vector2 = { x: 0, y: 0 }, options?: EntryOptions & O): Type<Vector2, Vector2, PrivateOf<O>> {
        return make({ default: initial, tween: vector2Ops.lerp, editor: meaning("point", options), private: options?.private === true, inherit: options?.inherit });
    },
    list<const T extends AnyType, const O extends EntryOptions = {}>(item: T, options?: EntryOptions & O): Type<InOf<T>[], OutOf<T>[], PrivateOf<O>> {
        return make({ default: () => [], editor: meaning("list", options, { item: item._def.editor }), private: options?.private === true, inherit: options?.inherit });
    },
    object<const S extends StateSpec>(shape: S): Type<Inputs<S>, Values<S>> {
        return make({ default: () => defaultsOf(shape), editor: { kind: "object" }, private: false });
    },
    custom<In, Out = In, const O extends EntryOptions = {}>(initial: In, options?: EntryOptions & O & {
        readonly resolve?: (value: In) => Out;
        readonly lerp?: (from: Out, to: Out, t: number) => Out;
        /** What the value is, when a host can't tell from the default (`"vector2"`), and its parts. */
        readonly kind?: string;
        readonly properties?: PropertyEditor["properties"];
    }): Type<In, Out, PrivateOf<O>> {
        const { resolve, lerp, private: _private, inherit: _inherit, ...rest } = options ?? ({} as NonNullable<typeof options>);
        // No kind of its own: a host reads one off the default, as for a bare `property`.
        return make({ default: initial, mapper: resolve, tween: lerp, editor: rest as PropertyEditor, private: options?.private === true, inherit: options?.inherit });
    },
    image: (src = ""): Type<string> => make({ default: src, editor: { kind: "image" }, private: false }),
    video: (src = ""): Type<string> => make({ default: src, editor: { kind: "video" }, private: false }),
    audio: (src = ""): Type<string> => make({ default: src, editor: { kind: "audio" }, private: false }),
    font: (family = ""): Type<string> => make({ default: family, editor: { kind: "font" }, private: false }),
    /** Another node, by id: a document holds the id, and a field reads a view of that node (or `null`). */
    nodeRef: (initial = ""): Type<string, NodeView | null> => make({ default: initial, editor: { kind: "nodeRef", animatable: false }, private: false }),
    /** A seed for deterministic randomness: procedural motion stays a function of time. */
    seed: (initial = 1): Type<number> => make({ default: initial, editor: { kind: "seed" }, private: false }),
};
