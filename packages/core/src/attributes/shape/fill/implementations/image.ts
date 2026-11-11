import type { BlendMode } from '../blend';
import type { MediaAdjustment } from '../../filters/union';
import type { FillData } from '../registry';
import {
    declareMediaPreset,
    lerpMediaPreset,
    resolveMediaPreset,
    type MediaPresetProp,
    type MediaPresetResolved,
} from '../media-preset';
import { Alignment, alignmentOps } from '@/attributes/layout/alignment';
import { Insets, InsetsResolved, insetsOps } from '@/attributes/layout/insets';
import { Vector2, lerpVector2 } from '@/attributes/layout/vector2';
import { lerpNumber } from '@/tween/lerp';

/**
 * How an image (or video frame) is scaled into its node's bounds: `'fill'` covers, cropping overflow (Figma-style
 * default); `'fit'` contains, letterboxing; `'tile'` repeats at native size (× `zoom`); `'stretch'` scales each axis
 * independently, distorting the aspect ratio.
 */
export type ImageFit = 'fill' | 'fit' | 'tile' | 'stretch';

/** A raw image→shape matrix (3×3 row-major) as a 9-element `Float32Array` or nested array; see {@link ImageFillProp.matrix}. */
export type ImageMatrix = Float32Array | number[][];

/** A window onto the source as **fractions of its own size** (0–1) inset from each edge (`{ left: 0.25 }` discards the left quarter), so a crop is resolution-independent and composes with `fit`/`zoom`/`anchor`, which treat the window as the whole image. An {@link Insets}, so its shorthands and tween come free. */
export type ImageCrop = Insets;

export interface ImageFillProp {
    type: 'image';
    src: string;

    fit?: ImageFit;

    /** Window onto the source, applied **before** `fit`. Not honoured by `fit: 'tile'` (the shader repeats the whole texture). */
    crop?: ImageCrop;

    /** Magnification **on top of** whatever `fit` resolved (`1` is the fitted size). A multiplier so it means the same under every mode; under `'tile'` it is the tile size multiplier. */
    zoom?: number;

    /**
     * The point held fixed as `zoom` scales, and the alignment of the image inside the bounds when it doesn't cover
     * them (default `'center'`). The same `[-1, 1]` y-up space as `pivot`/`align`: the named point of the source lands
     * on the same named point of the box. Ignored by `'tile'`, and inert under `'stretch'` at `zoom: 1`.
     */
    anchor?: Alignment;

    /** Raw image→shape matrix. Wins outright, bypassing `crop`/`fit`/`zoom`/`anchor` **and** the shape bounds, so it must carry the translation itself. Named `matrix`, not `transform`, which is a node's x/y/scale/rotation. */
    matrix?: ImageMatrix;

    /** The grade laid over this picture — see {@link MediaPresetProp}. */
    preset?: MediaPresetProp;
    opacity?: number;
    blend?: BlendMode;
}

export interface ImageFillResolved {
    type: 'image';
    src: string;
    fit?: ImageFit;
    /** Fractional insets, all four sides present. */
    crop?: InsetsResolved;
    zoom?: number;
    /** Normalised `[-1, 1]` y-up point. */
    anchor?: Vector2;
    matrix?: ImageMatrix;
    /** Absent when the fill is ungraded — see {@link resolveMediaPreset}. */
    preset?: MediaPresetResolved<MediaAdjustment>;
    opacity?: number;
    blend?: BlendMode;
}

/** Zero crop — the whole source. Shared by the lerp when only one side crops. */
const NO_CROP: InsetsResolved = { left: 0, right: 0, top: 0, bottom: 0 };
const CENTER: Vector2 = { x: 0, y: 0 };

/** Normalises the loose author shapes once so the backend's matrix builder reads plain values (`crop` four sides, `anchor` a vector) instead of re-deriving them per frame. */
/** @internal */
export function resolveImagePlacement(
    prop: { crop?: ImageCrop; anchor?: Alignment },
): { crop?: InsetsResolved; anchor?: Vector2 } {
    return {
        crop: prop.crop === undefined ? undefined : insetsOps.resolve(prop.crop),
        anchor: prop.anchor === undefined ? undefined : alignmentOps.resolve(prop.anchor),
    };
}

/** Interpolates the placement props shared by image and video fills, in one place so they cannot drift (both feed `computeImageMatrix`). */
/** @internal */
export function lerpImagePlacement(
    a: { crop?: InsetsResolved; zoom?: number; anchor?: Vector2; matrix?: ImageMatrix },
    b: { crop?: InsetsResolved; zoom?: number; anchor?: Vector2; matrix?: ImageMatrix },
    t: number,
): { crop?: InsetsResolved; zoom: number; anchor: Vector2; matrix?: ImageMatrix } {
    return {
        // A raw matrix is not interpolable: it snaps at the midpoint like `fit`; bind the prop to a thunk to move it.
        matrix: t < 0.5 ? a.matrix : b.matrix,
        // Stay `undefined` when neither side crops, so an uncropped fill keeps
        // taking the cheap path and reads back as it was authored.
        crop: a.crop || b.crop ? insetsOps.lerp(a.crop ?? NO_CROP, b.crop ?? NO_CROP, t) : undefined,
        zoom: lerpNumber(a.zoom ?? 1, b.zoom ?? 1, t),
        anchor: lerpVector2(a.anchor ?? CENTER, b.anchor ?? CENTER, t),
    };
}

export const imageFill: FillData<ImageFillResolved> = {
    // `crop`/`anchor` are destructured out before the spread: an optional prop
    // re-added by a later spread widens to a *union* of both types, so leaving
    // them in would type the resolved crop as `ImageCrop | InsetsResolved`.
    resolve: ({ crop, anchor, preset, ...prop }: ImageFillProp): ImageFillResolved => ({
        ...prop,
        ...resolveImagePlacement({ crop, anchor }),
        preset: resolveMediaPreset(preset) as
            | MediaPresetResolved<MediaAdjustment>
            | undefined,
    }),
    lerp: (a, b, t) => ({
        src: t < 0.5 ? a.src : b.src,
        fit: t < 0.5 ? a.fit : b.fit,
        ...lerpImagePlacement(a, b, t),
        opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t,
        // The grade animates with the fill; otherwise `lerpFill`'s spread would carry the *from* grade for the whole tween.
        preset: lerpMediaPreset(a.preset, b.preset, t),
    }),
    equals: (a, b) => a.src === b.src,
    declare: (fill, assets) => {
        assets.image(fill.src);
        declareMediaPreset(fill.preset, assets);
    },
};
