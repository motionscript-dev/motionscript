import type { Passthrough3D } from "./geometry";
import type { Transform3D } from "./transform";
import { resolveVector3, type Vector3, type Vector3Input } from "./vector3";

/**
 * What every camera has. Placement has two non-redundant halves: {@link Transform3D} `position` + `lookAt` suits a
 * shot pinned to something (and a camera in a moving rig); the polar half ({@link target}, {@link orbit},
 * {@link elevation}, {@link distance}) suits a shot *about* the subject and animates cleanly, where `position` would
 * need sines composed by hand every frame. Setting any polar field derives `position` and `lookAt`, so the halves
 * are never in force at once. See {@link resolveCameraPlacement}.
 */
export interface CameraCommon3D extends Transform3D, Passthrough3D {
    /** The point the camera looks at, and orbits around. Default origin. */
    target?: Vector3Input;
    /** Azimuth around {@link target}, in **degrees**. 0 looks down −Z. */
    orbit?: number;
    /** Angle above the horizon, in **degrees**. Clamped just short of vertical. */
    elevation?: number;
    distance?: number;

    /** Near and far clip planes, derived from the scene's bounds when omitted (right far more often than any constant: too near a `far` clips the scene's back, too far a `near` clips its front; a tiny `near` costs depth precision only on standard-Z renderers). */
    near?: number;
    far?: number;
    /** Zoom factor applied on top of the projection. */
    zoom?: number;
}

/** A perspective camera: converging rays, so distant things shrink. The default unless you need an orthographic projection's flat look. */
export interface PerspectiveCameraData3D extends CameraCommon3D {
    type: "perspective";
    /** Vertical field of view in **degrees**. Default 50. */
    fov?: number;
}

/** An orthographic camera: parallel rays, so size is independent of distance (isometric views, technical diagrams, 2.5D). {@link frustumHeight} sets the visible world height and the width follows the aspect; an asymmetric frustum is a `params` override, as four explicit edges are a projection-matrix feature, not framing. */
export interface OrthographicCameraData3D extends CameraCommon3D {
    type: "orthographic";
    /** Visible world-space height; width follows the node's aspect. Default 10. */
    frustumHeight?: number;
}

/** Every camera a scene can be viewed through. Discriminated on `type`. */
export type CameraData3D = PerspectiveCameraData3D | OrthographicCameraData3D;

/** True when the camera is placed polar-ly. `target` is deliberately excluded: alone it is `lookAt` under a friendlier name and only becomes a placement once an orbit field is set; including it would discard `position` the moment a camera named a subject. */
/** What an unset polar field of an orbiting camera reads as. */
export const ORBIT_CAMERA_DEFAULTS = { orbit: 0, elevation: 0, distance: 10 } as const;

export function isOrbitCamera3D(camera: CameraData3D): boolean {
    return camera.orbit !== undefined
        || camera.elevation !== undefined
        || camera.distance !== undefined;
}

/** A camera's effective position and aim, shared by the renderer and the editor's picking geometry so they can't disagree about where the camera is. Polar fields win over `position`/`lookAt` when any is set. */
export function resolveCameraPlacement(camera: CameraData3D): {
    position: Vector3;
    lookAt: Vector3 | undefined;
} {
    const target = resolveVector3(camera.target ?? 0);

    if (!isOrbitCamera3D(camera)) {
        // `target` is the subject either way, so a position-placed camera still aims at it.
        const aim = camera.lookAt ?? camera.target;
        return {
            position: resolveVector3(camera.position ?? 0),
            lookAt: aim === undefined ? undefined : resolveVector3(aim),
        };
    }

    const distance = camera.distance ?? ORBIT_CAMERA_DEFAULTS.distance;
    const azimuth = ((camera.orbit ?? ORBIT_CAMERA_DEFAULTS.orbit) * Math.PI) / 180;
    // Just short of the pole: at ±90° the view is parallel to up and the look-at basis is undefined (the shot would snap to an arbitrary roll).
    const elevation = (clamp(camera.elevation ?? ORBIT_CAMERA_DEFAULTS.elevation, -89.9, 89.9) * Math.PI) / 180;

    const horizontal = Math.cos(elevation) * distance;

    return {
        position: {
            x: target.x + Math.sin(azimuth) * horizontal,
            y: target.y + Math.sin(elevation) * distance,
            z: target.z + Math.cos(azimuth) * horizontal,
        },
        lookAt: target,
    };
}

function clamp(value: number, low: number, high: number): number {
    return value < low ? low : value > high ? high : value;
}
