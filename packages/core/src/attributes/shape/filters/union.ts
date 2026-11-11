import type { AlphaFilter } from "./implementations/alpha";
import type { BlurFilter } from "./implementations/blur";
import type { ColorAdjustmentFilter } from "./implementations/color-adjustment";
import type { ColorMatrixFilter } from "./implementations/color-matrix";
import type { CurvesFilter } from "./implementations/curves";
import type { ExposureFilter } from "./implementations/exposure";
import type { GrayscaleFilter } from "./implementations/grayscale";
import type { PosterizeTimeFilter } from "./implementations/posterize-time";
import type { VideoEchoFilter } from "./implementations/echo";

import type { NodeEffect } from "../effects/union";
import type { BlurEffect } from "../effects/implementations/blur";
import type { GrayscaleEffect } from "../effects/implementations/grayscale";
import type { CurvesEffect } from "../effects/implementations/curves";
import type { ColorAdjustmentEffect } from "../effects/implementations/color-adjustment";
import type { MagnifyEffect } from "../effects/implementations/magnify";
import type { MotionBlurEffect } from "../effects/implementations/motion-blur";
import type { OutlineEffect } from "../effects/implementations/outline";
import type { DropShadowEffect } from "@/attributes/shape/effects/implementations/drop-shadow";
import type { GlowEffect } from "../effects/implementations/glow";
import type { GlassEffect } from "../effects/implementations/glass";

/**
 * The node effects that are **not** media filters. Everything else in {@link NodeEffect} is a function of the pixels it
 * is given, so it means the same on a node's content or one fill layer's pixels; this is the exception list, so a new
 * effect becomes a filter by default. Two reasons: **it needs something a fill layer lacks** (`magnify` and `glass`
 * sample the backdrop, `motionBlur` and `trails` derive from the node's velocity), or **it draws outside the
 * silhouette** (`outline` paints a ring the fill's clip would cut away, and `glow` bleeds past it; `bloom` stays as the
 * contained version). `blur`, `grayscale`, `curves` and `colorAdjustment` are excluded only because they have dedicated
 * filter types below sharing the same fields and renderer handler.
 */
type NonFilterEffect =
    | MagnifyEffect
    | GlassEffect
    | MotionBlurEffect
    | OutlineEffect
    | DropShadowEffect
    | GlowEffect
    | BlurEffect
    | GrayscaleEffect
    | CurvesEffect
    | ColorAdjustmentEffect;

/** Node effects usable as a media filter: applied to one image/video fill's own pixels rather than a node and everything under it (so a background can be oil-painted without also hitting its children). Their `mode` means nothing here (a fill has no backdrop); the {@link VideoAdjustmentChain} builders drop it and the renderer ignores it. */
export type EffectAdjustment = Exclude<NodeEffect, NonFilterEffect>;

/** Pixel filters valid on both image and video fills, each a per-pixel colour filter or, for those that resample pixel *positions*, a lens pass over the fill. */
export type MediaAdjustment =
    | ExposureFilter
    | BlurFilter
    | GrayscaleFilter
    | AlphaFilter
    | ColorMatrixFilter
    | CurvesFilter
    | ColorAdjustmentFilter
    | EffectAdjustment;

/** Video-only filters: temporal/multi-frame effects meaningless on a still (no time axis, no previous frames), consumed outside the pixel `setImageFilter` path. */
export type VideoOnlyAdjustment =
    | PosterizeTimeFilter
    | VideoEchoFilter;
