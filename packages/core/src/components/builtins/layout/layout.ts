import { lerpLookAt, type LookAt } from "@/attributes/layout/space3d";
import type { NodeOf } from "@/components/factory/api";
import { component2d } from "@/components/factory/component2d";
import { commandsFor } from "@/components/factory/commands-for";
import { Types } from "@/components/factory/types";
import * as Aim from "@/components/modules/aim";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { RectCornerRadius } from "@/attributes/shape/corners/corner-radius";
import type { RectCornerStyle } from "@/attributes/shape/corners/corner-style";
import type { ShapeProps } from "@/components/builtins/geometry/geometry";
import type { Node2DProps } from "@/components/trees/2d/node2d";

/** A framed viewport: painted like a rect, its children seen through a camera aimed inside it. */
export const Camera = component2d({
    key: "camera",
    state: { ...Paint.state, ...Flow.state, ...Aim.state, ...Corners.state },
    commands: { ...Paint.commands, ...Aim.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Corners.rect(ctx.size, state), { children: () => Aim.camera(ctx, state) }),
});

const orbit = {
    lookAt: Types.custom<LookAt>({ x: 0, y: 0 }, {
        lerp: lerpLookAt, kind: "vector2", properties: { x: { kind: "number" }, y: { kind: "number" }, z: { kind: "number" } },
    }),
    zoom: Types.number(1, { min: 0.01, step: 0.1, unit: "×" }),
    heading: Types.number(0, { step: 1, unit: "°" }),
    orbit: Types.number(0, { step: 1, unit: "°" }),
    elevation: Types.number(0, { step: 1, unit: "°" }),
    dolly: Types.number(0, { step: 10 }),
    orbitSpeed: Types.number(0),
};

/** The stage's 2.5D camera for one subtree: its children stand in one space, orbited in depth. */
export const OrbitCamera = component2d({
    key: "orbitCamera",
    state: orbit,
    defaults: { width: "hug", height: "hug", perspective: 1000 },
    commands: commandsFor(orbit, {
        orbitTo: { args: ["orbit", "elevation"] },
        dollyTo: { args: ["dolly"] },
        zoomTo: { args: ["zoom"] },
        panTo: { args: ["lookAt"] },
        headingTo: { args: ["heading"] },
    }),
    render: (ctx, state) => ctx.space({
        perspective: state.perspective,
        orbit: state.orbit + state.orbitSpeed * ctx.time.total,
        elevation: state.elevation,
        dolly: state.dolly,
        lookAt: state.lookAt,
        zoom: state.zoom,
        heading: state.heading,
        viewportX: 0,
        viewportY: 0,
    }),
});

/** Its children laid out in a box turned by `angle`, and turned with it: the box it reports is the turned one's bounds. */
export const RotatedBox = component2d({
    key: "rotated-box",
    state: { angle: Types.number(-90) },
    defaults: { rotation: (state) => state.angle },
    measure: (measurer, state, children) => {
        const { cos, sin } = turn(state.angle);
        const { width: w, height: h } = measurer.max;
        const ortho = Math.abs(state.angle % 180) === 90;
        const room = w !== undefined && h !== undefined
            ? { width: w * cos + h * sin, height: w * sin + h * cos }
            : { width: ortho ? h : w, height: ortho ? w : h };
        let width = 0;
        let height = 0;
        for (const child of children) {
            const size = child.measure(room);
            width = Math.max(width, size.width);
            height = Math.max(height, size.height);
        }
        return { width: width * cos + height * sin, height: width * sin + height * cos };
    },
    layout: (box, state, children) => {
        const { cos, sin } = turn(state.angle);
        const turned = { x: 0, y: 0, width: box.width * cos + box.height * sin, height: box.width * sin + box.height * cos };
        return Flow.layout(turned, state as unknown as Flow.FlowState, children);
    },
});

function turn(angle: number): { cos: number; sin: number } {
    const rad = angle * (Math.PI / 180);
    return { cos: Math.abs(Math.cos(rad)), sin: Math.abs(Math.sin(rad)) };
}

export type Camera = NodeOf<typeof Camera>;
export type OrbitCamera = NodeOf<typeof OrbitCamera>;
export type RotatedBox = NodeOf<typeof RotatedBox>;

// What code building a camera or a rotated box names its props as.

export interface CameraProps extends ShapeProps {
    /** Magnification factor. Values > 1 zoom in; < 1 zoom out. */
    zoom: number;
    /**
     * World-space point that maps to the centre of the camera viewport — what
     * the camera is pointed at. Same name and meaning as
     * `Graphics3D.perspective({ lookAt })`, so a 2D and a 3D camera are aimed
     * with the same word.
     */
    lookAt: Vector2;
    /** Rotation of the camera view in degrees (clockwise). */
    heading: number;
    /**
     * A node of the camera's world to keep in view, by id: the camera is aimed
     * at its centre each frame, and {@link lookAt} becomes an offset from it.
     */
    follow: string;
    /** Corner radius in pixels — uniform, per-corner, or per-axis. */
    cornerRadius: RectCornerRadius;
    /** How each corner is shaped once it has a radius: `'rounded'` or `'angled'`. */
    cornerStyle: RectCornerStyle;
}

export interface OrbitCameraProps extends Node2DProps {
    /** The point the camera orbits and looks at; `z` puts it in depth, as a node's `depth` does. */
    lookAt: LookAt;
    /** Lens zoom, applied after the projection. Values > 1 zoom in. */
    zoom: number;
    /** Roll of the view in degrees, clockwise. */
    heading: number;
    /** Degrees about the vertical axis through {@link lookAt}. 0 is head-on; positive moves the camera right. */
    orbit: number;
    /** Degrees above the layers. Positive looks down on them. */
    elevation: number;
    /** Px the camera has moved in toward {@link lookAt}. Inert with no perspective. */
    dolly: number;
    /** Degrees per second the camera orbits on its own — a turntable. */
    orbitSpeed: number;
}

// Adjust this import path if needed

export interface RotatedBoxProps extends Node2DProps {
    /** 
     * Visual rotation angle in degrees. Unlike standard `rotation`, 
     * animating this ALSO dynamically calculates a new bounding box 
     * for the flex/layout engine. 
     */
    angle: number;
}
