import { NodeEffect } from "./union";

import { blurEffect, blurSpec } from "./implementations/blur";
import { directionalBlurEffect, directionalBlurSpec } from "./implementations/directional-blur";
import { grayscaleEffect, grayscaleSpec } from "./implementations/grayscale";
import { pixelateEffect, pixelateSpec } from "./implementations/pixelate";
import { bulgeEffect, bulgeSpec } from "./implementations/bulge";
import { magnifyEffect, magnifySpec } from "./implementations/magnify";
import { bloomEffect, bloomSpec } from "./implementations/bloom";
import { vintageEffect, vintageSpec } from "./implementations/vintage";
import { chromaticAberrationEffect, chromaticAberrationSpec } from "./implementations/chromatic-aberration";
import { invertEffect, invertSpec } from "./implementations/invert";
import { scatterEffect, scatterSpec } from "./implementations/scatter";
import { posterizeEffect, posterizeSpec } from "./implementations/posterize";
import { motionBlurEffect, motionBlurSpec } from "./implementations/motion-blur";
import { shaderEffect, shaderSpec } from "./implementations/shader";
import { outlineEffect, outlineSpec } from "./implementations/outline";
import { dropShadowEffect, dropShadowSpec } from "./implementations/drop-shadow";
import { vignetteEffect, vignetteSpec } from "./implementations/vignette";
import { grainEffect, grainSpec } from "./implementations/grain";
import { sharpenEffect, sharpenSpec } from "./implementations/sharpen";
import { edgesEffect, edgesSpec } from "./implementations/edges";
import { thresholdEffect, thresholdSpec } from "./implementations/threshold";
import { radialBlurEffect, radialBlurSpec } from "./implementations/radial-blur";
import { halftoneEffect, halftoneSpec } from "./implementations/halftone";
import { ditherEffect, ditherSpec } from "./implementations/dither";
import { duotoneEffect, duotoneSpec } from "./implementations/duotone";
import { curvesEffect, curvesSpec } from "./implementations/curves";
import { colorAdjustmentEffect, colorAdjustmentSpec } from "./implementations/color-adjustment";
import { rgbShiftEffect, rgbShiftSpec } from "./implementations/rgb-shift";
import { scanlinesEffect, scanlinesSpec } from "./implementations/scanlines";
import { blockDisplaceEffect, blockDisplaceSpec } from "./implementations/block-displace";
import { bitCrushEffect, bitCrushSpec } from "./implementations/bit-crush";
import { asciiEffect, asciiSpec } from "./implementations/ascii";
import { streakEffect, streakSpec } from "./implementations/streak";
import { glowEffect, glowSpec } from "./implementations/glow";
import { oilPaintEffect, oilPaintSpec } from "./implementations/oil-paint";
import { waveEffect, waveSpec } from "./implementations/wave";
import { twirlEffect, twirlSpec } from "./implementations/twirl";
import { progressiveBlurEffect, progressiveBlurSpec } from "./implementations/progressive-blur";
import { kaleidoscopeEffect, kaleidoscopeSpec } from "./implementations/kaleidoscope";
import { glassEffect, glassSpec } from "./implementations/glass";
import { lutEffect, lutSpec } from "./implementations/lut";
import { EffectData, EffectSurface, EFFECT_OPTION_KEYS } from "./effect-data";
import { describeSpec, type EffectDescriptor, type EffectSpec } from "./spec";
import type { AssetScope } from "@/assets/scope";


/**
 * Every built-in effect: its spec (the parameters a host and the renderers
 * read) and the `EffectData` derived from it, in registration order.
 */
const BUILT_INS: readonly (readonly [EffectSpec, EffectData<any>])[] = [
    [blurSpec, blurEffect],
    [directionalBlurSpec, directionalBlurEffect],
    [grayscaleSpec, grayscaleEffect],
    [pixelateSpec, pixelateEffect],
    [bulgeSpec, bulgeEffect],
    [magnifySpec, magnifyEffect],
    [bloomSpec, bloomEffect],
    [vintageSpec, vintageEffect],
    [chromaticAberrationSpec, chromaticAberrationEffect],
    [invertSpec, invertEffect],
    [scatterSpec, scatterEffect],
    [posterizeSpec, posterizeEffect],
    [motionBlurSpec, motionBlurEffect],
    [shaderSpec, shaderEffect],
    [outlineSpec, outlineEffect],
    [dropShadowSpec, dropShadowEffect],
    [vignetteSpec, vignetteEffect],
    [grainSpec, grainEffect],
    [sharpenSpec, sharpenEffect],
    [edgesSpec, edgesEffect],
    [thresholdSpec, thresholdEffect],
    [radialBlurSpec, radialBlurEffect],
    [halftoneSpec, halftoneEffect],
    [ditherSpec, ditherEffect],
    [duotoneSpec, duotoneEffect],
    [curvesSpec, curvesEffect],
    [colorAdjustmentSpec, colorAdjustmentEffect],
    [rgbShiftSpec, rgbShiftEffect],
    [scanlinesSpec, scanlinesEffect],
    [blockDisplaceSpec, blockDisplaceEffect],
    [bitCrushSpec, bitCrushEffect],
    [asciiSpec, asciiEffect],
    [streakSpec, streakEffect],
    [glowSpec, glowEffect],
    [oilPaintSpec, oilPaintEffect],
    [waveSpec, waveEffect],
    [twirlSpec, twirlEffect],
    [progressiveBlurSpec, progressiveBlurEffect],
    [kaleidoscopeSpec, kaleidoscopeEffect],
    [glassSpec, glassEffect],
    [lutSpec, lutEffect],
];

