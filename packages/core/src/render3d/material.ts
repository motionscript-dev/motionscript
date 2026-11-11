import type { Color } from "@/attributes/shape/fill/color/parser";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { Vector3 } from "./vector3";
import type { Passthrough3D } from "./geometry";
import type { Blend3D, Faces3D } from "./transform";
import type { Texture3D } from "./texture";

/** Facet or smooth shading. `"flat"` gives one normal per triangle. */
export type Shading3D = "smooth" | "flat";

/** State every material shares. Fields in the first block are uniform writes the renderer mutates in place, so they're free to animate; **structural** fields change the compiled shader, so changing one mid-timeline forces a recompile: set them once. */
export interface MaterialCommon3D extends Passthrough3D {
    /** 0–1. Free to animate; blending is turned on for you below 1. */
    opacity?: number;
    /** Hide without removing. Free to animate. */
    visible?: boolean;

    /**
     * **Structural, and normally derived.** The renderer turns blending on whenever the material needs it (`opacity`
     * below 1, a colour with alpha, an `alphaMap`, transmission), so a fade needs no second flag. Set it only to *force*
     * blending on an opaque material (draw order); `false` doesn't turn off blending a lower alpha requires.
     */
    transparent?: boolean;
    /** **Structural.** Discard fragments below this alpha. Cheap cutout transparency. */
    alphaTest?: number;
    /** **Structural.** Which faces to rasterize. Default `"front"`. */
    faces?: Faces3D;
    /** **Structural.** Draw edges only. */
    wireframe?: boolean;
    /** **Structural.** How the colour combines with the framebuffer. */
    blend?: Blend3D;
    /** **Structural.** Read per-vertex colours from the geometry's `color` buffer. */
    vertexColors?: boolean;
    /** **Structural.** Apply the scene's tone mapping. Default true. */
    toneMapped?: boolean;

    /** Write to the depth buffer. **Derived unless stated**: a blended surface doesn't write depth and an opaque one does (three defaults `true`, so a translucent mesh would occlude what's drawn after it). Set it for a translucent surface that should occlude. */
    depthWrite?: boolean;
    /** Test against the depth buffer. Turn off to force draw-on-top. */
    depthTest?: boolean;
    /** Nudge depth to break z-fighting between coplanar surfaces. */
    polygonOffset?: boolean;
    polygonOffsetFactor?: number;
    polygonOffsetUnits?: number;
    /** Smooth gradient banding. */
    dithering?: boolean;
}

/** Maps shared by the lit shading models. */
interface CommonMaps3D {
    /** Base colour (albedo). Sampled as sRGB. */
    map?: Texture3D;
    /** Per-pixel opacity, read from the red channel. */
    alphaMap?: Texture3D;
    /** Ambient occlusion, read from the red channel. Needs a second UV set. */
    aoMap?: Texture3D;
    aoMapIntensity?: number;
    /** Tangent-space normals. Sampled as linear data, not colour. */
    normalMap?: Texture3D;
    /** Normal strength, per axis. A number applies to both. */
    normalScale?: number | Vector2;
    /** Displaces vertices along their normals. Needs a subdivided geometry. */
    displacementMap?: Texture3D;
    displacementScale?: number;
    displacementBias?: number;
    /** Reflected environment. Usually inherited from the scene's environment. */
    envMap?: Texture3D;
    /** Multiplies light received from the environment. */
    envMapIntensity?: number;
    /** Baked light added on top, unaffected by scene lights. */
    lightMap?: Texture3D;
    lightMapIntensity?: number;
}

/** Emission shared by the lit shading models. */
interface Emissive3D {
    /** Self-illumination colour. Does not light other objects (see `post` bloom). */
    emission?: Color;
    emissionStrength?: number;
    emissionMap?: Texture3D;
}

/** Unlit — a flat colour, ignoring every light. The cheapest material. */
export interface BasicMaterial3D extends MaterialCommon3D, CommonMaps3D {
    type: "basic";
    color?: Color;
}

