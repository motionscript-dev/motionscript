import { lerpColor3D, orbitPosition, resolveColor3D } from "@/attributes/render3d/orbit";
import type { Color, NormalizedColor } from "@/attributes/shape/fill/color/parser";
import type { Type } from "@/components/factory/api";
import { Types } from "@/components/factory/types";
import { optionalColor, optionalNumber, optionalVector3 } from "@/components/modules/three-entries";
import type { LightData3D } from "@/render3d/light";
import type { Scene3D } from "@/render3d/scene3d";
import type { ShadowOptions3D } from "@/render3d/transform";
import { resolveVector3, type Vector3, type Vector3Input } from "@/render3d/vector3";

/**
 * A 3D stage's lights as one entry: a list of differently shaped items, as a fill list is. Each item has a `type`, a
 * colour, a strength and that type's own fields. Directions are angles (a sun's `orbit` and `elevation`, measured as
 * the stage camera's are), positions are points in the stage's space, and a light that casts a shadow says so with
 * `shadow` (shadows also need the stage's `shadows` switch).
 */

/** Uniform light from every direction: a cheap fill that casts no shadow. */
export interface AmbientStageLight3D {
    type: "ambient";
    color?: Color;
    intensity?: number;
}

/** Parallel light from far away, aimed by two angles: `orbit` about the vertical axis and `elevation` above the ground, in **degrees**. */
export interface SunStageLight3D {
    type: "sun";
    color?: Color;
    intensity?: number;
    orbit?: number;
    elevation?: number;
    shadow?: StageShadow3D;
}

/** One colour from above and another from below: a sky and the ground it lights. */
export interface SkyStageLight3D {
    type: "sky";
    sky?: Color;
    ground?: Color;
    intensity?: number;
}

/** A bare bulb at a point, lighting every way. `distance` is where its light stops (0, the default, never). */
export interface LampStageLight3D {
    type: "lamp";
    color?: Color;
    intensity?: number;
    position?: Vector3Input;
    distance?: number;
    shadow?: StageShadow3D;
}

/** A cone of light from `position` toward `target`; `angle` is the cone's half-angle in **degrees**, `penumbra` its soft edge (0 to 1). */
export interface SpotStageLight3D {
    type: "spot";
    color?: Color;
    intensity?: number;
    position?: Vector3Input;
    target?: Vector3Input;
    angle?: number;
    penumbra?: number;
    distance?: number;
    shadow?: StageShadow3D;
}

/** A glowing rectangle at `position` facing `target`: soft light on standard materials. It casts no shadow. */
export interface SoftBoxStageLight3D {
    type: "softBox";
    color?: Color;
    intensity?: number;
    position?: Vector3Input;
    target?: Vector3Input;
    width?: number;
    height?: number;
}

/** Whether a light casts a shadow: a switch, or how soft and how far it reaches. */
export type StageShadow3D = boolean | ShadowOptions3D;

/** One light on a 3D stage, as written. */
export type StageLight3D =
    | AmbientStageLight3D
    | SunStageLight3D
    | SkyStageLight3D
    | LampStageLight3D
    | SpotStageLight3D
    | SoftBoxStageLight3D;

export type StageLightType3D = StageLight3D["type"];

/** The kinds a stage light can be, in the order a host offers them. */
export const STAGE_LIGHT_TYPES: readonly StageLightType3D[] = ["ambient", "sun", "sky", "lamp", "spot", "softBox"];

type Resolved<L> = {
    readonly [K in keyof L]-?: K extends "type" ? L[K]
        : K extends "color" | "sky" | "ground" ? NormalizedColor
        : K extends "position" | "target" ? Vector3
        : K extends "shadow" ? StageShadow3D
        : Exclude<L[K], undefined>;
};

/** A stage light with every field its type takes filled in. */
export type StageLightResolved3D =
    | Resolved<AmbientStageLight3D>
    | Resolved<SunStageLight3D>
    | Resolved<SkyStageLight3D>
    | Resolved<LampStageLight3D>
    | Resolved<SpotStageLight3D>
    | Resolved<SoftBoxStageLight3D>;

