import type { Color } from "@/attributes/shape/fill/color/parser";
import type { Passthrough3D } from "./geometry";
import type { Shadow3D } from "./transform";
import type { Vector3Input } from "./vector3";

/** Colour, strength and shadow behaviour every light shares. `shadow` is the same {@link Shadow3D} an object carries (see that type for why one name covers both). */
interface LightCommon3D extends Passthrough3D {
    color?: Color;
    intensity?: number;
}

/** Uniform light from every direction. Cheap fill; casts no shadows. */
export interface AmbientLightData3D extends LightCommon3D {
    type: "ambient";
}

/**
 * Two-tone ambient — one colour from above, another from below. A cheap and
 * surprisingly effective stand-in for a sky/ground environment.
 */
export interface HemisphereLightData3D extends Passthrough3D {
    type: "hemisphere";
    /** Colour from above. */
    sky?: Color;
    /** Colour from below. */
    ground?: Color;
    intensity?: number;
}

/**
 * Parallel rays from an infinitely distant source — sunlight. Only the light's
 * *direction* matters, which is the vector from its `position` to {@link target}.
 */
export interface DirectionalLightData3D extends LightCommon3D {
    type: "directional";
    /** World-space point the light aims at. Default origin. */
    target?: Vector3Input;
    shadow?: Shadow3D;
}

/** Light radiating from a point in every direction (a bare bulb). `intensity` is on a directional light's scale (1 is a normal light, not one candela): three measures point/spot in candela and directional in lux, so the same number would differ wildly; the renderer applies the steradian conversion to keep them comparable. */
export interface PointLightData3D extends LightCommon3D {
    type: "point";
    /** Cutoff range. 0 (default) means no cutoff. */
    distance?: number;
    /** Falloff exponent. 2 is physically correct. */
    decay?: number;
    shadow?: Shadow3D;
}

/** A cone of light — a lamp, a torch, a stage spot. */
export interface SpotLightData3D extends LightCommon3D {
    type: "spot";
    target?: Vector3Input;
    /** Cone half-angle in **degrees**. */
    angle?: number;
    /** 0 hard edge → 1 fully feathered. */
    penumbra?: number;
    distance?: number;
    decay?: number;
    shadow?: Shadow3D;
}

/** A glowing rectangle (softbox, strip light, window): the nicest soft light physically, but only with `standard`/`physical` materials and it casts no shadows. Named for what it is, not three's internal "rectArea", and `Rect` already means something else here. */
export interface AreaLightData3D extends LightCommon3D {
    type: "area";
    width?: number;
    height?: number;
}

/** Every light a scene can contain. Discriminated on `type`. */
export type LightData3D =
    | AmbientLightData3D
    | HemisphereLightData3D
    | DirectionalLightData3D
    | PointLightData3D
    | SpotLightData3D
    | AreaLightData3D;
