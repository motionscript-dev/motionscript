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
    /**
     * Ceiling on the 3D buffer's device-pixel ratio. Default 2.
     *
     * Lower it for an expensive scene: the 3D renders at a smaller buffer and is
     * scaled up on composite, which trades sharpness for fill rate.
     */
    maxPixelRatio: number;
    /** Multisample the 3D pass. Default true. */
    antialias: boolean;
    /**
     * Turn shadow casting on for the scene. A switch, or `{ quality }`.
     *
     * A render setting rather than a scene object, which is why it is a prop here
     * and not a `<Shadows3D>` node: it has no position, and two of them in a tree
     * meant one silently doing nothing.
     */
    shadows: Shadows3D;
    /** How HDR colour is compressed to what the screen can show. Default `"aces"`. */
    tone: ToneMapping3D;
    /** Stops of exposure applied before tone mapping. Default 1. */
    exposure: number;
    /**
     * Post-processing inside the 3D composite: `bloom`, `ssao`, `dof`, `outline`.
     *
     * Short by design — a `Canvas3D` is a `Node2D`, so vignette, grain, grading,
     * blur and the rest of the 2D `effects` chain already run over the composited
     * result. What is here is what genuinely needs the depth buffer, object ids,
     * or HDR radiance before tone mapping.
     *
     * **Inert today**: the chain is recorded on the scene and no pass is applied,
     * so a viewport with `post` renders exactly like one without (the first one
     * set warns in development). Use the viewport's 2D `effects` instead.
     */
    post: PostEffect3D | readonly PostEffect3D[];
    /**
     * The camera, as three numbers rather than a `<Camera3D>` child.
     *
     * A host that renders a **timeline** needs a camera a `to` command can tween
     * and a scrub can reproduce exactly, and a drag-to-orbit gesture that writes
     * the same values the timeline reads. Only read when the scene contains no
     * camera of its own, so a `<Camera3D>` child still wins.
     */

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

  /**
   * Whether the ground plane is drawn. **Off by default** — it is an authoring
   * reference rather than part of the picture; see the property below.
   */
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
  /**
   * What the grid fades into, when the node's own fills do not answer.
   *
   * **Derived, not authored.** The horizon dissolves into the first solid layer
   * of this node's `fill` — the viewport's background — and falls back to this
   * only when the stack has no solid in it to read (an empty stack, or a
   * gradient or image on its own). A grid that faded into a *different* colour
   * than the one behind it would ring the horizon with a halo, and the way to
   * make that impossible is for there to be nothing to keep in step: see
   * {@link Canvas3DView.fadeColor}.
   *
   * The same rule the engine applies to fog with no colour of its own, one
   * layer down (`View3D.scene`), and for the same reason.
   */
  gridFadeColor: Color;
}