/** What each type of light starts as: the fields a fresh one of it holds. */
export const STAGE_LIGHT_DEFAULTS: { readonly [T in StageLightType3D]: Required<Extract<StageLight3D, { type: T }>> } = {
    ambient: { type: "ambient", color: "#ffffff", intensity: 0.45 },
    sun: { type: "sun", color: "#ffffff", intensity: 2.4, orbit: 36.87, elevation: 50.19, shadow: false },
    sky: { type: "sky", sky: "#ffffff", ground: "#807a70", intensity: 1 },
    lamp: { type: "lamp", color: "#ffffff", intensity: 8, position: [2, 3, 2], distance: 0, shadow: false },
    spot: { type: "spot", color: "#ffffff", intensity: 12, position: [3, 5, 3], target: [0, 0, 0], angle: 30, penumbra: 0.3, distance: 0, shadow: false },
    softBox: { type: "softBox", color: "#ffffff", intensity: 4, position: [0, 4, 3], target: [0, 0, 0], width: 3, height: 2 },
};

/** How far from the stage's centre a sun sits: only its direction lights, but a shadow is cast from there. */
const SUN_DISTANCE = 10;

/**
 * The rig a stage has until told otherwise: an ambient fill, a key light above and to the right, and a rim light
 * from below behind at 0.35 of the key. The key and rim are the directions of `[4, 6, 3]` and `[-5, -2, -4]`.
 */
export function stageRig(options: { ambient?: number; ambientColor?: Color; key?: number; keyColor?: Color } = {}): StageLight3D[] {
    const key = options.key ?? 2.4;
    const keyColor = options.keyColor ?? "#ffffff";
    return [
        { type: "ambient", color: options.ambientColor ?? "#ffffff", intensity: options.ambient ?? 0.45 },
        { type: "sun", color: keyColor, intensity: key, orbit: 36.87, elevation: 50.19 },
        { type: "sun", color: keyColor, intensity: round(key * 0.35), orbit: -141.34, elevation: -17.35 },
    ];
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function isType(type: unknown): type is StageLightType3D {
    return typeof type === "string" && (STAGE_LIGHT_TYPES as readonly string[]).includes(type);
}

/**
 * Every field of `light`'s type, the unset ones from its defaults. An item of no known type is kept as written (a
 * host's panel shows the resolved list, so dropping it would delete what was just added) and draws nothing.
 */
export function resolveStageLight(light: StageLight3D): StageLightResolved3D {
    if (!isObject(light) || !isType(light.type)) return light as unknown as StageLightResolved3D;
    const base = STAGE_LIGHT_DEFAULTS[light.type] as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { type: light.type };
    for (const key of Object.keys(base)) {
        if (key === "type") continue;
        const value = (light as unknown as Record<string, unknown>)[key] ?? base[key];
        out[key] = key === "color" || key === "sky" || key === "ground"
            ? resolveColor3D(value as Color)
            : key === "position" || key === "target"
                ? resolveVector3(value as Vector3Input)
                : value;
    }
    return out as StageLightResolved3D;
}

export function resolveStageLights(lights: readonly StageLight3D[] | undefined): StageLightResolved3D[] {
    return Array.isArray(lights) ? lights.map(resolveStageLight) : [];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Two lights of one type blend field by field; of two types, or with a switch between them, they swap at the end. */
function lerpLight(from: StageLightResolved3D, to: StageLightResolved3D, t: number): StageLightResolved3D {
    if (!isObject(from) || !isObject(to) || from.type !== to.type) return t < 1 ? from : to;
    const out: Record<string, unknown> = { type: to.type };
    for (const [key, end] of Object.entries(to)) {
        if (key === "type") continue;
        const start = (from as Record<string, unknown>)[key];
        if (typeof start === "number" && typeof end === "number") out[key] = lerp(start, end, t);
        else if (Array.isArray(start) && Array.isArray(end) && start.length === 4) out[key] = lerpColor3D(start as NormalizedColor, end as NormalizedColor, t);
        else if (isObject(start) && isObject(end) && typeof start.x === "number") {
            out[key] = { x: lerp(start.x, end.x as number, t), y: lerp(start.y as number, end.y as number, t), z: lerp(start.z as number, end.z as number, t) };
        } else out[key] = t < 1 ? start : end;
    }
    return out as StageLightResolved3D;
}

/** The light at no strength: what one fades in from, or out to. */
function dark(light: StageLightResolved3D): StageLightResolved3D {
    return isObject(light) && typeof light.intensity === "number" ? { ...light, intensity: 0 } : light;
}

/** Item by item: a light only one end has fades in from dark or out to it, and leaves the list when the tween lands. */
export function lerpStageLights(from: readonly StageLightResolved3D[], to: readonly StageLightResolved3D[], t: number): StageLightResolved3D[] {
    if (t >= 1) return [...to];
    const out: StageLightResolved3D[] = [];
    for (let i = 0; i < Math.max(from.length, to.length); i++) {
        const a = from[i];
        const b = to[i];
        out.push(a && b ? lerpLight(a, b, t) : a ? lerpLight(a, dark(a), t) : lerpLight(dark(b!), b!, t));
    }
    return out;
}

/** The `lights` entry: today's three-light rig by default. */
export function lightsEntry(initial: StageLight3D[] = stageRig()): Type<StageLight3D[], StageLightResolved3D[]> {
    return Types.custom<StageLight3D[], StageLightResolved3D[]>(initial, {
        resolve: resolveStageLights,
        lerp: lerpStageLights,
        kind: "lights",
    });
}

/** Light `light` of the list, `fields` moving from where they stand. */
export const lightTo = {
    args: {
        light: Types.number(0, { min: 0, step: 1 }),
        color: optionalColor(),
        intensity: optionalNumber({ min: 0, step: 0.05 }),
        orbit: optionalNumber({ step: 1, unit: "°" }),
        elevation: optionalNumber({ min: -90, max: 90, step: 1, unit: "°" }),
        position: optionalVector3("snap"),
    },
} as const;

/** The list with light `index` moved toward `fields` by `t`: what `lightTo` writes each frame. */
export function lightToFrame(
    lights: readonly StageLightResolved3D[],
    index: number,
    fields: { color?: NormalizedColor; intensity?: number; orbit?: number; elevation?: number; position?: Vector3 },
    t: number,
): StageLightResolved3D[] {
    const i = Math.round(index);
    const from = lights[i];
    if (!isObject(from)) return [...lights];
    const target: Record<string, unknown> = { ...from };
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || !(key in from)) continue;
        target[key] = key === "color" ? resolveColor3D(value as Color) : value;
    }
    const out = [...lights];
    out[i] = lerpLight(from, target as StageLightResolved3D, t);
    return out;
}

