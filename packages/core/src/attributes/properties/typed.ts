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

/**
 * Attribute-typed variants of `property`, for the props the tree bases declare
 * themselves (`Node2D`, `Node3D`, `NodeAudio`, the root `Canvas2D`).
 *
 * A rich attribute (a fill, an effect chain, an inset) is only declarative and
 * tweenable because its `property` carries the matching *mapper* (loose author
 * input → resolved value) and *tween* (how the resolved value interpolates) —
 * together, an `AttributeOps` (`attributes/shared/operators.ts`). These pre-bake
 * each pair: `fillProperty()` is exactly
 * `property({ default: [], mapper: fillOps.resolve, tween: fillOps.lerp, kind: "fills" })`.
 * A component declares the same pairs as state entries (`Types.fill`, …).
 */
interface AttributePropOptions<Ext, Int> {
    /** Initial value, used when the constructor `props` object omits the key. */
    default?: Ext;
    /** Override the attribute's built-in external → internal mapper. */
    mapper?: (ext: Ext, prev?: Int) => Int;
    /** Override the attribute's built-in lerp for `to()`. */
    tween?: TweenFn<Int>;
}

/**
 * Build one attribute-typed `property` from its canonical {@link AttributeOps}.
 *
 * `fallback` is a factory rather than a value so array/object defaults aren't a
 * single instance shared by every property declared through it. An **explicit**
 * `default: undefined` means "this prop has no default" and is honoured as such.
 */
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

/** An effect-chain property — the `effects` prop's op set. */
export const effectsProperty = attributeProperty<Effect, NodeEffect[]>(() => [], effectsOps.resolve, effectsOps.lerp, "effects");

/** An edge-inset property: scalar, symmetric or per-edge, tweened per edge. */
export const insetsProperty = attributeProperty<Insets, InsetsResolved>(() => 0, insetsOps.resolve, insetsOps.lerp, "insets");

/**
 * An alignment property: a named position (`'center'`, `'topLeft'`, …) resolved
 * to a per-axis {@link Vector2} in `[-1, 1]`, tweened as a vector so
 * `'centerLeft' → 'centerRight'` slides.
 */
export const alignmentProperty = attributeProperty<Alignment, Vector2>(() => "center", alignmentOps.resolve, alignmentOps.lerp, "alignment");

/**
 * A layout-mode property. Mid-tween it holds both modes and how far along, so
 * restoring the prop — which is what a seek does — restores the blend with it.
 */
export const flowProperty = attributeProperty<FlowMode, FlowResolved>(() => "freeform", undefined, flowOps.lerp);

/**
 * A 3D point that may be unset: a node's `lookAt`. It defaults to unset (not to
 * the origin), stays unset when a binding returns `undefined`, and tweens with
 * `to()` — from `unset`'s reading of an unset start (see {@link lerpOptionalVector3}).
 */
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

/**
 * An audio level — a gain, a pan position, anything a clip or a bus schedules.
 *
 * `Param`, not `number`, because an `AudioRequest` is a schedule record built
 * once during precomp: a per-frame prop write would be read on whichever frame
 * happened to create the request and then never again. A `Ramp` *is* the
 * automation lane, which is why the tween interpolates between whole ramps.
 */
export const audioParamProperty = attributeProperty<Param, Param>(() => 0, undefined, audioParamOps.lerp, "audioParam");

/**
 * An audio effect chain — the `effects` prop's op set.
 *
 * Without it a chain is an object-valued prop, and `Node._prepareStep` drops
 * those silently: the tween would run its duration and write nothing.
 */
export const audioEffectsProperty = attributeProperty<AudioEffectsInput, AudioEffect[]>(
    () => [], audioEffectsOps.resolve, audioEffectsOps.lerp, "audioEffects",
);