/** Physically based metal/rough shading, the sensible default; `roughness` and `metalness` are free to animate. */
export interface StandardMaterial3D extends MaterialCommon3D, CommonMaps3D, Emissive3D {
    type: "standard";
    color?: Color;
    /** 0 mirror-smooth → 1 fully diffuse. */
    roughness?: number;
    /** 0 dielectric → 1 metal. Metals tint their reflections by `color`. */
    metalness?: number;
    roughnessMap?: Texture3D;
    metalnessMap?: Texture3D;
    /** **Structural.** Facet or smooth shading. Default `"smooth"`. */
    shading?: Shading3D;
}

/** {@link StandardMaterial3D} plus clearcoat, transmission (real refraction), sheen and iridescence. Costs more per pixel; prefer `standard` unless needed. */
export interface PhysicalMaterial3D extends Omit<StandardMaterial3D, "type"> {
    type: "physical";
    /** A second specular lobe over the base — car paint, lacquer, varnish. */
    clearcoat?: number;
    clearcoatRoughness?: number;
    clearcoatMap?: Texture3D;
    clearcoatNormalMap?: Texture3D;
    clearcoatRoughnessMap?: Texture3D;
    /** Light transmitted *through* the surface — glass, water. Blends for you. */
    transmission?: number;
    transmissionMap?: Texture3D;
    /** Wall thickness for transmission tinting. */
    thickness?: number;
    thicknessMap?: Texture3D;
    /** Volumetric absorption colour at {@link attenuationDistance}. */
    attenuationColor?: Color;
    attenuationDistance?: number;
    /** Index of refraction. 1.5 glass, 1.33 water, 2.42 diamond. */
    ior?: number;
    /** Retroreflective sheen — cloth, velvet, dust. */
    sheen?: number;
    sheenColor?: Color;
    sheenRoughness?: number;
    /** Thin-film interference — soap bubbles, oil slicks, beetle shells. */
    iridescence?: number;
    iridescenceIOR?: number;
    iridescenceThicknessRange?: readonly [number, number];
    /** Strength/tint of the dielectric specular highlight. */
    specularIntensity?: number;
    specularColor?: Color;
    /** Anisotropic (brushed-metal) highlight stretching. */
    anisotropy?: number;
    /** Degrees. */
    anisotropyRotation?: number;
}

/** Classic Blinn-Phong: a diffuse term plus a tight specular highlight. */
export interface PhongMaterial3D extends MaterialCommon3D, CommonMaps3D, Emissive3D {
    type: "phong";
    color?: Color;
    specular?: Color;
    /** Highlight tightness. Higher is smaller and sharper. */
    shininess?: number;
    specularMap?: Texture3D;
    /** **Structural.** */
    shading?: Shading3D;
}

/** Diffuse-only Lambertian shading. Cheap; good for matte and unlit-ish looks. */
export interface LambertMaterial3D extends MaterialCommon3D, CommonMaps3D, Emissive3D {
    type: "lambert";
    color?: Color;
    /** **Structural.** */
    shading?: Shading3D;
}

/** Banded cel shading. `gradientMap` controls the steps. */
export interface ToonMaterial3D extends MaterialCommon3D, CommonMaps3D, Emissive3D {
    type: "toon";
    color?: Color;
    gradientMap?: Texture3D;
}

/** Surface normals as RGB. A debugging workhorse. */
export interface NormalMaterial3D extends MaterialCommon3D {
    type: "normal";
    /** **Structural.** */
    shading?: Shading3D;
}

/** Depth as greyscale. For debugging and custom depth passes. */
export interface DepthMaterial3D extends MaterialCommon3D {
    type: "depth";
}

/** Lit by a pre-baked sphere image. Very cheap, very stylizable. */
export interface MatcapMaterial3D extends MaterialCommon3D {
    type: "matcap";
    color?: Color;
    matcap?: Texture3D;
    map?: Texture3D;
    normalMap?: Texture3D;
    normalScale?: number | Vector2;
}

/** Shading for a `points` cloud. */
export interface PointsMaterial3D extends MaterialCommon3D {
    type: "points";
    color?: Color;
    size?: number;
    /** Shrink distant points with perspective. Default true. */
    sizeAttenuation?: boolean;
    map?: Texture3D;
    alphaMap?: Texture3D;
}

/** Shading for a `line`. `width` is capped at 1px by most WebGL implementations and **nothing substitutes a mesh-backed line**; draw a `tube` for a thick one. */
export interface LineBasicMaterial3D extends MaterialCommon3D {
    type: "lineBasic";
    color?: Color;
    width?: number;
}

