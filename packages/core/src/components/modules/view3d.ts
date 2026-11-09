import type { LoaderFn } from "@/assets/record";
import { cameraOrbit, lerpColor3D, resolveColor3D } from "@/attributes/render3d/orbit";
import type { Color, NormalizedColor } from "@/attributes/shape/fill/color/parser";
import { Fills } from "@/attributes/shape/fill/chain";
import type { FillResolved } from "@/attributes/shape/fill/union";
import { gridGeometry3D, type Grid3DOptions } from "@/components/builtins/three/grid-geometry3d";
import type { BufferGeometry3D } from "@/render3d/geometry";
import { Graphics3D } from "@/render3d/graphics3d";
import { warmCanvas3D } from "@/render3d/resources";
import { resolveShadows3D, type PostEffect3D, type Shadows3D, type ToneMapping3D } from "@/render3d/scene-settings";
import { Scene3D } from "@/render3d/scene3d";
import type { Canvas3DFillResolved } from "@/attributes/shape/fill/implementations/canvas3d";
import { isSurfaceTexture3D, resolveSurfaceSource } from "@/render3d/texture";
import { forEachTexture3D } from "@/render3d/walk";
import type { Loader, RenderContext2D, Type, Values } from "@/components/factory/api";
import { Types } from "@/components/factory/types";
import { internalsOf } from "@/components/factory/views";
import * as Corners from "@/components/modules/corners";
import * as Paint from "@/components/modules/paint";
import { optional } from "@/components/modules/three-entries";

/**
 * A viewport onto its 3D children: the default camera and light rig a scene
 * gets when it has none of its own, the floor grid, and the render settings.
 */

function color3D(initial: Color): Type<Color, NormalizedColor> {
    return Types.custom<Color, NormalizedColor>(initial, { resolve: resolveColor3D, lerp: lerpColor3D });
}

export const state = {
    orbit: Types.number(35, { step: 1, unit: "°" }),
    elevation: Types.number(20, { min: -89, max: 89, step: 1, unit: "°" }),
    zoom: Types.number(12, { min: 0.01, step: 0.1 }),
    fov: Types.custom(45),
    ambientIntensity: Types.custom(0.45),
    ambientColor: color3D("#ffffff"),
    keyIntensity: Types.custom(2.4),
    keyColor: color3D("#ffffff"),
    showGrid: Types.custom(false),
    gridSize: Types.custom(40),
    gridDivisions: Types.custom(40),
    gridMajorEvery: Types.custom(5),
    gridColor: color3D("#26292f"),
    gridMajorColor: color3D("#363a42"),
    showAxes: Types.custom(false),
    axisXColor: color3D("#c8404f"),
    axisZColor: color3D("#2f6fd0"),
    gridFade: Types.custom(0.55),
    gridFadeColor: color3D("#0b0d12"),
    maxPixelRatio: Types.custom(2),
    antialias: Types.custom(true),
    shadows: Types.custom<Shadows3D>(false),
    tone: optional<ToneMapping3D>(),
    exposure: optional<number>(),
    post: optional<PostEffect3D | readonly PostEffect3D[]>(),
};

export const commands = {
    /** Swing the default camera: only the angles given move. */
    orbitTo: { args: ["orbit", "elevation", "zoom"] as const },
};

type ViewState = Values<typeof state> & { readonly fill: FillResolved[] };

const loadThreeRuntime: LoaderFn = async () => {
    await warmCanvas3D();
};

/**
 * The 3D runtime, warmed before the first frame, and whatever `extend` draws:
 * pass the `extend` your render hands {@link draw}, so its textures, models and
 * surfaces load before a frame needs them, as a 3D child's own drawing does.
 */
export function load(loader: Loader, extend?: (scene: Scene3D) => void): void {
    loader.task("three:runtime", loadThreeRuntime);
    if (!extend) return;
    const scene = new Scene3D();
    extend(scene);
    const fill: Canvas3DFillResolved = { type: "canvas3D", scene };
    loader.fill(fill);
}

const grids = new WeakMap<object, { readonly key: string; readonly geometry: BufferGeometry3D }>();

/**
 * Your 3D children's scene with this view's settings, its grid, and the default
 * camera and lights where the scene has none; `extend` draws more into it last.
 * `null` when there is nothing to show.
 */
