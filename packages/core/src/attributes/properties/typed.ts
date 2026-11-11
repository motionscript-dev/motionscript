import { TweenFn } from "@/props/host";
import { property } from "./decorator";

import { type Fill } from "@/attributes/shape/fill/chain";
import { FillResolved } from "@/attributes/shape/fill/union";
import { fillOps } from "@/attributes/shape/fill/registry";

import { type Effect, effectsOps } from "@/attributes/shape/effects/chain";
import { NodeEffect } from "@/attributes/shape/effects/union";

import { Insets, InsetsResolved, insetsOps } from "@/attributes/layout/insets";
import { Alignment, alignmentOps } from "@/attributes/layout/alignment";
import { Vector2 } from "@/attributes/layout/vector2";
import { flowOps } from "@/layout/ops";
import type { FlowMode, FlowResolved } from "@/layout/types";

import { type AudioEffectsInput } from "@/attributes/audio/effects/chain";
import { audioEffectsOps } from "@/attributes/audio/effects/registry";
import { AudioEffect } from "@/attributes/audio/effects/union";
import { type Param, audioParamOps } from "@/attributes/audio/ramp";

import {
    quaternionOps, lerpOptionalVector3, resolveOptionalVector3,
    type Quaternion, type Vector3, type Vector3Input,
} from "@/render3d/vector3";

/** Attribute-typed variants of `property` for the props the tree bases declare themselves. A rich attribute is only declarative and tweenable because its `property` carries the matching *mapper* (loose input → resolved) and *tween*, together an `AttributeOps`; these pre-bake each pair (`fillProperty()` is `property({ default: [], mapper: fillOps.resolve, tween: fillOps.lerp, kind: "fills" })`). */
interface AttributePropOptions<Ext, Int> {
    default?: Ext;
    mapper?: (ext: Ext, prev?: Int) => Int;
    tween?: TweenFn<Int>;
}

/** Builds one attribute-typed `property` from its {@link AttributeOps}. `fallback` is a factory so array/object defaults aren't one instance shared by every property; an **explicit** `default: undefined` means "no default" and is honoured. */
function attributeProperty<Ext, Int>(
    fallback: () => Ext,
    mapper?: (ext: Ext, prev?: Int) => Int,
    tween?: TweenFn<Int>,
    /** The control a host draws for this attribute, when it is not the default. */
    kind?: string,
) {
    return (opts?: AttributePropOptions<Ext, Int> & { kind?: string }) =>
        property<Ext, Int>({
            default: opts && "default" in opts ? opts.default : fallback(),
            mapper: opts?.mapper ?? mapper,
            tween: opts?.tween ?? tween,
            ...(opts?.kind ?? kind ? { kind: opts?.kind ?? kind } : {}),
        });
}

/** A fill-layer property: a CSS string, a fill prop object, a `Fills` chain, or an array of them, lerped layer by layer. */
export const fillProperty = attributeProperty<Fill, FillResolved[]>(() => [], fillOps.resolve, fillOps.lerp, "fills");

export const effectsProperty = attributeProperty<Effect, NodeEffect[]>(() => [], effectsOps.resolve, effectsOps.lerp, "effects");

export const insetsProperty = attributeProperty<Insets, InsetsResolved>(() => 0, insetsOps.resolve, insetsOps.lerp, "insets");

/** A named position (`'center'`, …) resolved to a {@link Vector2} in `[-1, 1]` and tweened as a vector, so `'centerLeft' → 'centerRight'` slides. */
export const alignmentProperty = attributeProperty<Alignment, Vector2>(() => "center", alignmentOps.resolve, alignmentOps.lerp, "alignment");

/** Mid-tween it holds both modes and how far along, so a seek restoring the prop restores the blend. */
export const flowProperty = attributeProperty<FlowMode, FlowResolved>(() => "freeform", undefined, flowOps.lerp);

/** A 3D point that may be unset (a node's `lookAt`): defaults to unset rather than the origin, stays unset when a binding returns `undefined`, and tweens from `unset`'s reading of an unset start (see {@link lerpOptionalVector3}). */
export function optionalVector3Property(unset: "origin" | "snap") {
    return property<Vector3Input | undefined, Vector3 | undefined>({
        default: undefined,
        mapper: resolveOptionalVector3,
        tween: (from, to, t) => lerpOptionalVector3(from, to, t, unset),
        kind: "vector3",
    });
}

/** A rotation as a unit quaternion, interpolated with shortest-arc slerp. */
export const quaternionProperty = attributeProperty<Quaternion, Quaternion>(
    () => ({ x: 0, y: 0, z: 0, w: 1 }), undefined, quaternionOps.lerp, "quaternion",
);

/** An audio level (gain, pan). A `Param`, not a `number`, because an `AudioRequest` is a schedule record built once during precomp: a per-frame prop write would be read on one frame and never again. A `Ramp` *is* the automation lane, so the tween interpolates whole ramps. */
export const audioParamProperty = attributeProperty<Param, Param>(() => 0, undefined, audioParamOps.lerp, "audioParam");

/** An audio effect chain. Without it the chain is an object-valued prop and `Node._prepareStep` silently drops those: the tween would run its duration and write nothing. */
export const audioEffectsProperty = attributeProperty<AudioEffectsInput, AudioEffect[]>(
    () => [], audioEffectsOps.resolve, audioEffectsOps.lerp, "audioEffects",
);