/** A dashed line. Requires computed line distances, which the renderer handles. */
export interface LineDashedMaterial3D extends MaterialCommon3D {
    type: "lineDashed";
    color?: Color;
    width?: number;
    dashSize?: number;
    gapSize?: number;
    /** Offset along the line — animate for a marching-ants effect. */
    scale?: number;
}

/** Shading for a camera-facing `sprite`. */
export interface SpriteMaterial3D extends MaterialCommon3D {
    type: "sprite";
    color?: Color;
    map?: Texture3D;
    /** Degrees. */
    rotation?: number;
}

/** Receives shadows onto an otherwise invisible surface. For AR-style grounding. */
export interface ShadowMaterial3D extends MaterialCommon3D {
    type: "shadow";
    color?: Color;
}

/** A shader uniform value. Narrow on purpose: plain, inspectable, interpolable data keeps a shader-driven scene seekable. */
export type Uniform3D =
    | number
    | boolean
    | Color
    | Vector2
    | Vector3
    | { x: number; y: number; z: number; w: number }
    | readonly number[]
    | Texture3D;

/** Raw GLSL, both stages. Uniform **values** are cheap in-place writes; uniform *names* and the shader **source** are structural (changing either recompiles). {@link extends} is declared but **not read yet**: a shader always replaces the model, so scene lighting, shadows and fog don't reach it (the first material setting it warns in development). */
export interface ShaderMaterial3D extends MaterialCommon3D {
    type: "shader";
    /** Vertex stage source. */
    vertex: string;
    /** Fragment stage source. */
    fragment: string;
    uniforms?: Readonly<Record<string, Uniform3D>>;
    /** `#define`s injected ahead of both stages. **Structural.** */
    defines?: Readonly<Record<string, string | number | boolean>>;
    /** Wraps a built-in shading model so scene lighting, shadows and fog still apply; null (default) is a raw shader. **Not implemented**: no backend reads it. */
    extends?: "standard" | "basic" | "phong" | null;
    /** Skip three's automatic attribute/uniform prelude (a raw shader). */
    raw?: boolean;
}

/** Every material a drawable can be shaded with. Discriminated on `type`. */
export type Material3D =
    | BasicMaterial3D
    | StandardMaterial3D
    | PhysicalMaterial3D
    | PhongMaterial3D
    | LambertMaterial3D
    | ToonMaterial3D
    | NormalMaterial3D
    | DepthMaterial3D
    | MatcapMaterial3D
    | PointsMaterial3D
    | LineBasicMaterial3D
    | LineDashedMaterial3D
    | SpriteMaterial3D
    | ShadowMaterial3D
    | ShaderMaterial3D;

/** Fields the renderer writes in place without recompiling; everything else is structural and rebuilds the material. Shared by the reconciler and the `MeshShorthand` desugarer so they can't disagree about what is cheap. */
export const MUTABLE_MATERIAL_KEYS: readonly string[] = [
    "color", "opacity", "visible", "emission", "emissionStrength",
    "roughness", "metalness", "shininess", "specular", "reflectivity",
    "clearcoat", "clearcoatRoughness", "transmission", "thickness", "ior",
    "sheen", "sheenColor", "sheenRoughness", "iridescence", "iridescenceIOR",
    "specularIntensity", "specularColor", "anisotropy", "anisotropyRotation",
    "attenuationColor", "attenuationDistance",
    "aoMapIntensity", "lightMapIntensity", "envMapIntensity",
    "normalScale", "displacementScale", "displacementBias",
    "size", "width", "dashSize", "gapSize", "scale", "rotation",
    "depthWrite", "depthTest", "polygonOffsetFactor", "polygonOffsetUnits",
];

/** Fields that change the compiled shader program: changing one forces a rebuild, so never tween them (the renderer warns when one changes repeatedly). `transparent` is also derived, but flips at most once per material (the first frame a fade leaves full opacity) and the renderer latches it; see `needsBlending`. */
export const STRUCTURAL_MATERIAL_KEYS: readonly string[] = [
    "transparent", "alphaTest", "faces", "wireframe", "blend",
    "vertexColors", "toneMapped", "shading", "dithering",
    "polygonOffset", "raw", "extends", "defines",
];
