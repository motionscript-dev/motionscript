import {
    component3d,
    Graphics3D,
    lerpVector3,
    Material,
    resolveVector3,
    Types,
    type Mesh3DProps,
    type NodeOf,
    type Values,
    type Vector3,
    type Vector3Input,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Blend3D as _Blend3D,
    type Color as _Color,
    type Faces3D as _Faces3D,
    type Fill3D as _Fill3D,
    type Geometry3D as _Geometry3D,
    type Material3D as _Material3D,
    type Node3D as _Node3D,
    type Node3DProps as _Node3DProps,
    type NormalizedColor as _NormalizedColor,
    type Shading3D as _Shading3D,
    type Texture3D as _Texture3D,
} from "@motionscript/sdk";
import { meshEntries } from "./entries";
import { aim, graphEntry, graphOf } from "./space";

export interface VectorArrow3dProps extends Mesh3DProps {
    tail?: Vector3Input;
    head?: Vector3Input;
    thickness?: number;
    tip?: boolean;
}

function point(initial: Vector3) {
    return Types.custom<Vector3Input, Vector3>(initial, { resolve: resolveVector3, lerp: lerpVector3, kind: "vector3" });
}

const state = {
    ...meshEntries,
    tail: point({ x: 0, y: 0, z: 0 }),
    head: point({ x: 1, y: 1, z: 1 }),
    /** The radius of the shaft, in scene units; the tip is sized from it. */
    thickness: Types.number(0.035, { min: 0.001, step: 0.005 }),
    tip: Types.boolean(true, { animatable: false }),
    graph: graphEntry(),
};

/** An arrow between two points of a 3D graph: a vector from the origin by default. */
export const VectorArrow3d = component3d({
    key: "vectorArrow3d",
    state,
    commands: {
        /** Animate either end, or both. */
        endpointsTo: { args: ["tail", "head"] },
    },
    render: (ctx, s) => ctx.draw(drawArrow(s)),
});

export type VectorArrow3d = NodeOf<typeof VectorArrow3d>;

function drawArrow(s: Values<typeof state>): Graphics3D {
    const g3 = new Graphics3D();
    const space = graphOf(s);
    const { tail, head, thickness } = s;
    // Outside a graph an arrow is drawn in the scene's own units.
    const from = space ? space.offset(tail.x, tail.y, tail.z) : tail;
    const to = space ? space.offset(head.x, head.y, head.z) : head;
    const along: Vector3 = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const length = Math.hypot(along.x, along.y, along.z);
    if (!(length > 0)) return g3;

    const paint = Material.shorthand(s);
    const quaternion = aim(along);
    const tipLength = s.tip ? Math.min(thickness * 8, length) : 0;
    const shaft = length - tipLength;
    const at = (distance: number): Vector3 => ({
        x: from.x + (along.x * distance) / length,
        y: from.y + (along.y * distance) / length,
        z: from.z + (along.z * distance) / length,
    });
    if (shaft > 0) g3.cylinder({ ...paint, radius: thickness, height: shaft, segments: [12, 1], position: at(shaft / 2), quaternion });
    if (tipLength > 0) {
        g3.cone({ ...paint, radius: thickness * 2.8, height: tipLength, segments: [20, 1], position: at(shaft + tipLength / 2), quaternion });
    }
    return g3;
}