/** The lights as the scene records them. An item of no known type, or with no strength, adds nothing. */
export function lightStage(scene: Scene3D, lights: readonly StageLightResolved3D[]): void {
    for (const light of lights) {
        if (!isObject(light) || !isType(light.type)) continue;
        const shadow = "shadow" in light && light.shadow !== false ? { shadow: light.shadow === true ? {} : light.shadow } : {};
        switch (light.type) {
            case "ambient":
                scene.light({ type: "ambient", color: light.color as Color, intensity: light.intensity });
                break;
            case "sun": {
                const at = orbitPosition({ orbit: light.orbit, elevation: light.elevation, distance: SUN_DISTANCE });
                scene.light({ type: "directional", color: light.color as Color, intensity: light.intensity, ...shadow } as LightData3D, { position: at });
                break;
            }
            case "sky":
                scene.light({ type: "hemisphere", sky: light.sky as Color, ground: light.ground as Color, intensity: light.intensity }, { position: [0, 1, 0] });
                break;
            case "lamp":
                scene.light({ type: "point", color: light.color as Color, intensity: light.intensity, distance: light.distance, ...shadow } as LightData3D, { position: light.position });
                break;
            case "spot":
                scene.light({
                    type: "spot", color: light.color as Color, intensity: light.intensity, target: light.target,
                    angle: light.angle, penumbra: light.penumbra, distance: light.distance, ...shadow,
                } as LightData3D, { position: light.position });
                break;
            case "softBox":
                scene.light({ type: "area", color: light.color as Color, intensity: light.intensity, width: light.width, height: light.height }, { position: light.position, lookAt: light.target });
                break;
        }
    }
}
