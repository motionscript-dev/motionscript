import type { Graphics3D } from "./graphics3d";
import type { CameraData3D } from "./camera";
import type { LightData3D } from "./light";
import type {
    EnvironmentData3D, FogData3D, PostEffect3D, Shadows3D, ToneSettings3D,
} from "./scene-settings";
import type { Transform3D } from "./transform";
import type { Color } from "@/attributes/shape/fill/color/parser";

/** Per-node state for a `Node3D`'s draw scope, the 3D counterpart of `NodeRenderState`. No layout rect or motion: a 3D node's whole placement is its `transform`. */
export interface Node3DRenderState {
    /** Stable node identifier: keys the renderer's cache so a drawable survives a conditional sibling appearing or disappearing, where a positional index would renumber and rebuild the tail. */
    id: string;
    /** This node's placement relative to its parent. */
    transform?: Transform3D;
}

/**
 * The context passed to every `Node3D` when it draws itself: the 3D sibling of `RenderContext2D`, not its subclass
 * (they share no members: a 3D scene is a camera, lights and meshes, not paths, paint and clips). A {@link Graphics3D}
 * is what one node draws (geometry and material); everything belonging to the scene is a call on the context:
 *
 *   protected renderSelf(ctx: RenderContext3D): void {
 *       ctx.light({ type: "ambient", intensity: 0.4 });
 *   }
 *
 * `begin(state)` / `end()` bracket each node's draw and carry its identity and placement, so nesting is the node
 * tree's and the renderer can cache per node. `Scene3D` is the shipped implementation, recording calls into a value
 * a backend replays.
 *
 * There is no `background`: behind a 3D scene is either a **2D fill** on the viewport (which composites correctly and
 * gets the whole fill chain) or a sky, part of {@link environment} since an HDRI that lights a scene is the panorama
 * seen behind it.
 */
export abstract class RenderContext3D {
    /** Opens a node draw scope, paired with {@link end}: everything recorded until then nests under this node and inherits its transform. */
    abstract begin(state: Node3DRenderState): void;

    abstract end(): void;

    abstract draw(graphics: Graphics3D): void;

    abstract light(light: LightData3D, transform?: Transform3D): void;

    /** Places the scene camera at the current scope. Recorded in the hierarchy, not as a scene-wide field, so a camera in a moving group is carried by it (composed like a mesh's world transform). No camera gets a default framing; with several, the last wins. */
    abstract camera(camera: CameraData3D): void;

    // Scene-wide settings have no position, so they are not hierarchical: a scene has one fog and one environment, and the last node to set one wins.

    /** Set the scene fog. A bare colour is sugar for `{ color }`; `null` clears it. */
    abstract fog(fog: FogData3D | Color | null): void;
    /** Set the image-based lighting environment and sky, or `null` for none. */
    abstract environment(environment: EnvironmentData3D | null): void;
    /** Enable/configure shadow casting for the whole scene. */
    abstract shadows(settings?: Shadows3D): void;
    /** Set tone mapping and exposure. */
    abstract tone(settings: ToneSettings3D): void;
    /** Append post-processing passes, applied in order after the scene renders. */
    abstract post(effects: PostEffect3D | readonly PostEffect3D[]): void;
}
