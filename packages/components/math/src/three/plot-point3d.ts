import {
    component3d,
    Geo,
    Material,
    Types,
    type NodeOf,
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
import { drawLabel3D } from "./label3d";

/**
 * A dot at graph coordinates in a 3D graph, with an optional label. Put inside
 * a surface it rides it: its `x` and `y` say where, and its height is the surface's.
 */
export const PlotPoint3d = component3d({
    key: "plotPoint3d",
    state: {
        ...meshEntries,
        /** In scene units, so a point is the same size whatever the axes show. */
        radius: Types.number(0.1, { min: 0, step: 0.01 }),
        label: Types.text("", { animatable: false }),
        /** The height of the label's text, in scene units. */
        labelSize: Types.number(0.26, { min: 0.01, step: 0.01 }),
        labelColor: Types.color("#e5e7eb"),
        fontFamily: Types.text("", { animatable: false }),
    },
    load: (loader, s) => {
        if (s.fontFamily !== "") loader.font(s.fontFamily);
    },
    render: (ctx, s) => {
        const g3 = Material.mesh(s, s.radius > 0 ? Geo.sphere({ radius: s.radius, segments: [24, 16] }) : undefined);
        drawLabel3D(g3, s.label, { x: 0, y: s.radius + s.labelSize * 0.85, z: 0 }, {
            size: s.labelSize,
            color: s.labelColor,
            fontFamily: s.fontFamily,
        });
        ctx.draw(g3);
    },
});

export type PlotPoint3d = NodeOf<typeof PlotPoint3d>;