export function scene(ctx: RenderContext2D, s: ViewState, extend?: (scene: Scene3D) => void): Scene3D | null {
    const scene = ctx.scene3D();
    const hasChildren = scene.ops().length > 0;
    const shadows = resolveShadows3D(s.shadows);
    if (shadows) scene.shadows(shadows);
    if (s.tone !== undefined || s.exposure !== undefined) scene.tone({ mapping: s.tone, exposure: s.exposure });
    if (s.post !== undefined) scene.post(s.post);
    const fog = scene.fogDescriptor();
    if (fog && fog.color === undefined) {
        const base = baseColor(s.fill);
        if (base !== undefined) scene.fog({ ...fog, color: base });
    }
    if (s.showGrid) {
        scene.draw(new Graphics3D().line({
            geometry: gridOf(internalsOf(ctx).host, s),
            segments: true,
            material: { type: "lineBasic", vertexColors: true, toneMapped: false },
        }));
    }
    if (!extend && scene.isEmpty() && !hasChildren) return null;
    if (scene.cameraDescriptor() === null) {
        scene.perspective({ fov: s.fov, orbit: cameraOrbit(s.orbit), elevation: s.elevation, distance: s.zoom });
    }
    if (!scene.ops().some((op) => op.kind === "light")) {
        scene
            .light({ type: "ambient", intensity: s.ambientIntensity, color: s.ambientColor })
            .light({ type: "directional", intensity: s.keyIntensity, color: s.keyColor }, { position: [4, 6, 3] })
            .light({ type: "directional", intensity: s.keyIntensity * 0.35, color: s.keyColor }, { position: [-5, -2, -4] });
    }
    extend?.(scene);
    return scene.isEmpty() ? null : scene;
}

/** The box painted, with the scene as its top fill layer. */
export function draw(ctx: RenderContext2D, s: ViewState & Parameters<typeof Paint.draw>[1] & Values<typeof Corners.state>, extend?: (scene: Scene3D) => void): void {
    const built = scene(ctx, s, extend);
    const internals = internalsOf(ctx);
    if (built && !internals.probing) {
        built.assertBalanced();
        // A surface texture draws a detached 2D node: it renders in this node's scope.
        const host = internals.host as unknown as { attachDetached(node: object): void };
        forEachTexture3D(built, (texture) => {
            if (!isSurfaceTexture3D(texture)) return;
            const source = resolveSurfaceSource(texture.source);
            if (source.kind === "node") host.attachDetached(source.node);
        });
    }
    const fill = built ? [...s.fill, ...Fills.canvas3D(built, { maxPixelRatio: s.maxPixelRatio, antialias: s.antialias })] : s.fill;
    Paint.draw(ctx, s, Corners.rect(ctx.size, s), { fill: fill as never });
}

function gridOf(host: object, s: ViewState): BufferGeometry3D {
    const options: Grid3DOptions = {
        size: s.gridSize,
        divisions: Math.max(1, Math.round(s.gridDivisions)),
        majorEvery: Math.max(1, Math.round(s.gridMajorEvery)),
        minorColor: s.gridColor,
        majorColor: s.gridMajorColor,
        axisXColor: s.axisXColor,
        axisZColor: s.axisZColor,
        showAxes: s.showAxes,
        fadeTo: fadeColor(s),
        fade: s.gridFade,
    };
    const key = JSON.stringify(options);
    let kept = grids.get(host);
    if (kept?.key !== key) grids.set(host, kept = { key, geometry: gridGeometry3D(options) });
    return kept.geometry;
}

/** The grid fades into the first visible solid fill, so it melts into the background. */
function fadeColor(s: ViewState): Color {
    for (const layer of s.fill as unknown as readonly ({ type?: string; color?: unknown } | null)[]) {
        if (layer?.type !== "solid") continue;
        const color = layer.color;
        if (typeof color === "string") return color;
        if (Array.isArray(color) && (color[3] ?? 1) > 0) return color as Color;
    }
    return s.gridFadeColor;
}

function baseColor(fill: readonly FillResolved[]): Color | undefined {
    for (const layer of fill) {
        if (layer && (layer as { type?: string }).type === "solid") return (layer as unknown as { color: Color }).color;
    }
    return undefined;
}
