import type { Color } from "@/attributes/shape/fill/color/parser";
import type { Passthrough3D } from "./geometry";
import type { Uniform3D } from "./material";
import type { Vector3Input } from "./vector3";

/**
 /** Depth haze fading distant geometry toward a colour. One shape: {@link density} gives exponential fog, {@link near}/{@link far} linear. `color` is derived from the viewport's own fill when omitted; fog that doesn't match what is behind it reads as a grey wall, not distance. */
export interface FogData3D {
    color?: Color;
    /** Linear fog: distance at which fog begins. */
    near?: number;
    /** Linear fog: distance at which fog is total. */
    far?: number;
    /** Exponential-squared falloff. Wins over {@link near}/{@link far}. */
    density?: number;
}

/**
 * Image-based lighting and the sky it comes from, one control because an HDRI that lights a scene is the same
 * panorama seen behind it. A solid colour, gradient or flat image behind the scene is a **2D fill** on the
 * `Canvas3D`; only a sky that *reprojects* as the camera turns needs the 3D pass.
 *
 * What renders today: only {@link preset} `"studio"` (a neutral grey room generated per renderer). {@link src} and
 * {@link faces} are declared, tracked by the asset window and recorded, but no backend loads an HDR, EXR or cubemap,
 * so an environment naming only those lights nothing and draws no {@link background}. {@link params} is not applied
 * either. In development the first of each warns.
 */
export interface EnvironmentData3D extends Passthrough3D {
    /** A 360° panorama (`.hdr`/`.exr` for real IBL, or a plain image). **Not loaded yet**: see the type. */
    src?: string;
    /** Six faces in three's order: +X, −X, +Y, −Y, +Z, −Z. **Not loaded yet**: see the type. */
    faces?: readonly string[];
    /** A built-in studio interior. Needs no asset — the fastest way to good metal. The only environment that renders. */
    preset?: "studio";
    /** Multiplies the light received. Default 1. */
    intensity?: number;
    /** Rotate the panorama, in **degrees**. */
    rotation?: Vector3Input;
    /** Also draw it behind the scene, as an infinitely distant sky. Draws the `preset`; there is nothing to draw for `src`/`faces`. */
    background?: boolean;
    /** Blur applied to the background only, 0–1. Leaves the lighting sharp. */
    blur?: number;
}

/** Scene-wide shadow settings. `quality` stands in for the map resolution and filter three exposes separately (`pcf`, `pcfSoft`, `vsm`, `mapSize`), which are chosen together and aren't design decisions. Lights soften their own shadow; objects opt out with `shadow={false}`. Enabling shadows recompiles every receiving material, so treat it as setup, not something to animate. */
export interface ShadowSettings3D {
    enabled?: boolean;
    /** Default `"medium"`. */
    quality?: "low" | "medium" | "high";
}

/** Shadows as written on a viewport: a switch, or the settings. */
export type Shadows3D = boolean | ShadowSettings3D;

/** Normalize a viewport's `shadows` prop. */
export function resolveShadows3D(value: Shadows3D | undefined): ShadowSettings3D | null {
    if (value === undefined || value === false) return null;
    if (value === true) return { enabled: true };
    return { enabled: true, ...value };
}

/** How HDR colour maps into displayable range: `"aces"` is the filmic default that handles bright highlights; `"none"` clips them. Materials opt out with `toneMapped: false` (UI-like overlays needing an exact colour). */
export type ToneMapping3D =
    | "none"
    | "linear"
    | "reinhard"
    | "cineon"
    | "aces"
    | "agx"
    | "neutral";

/** Tone mapping and exposure, as a viewport carries them. */
export interface ToneSettings3D {
    mapping?: ToneMapping3D;
    /** Stops of exposure applied before mapping. Default 1. */
    exposure?: number;
}

/**
 * A full-frame post-processing pass after the scene renders. Short on purpose: a `Canvas3D` is a `Node2D`, so its
 * `effects` chain (vignette, grain, grading, blur, chromatic aberration) already runs over the composited result, and
 * viewport `antialias` does MSAA. What remains needs the 3D pass: `ssao` and `dof` read depth, `outline` reads object
 * ids, `bloom` reads **HDR radiance before tone mapping** (an emissive surface blooms here and merely brightens in 2D),
 * and `shaderPass` is the escape hatch. Post-processing forces an offscreen target, so any pass costs more than none.
 *
 * **No pass is applied yet.** The chain is recorded and read only to track the textures a `shaderPass` names; a scene
 * with `bloom` renders like one without, and so does every `params`. The first `post` set in development warns.
 * Meanwhile use the 2D `effects` of the `Canvas3D`.
 */
export type PostEffect3D =
    /** Bleeds light from bright pixels, in HDR. What makes `emission` actually glow. */
    | ({ type: "bloom"; strength?: number; radius?: number; threshold?: number } & Passthrough3D)
    /** Contact shadows in creases, from screen-space geometry. */
    | ({ type: "ssao"; radius?: number; intensity?: number } & Passthrough3D)
    | ({ type: "outline"; color?: Color; thickness?: number } & Passthrough3D)
    /** Depth of field. `focus` is the sharp distance, `aperture` the blur strength. */
    | ({ type: "dof"; focus?: number; aperture?: number; maxBlur?: number } & Passthrough3D)
    /** Anything expressible as one fragment pass inside the 3D composite. */
    | ({ type: "shaderPass"; fragment: string; uniforms?: Readonly<Record<string, Uniform3D>> } & Passthrough3D);