const EFFECTS = new Map<string, EffectData<NodeEffect>>(BUILT_INS.map(([spec, data]) => [spec.type, data]));
const SPECS = new Map<string, EffectSpec>(BUILT_INS.map(([spec]) => [spec.type, spec]));

function dataFor(type: string): EffectData<NodeEffect> | undefined {
    return EFFECTS.get(type);
}

/**
 * Normalise one authored effect — see {@link EffectData.resolve}.
 *
 * Returns the effect untouched when its type registers no `resolve`, which is
 * every effect but one.
 */
export function resolveEffect(effect: NodeEffect): NodeEffect {
    const data = dataFor(effect.type);
    return data?.resolve ? data.resolve(effect) : effect;
}

/**
 * Every registered effect type, in registration order.
 *
 * The roster itself, so a contract test can sweep the whole set rather than a
 * hand-kept list that silently misses whatever was added last.
 */
export const effectTypes = (): string[] => [...EFFECTS.keys()];

/** The spec of a built-in effect type, or `undefined`. */
export function effectSpec(type: string): EffectSpec | undefined {
    return SPECS.get(type);
}

const descriptors = new Map<string, EffectDescriptor>();

/**
 * A built-in effect type described for a host — its fields' kinds, defaults,
 * ranges and inspector hints, as plain JSON (see {@link EffectDescriptor}).
 * `undefined` for a type core does not know.
 */
export function describeEffect(type: string): EffectDescriptor | undefined {
    const spec = effectSpec(type);
    if (!spec) return undefined;
    let out = descriptors.get(spec.type);
    if (!out) descriptors.set(spec.type, (out = describeSpec(spec)));
    return structuredClone(out);
}

/** {@link describeEffect} for every built-in effect, in registration order. */
export function effectDescriptors(): EffectDescriptor[] {
    return [...SPECS.keys()].map((type) => describeEffect(type)!);
}

/** True when `type` has a registered `EffectData` handler. */
export function hasEffect(type: string): boolean {
    return dataFor(type) !== undefined;
}

/**
 * How a backend must realise `effect` — see {@link EffectSurface}. Unknown types
 * fall back to `"filter"`, the composable default.
 */
export function effectSurface(effect: NodeEffect): EffectSurface {
    const surface = dataFor(effect.type)?.surface;
    if (surface === undefined) return "filter";
    return typeof surface === "function" ? surface(effect) : surface;
}

export function declareEffect(effect: NodeEffect, assets: AssetScope): void {
    dataFor(effect.type)?.declare?.(effect, assets);
}

/**
 * Interpolates two effects of the same type.
 *
 * The cross-cutting {@link EFFECT_OPTION_KEYS} (`mode`, `clip`) are carried here
 * for every kind, switching at the midpoint like any non-interpolable value, so
 * an effect's own `lerp` only has to describe its parameters and a new option
 * cannot be dropped by one of 45 hand-written copies.
 *
 * @internal
 */
export function lerpEffect(from: NodeEffect, to: NodeEffect, t: number): NodeEffect {
    if (from.type !== to.type) return t < 0.5 ? from : to;
    const data = dataFor(from.type);
    if (!data) return t < 0.5 ? from : to;
    const lerped = data.lerp(from, to, t);
    const source = t < 0.5 ? from : to;
    let out: NodeEffect | undefined;
    for (const key of EFFECT_OPTION_KEYS) {
        if (lerped[key] === source[key]) continue;
        // Copy lazily, and omit rather than write `undefined`: the equality
        // checks compare these fields directly.
        out ??= { ...lerped } as NodeEffect;
        const target = out as unknown as Record<string, unknown>;
        if (source[key] === undefined) delete target[key];
        else target[key] = source[key];
    }
    return out ?? lerped;
}

/**
 * Do two effects describe the same look? The effect's own `equals` compares its
 * parameters; the type and the cross-cutting {@link EFFECT_OPTION_KEYS} are
 * compared here for every kind.
 *
 * @internal
 */
export function equalsEffect(a: NodeEffect, b: NodeEffect): boolean {
    if (a.type !== b.type) return false;
    if (EFFECT_OPTION_KEYS.some((key) => a[key] !== b[key])) return false;
    const data = dataFor(a.type);
    return data ? data.equals(a, b) : a === b;
}
