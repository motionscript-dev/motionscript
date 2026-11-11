/** Union types for every fill variant. A fill's **Prop** is the loose author-facing shape (CSS strings, optional fields); **Resolved** is the strict shape the renderer uses after {@link FillRegistry.resolve}. */

/**
 * Reference frame a fill (and the stroke/shadow wrapping one) resolves against; drawn shapes are treated as one unit
 * (their union) and the space only changes which rect the gradient/image maps onto: `local` (default; the shape's own
 * bounds, pinned to the figure), `parent` (the parent's layout rect; moving the node within it slides it across the
 * fill), `global` (the render viewport; anchored to the frame).
 */
export type FillSpace = "local" | "parent" | "global";

import { SolidFillProp, SolidFillResolved } from "./implementations/color";
import { ConicGradientFillProp, ConicGradientFillResolved } from "./implementations/conic-gradient";
import { ImageFillProp, ImageFillResolved } from "./implementations/image";
import { LinearGradientFillProp, LinearGradientFillResolved } from "./implementations/linear-gradient";
import { NoiseFillProp, NoiseFillResolved } from "./implementations/noise";
import { FractalNoiseFillProp, FractalNoiseFillResolved } from "./implementations/fractal-noise";
import { RadialGradientFillProp, RadialGradientFillResolved } from "./implementations/radial-gradient";
import { ShaderFillProp, ShaderFillResolved } from "./implementations/shader";
import { StripeFillProp, StripeFillResolved } from "./implementations/stripe";
import { DotGridFillProp, DotGridFillResolved } from "./implementations/dot-grid";
import { GridFillProp, GridFillResolved } from "./implementations/grid";
import { VideoFillProp, VideoFillResolved } from "./implementations/video";
import { Canvas3DFillProp, Canvas3DFillResolved } from "./implementations/canvas3d";
import type { Scene3D } from "@/render3d/scene3d";

/** Fields shared by every fill variant, regardless of type. */
export interface FillCommon {
    /** Reference frame this fill resolves against. Defaults to `local`. */
    space?: FillSpace;
}

type WithCommon<T> = T & FillCommon;

export type FillProp =
    | string
    // A bare built scene is shorthand for a {@link Canvas3DFillProp}, as a bare CSS string is for a solid fill (both coerced by the registry).
    | Scene3D
    | WithCommon<SolidFillProp>
    | WithCommon<NoiseFillProp>
    | WithCommon<FractalNoiseFillProp>
    | WithCommon<ShaderFillProp>
    | WithCommon<StripeFillProp>
    | WithCommon<DotGridFillProp>
    | WithCommon<GridFillProp>
    | WithCommon<LinearGradientFillProp>
    | WithCommon<RadialGradientFillProp>
    | WithCommon<ConicGradientFillProp>
    | WithCommon<ImageFillProp>
    | WithCommon<VideoFillProp>
    | WithCommon<Canvas3DFillProp>;

/** Fully resolved fill ready for the renderer. */
export type FillResolved =
    | WithCommon<SolidFillResolved>
    | WithCommon<NoiseFillResolved>
    | WithCommon<FractalNoiseFillResolved>
    | WithCommon<ShaderFillResolved>
    | WithCommon<StripeFillResolved>
    | WithCommon<DotGridFillResolved>
    | WithCommon<GridFillResolved>
    | WithCommon<LinearGradientFillResolved>
    | WithCommon<RadialGradientFillResolved>
    | WithCommon<ConicGradientFillResolved>
    | WithCommon<ImageFillResolved>
    | WithCommon<VideoFillResolved>
    | WithCommon<Canvas3DFillResolved>;
