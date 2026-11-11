import type { NodeOf } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import * as View3D from "@/components/modules/view3d";
import type { PostEffect3D, Shadows3D, ToneMapping3D } from "@/render3d/scene-settings";
import type { RectProps } from "@/components/builtins/geometry/geometry";
import type { Color } from "@/attributes/shape/fill/color/parser";

/**
 * The 3D viewport: a rect whose top fill layer is its 3D children's scene, seen
 * by their camera (or the default one), with its 2D children drawn over it.
 */
export const Canvas3D = component2d({
    key: "canvas3d",
    state: { ...Paint.state, ...Flow.state, ...Corners.state, ...View3D.state },
    defaults: { width: "fill", height: "fill" },
    commands: { ...Paint.commands, ...View3D.commands },
    allowedChildren: ["2d", "3d"],
    load: (loader) => View3D.load(loader),
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => View3D.draw(ctx, state),
});

export type Canvas3D = NodeOf<typeof Canvas3D>;

// What code building a 3D viewport names its props as.

export interface Canvas3DProps extends RectProps {
    /** Ceiling on the 3D buffer's device-pixel ratio, default 2; lower it for an expensive scene (renders smaller, scaled up on composite). */
    maxPixelRatio: number;
    /** Multisample the 3D pass. Default true. */
    antialias: boolean;
    /** Turns shadow casting on for the scene: a switch, or `{ quality }`. A render setting, so a prop rather than a `<Shadows3D>` node (it has no position, and two of them meant one silently did nothing). */
    shadows: Shadows3D;
    /** How HDR colour is compressed to what the screen can show. Default `"aces"`. */
    tone: ToneMapping3D;
    /** Stops of exposure applied before tone mapping. Default 1. */
    exposure: number;
    /** Post-processing inside the 3D composite: `bloom`, `ssao`, `dof`, `outline`. Short by design: the 2D `effects` chain already runs over the composited result, so only passes needing depth, object ids or pre-tone-mapping HDR radiance are here. **Inert today**: the chain is recorded and no pass is applied (the first set warns in development); use the viewport's 2D `effects`. */
    post: PostEffect3D | readonly PostEffect3D[];
    /** The camera as three numbers rather than a `<Camera3D>` child, so a timeline `to` can tween it, a scrub reproduce it, and a drag-to-orbit write the values the timeline reads. Only read when the scene has no camera of its own. */

  /** Camera orbit about the vertical axis, in **degrees**. Animate this to spin. */
  orbit: number;
  /** Camera elevation above the ground plane, in **degrees**. */
  elevation: number;
  /** Camera distance from the origin, in scene units. */
  zoom: number;
  /** Vertical field of view, in **degrees**. */
  fov: number;
  /** Strength of the ambient fill. */
  ambientIntensity: number;
  /** Colour of the ambient fill. White leaves the meshes' own colours alone. */
  ambientColor: Color;
  /** Strength of the key light; the rim light is derived from it. */
  keyIntensity: number;
  /** Colour of the key light, and of the rim derived from it. */
  keyColor: Color;

  /** Whether the ground plane is drawn. **Off by default**: it is an authoring reference, not part of the picture. */
  showGrid: boolean;
  /** Total extent of the grid, in scene units. */
  gridSize: number;
  /** How many cells across it. */
  gridDivisions: number;
  /** Every Nth line is drawn heavier. */
  gridMajorEvery: number;
  gridColor: Color;
  gridMajorColor: Color;
  /** Whether the two coloured axis lines are drawn. Off by default, as above. */
  showAxes: boolean;
  axisXColor: Color;
  axisZColor: Color;
  /** How much of the way to the edge the grid has faded out, in `[0, 1]`. */
  gridFade: number;
  /** What the grid fades into when the node's own fills don't answer. **Derived, not authored**: the horizon dissolves into the first solid layer of `fill` (the background), falling back to this only when the stack has none; a different colour would ring the horizon with a halo, so there is nothing to keep in step (see {@link Canvas3DView.fadeColor}). Same rule as fog with no colour (`View3D.scene`). */
  gridFadeColor: Color;
}
