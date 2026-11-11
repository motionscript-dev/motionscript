/** Asset discovery for 3D scenes: walks a {@link Graphics3D}'s or {@link Scene3D}'s descriptors for referenced resources and declares them into an {@link AssetScope}, so the asset timeline to `AssetManager.loadAt` chain has them resident before the frame renders, which keeps the 3D draw synchronous. It runs off the same descriptors the render consumes (the node builds its `Graphics3D` through one method both paths call), so what loads can't drift from what draws. */

import type { AssetScope } from "@/assets/scope";
import type { LoaderFn } from "@/assets/record";
import type { Graphics3D } from "./graphics3d";
import { Scene3D } from "./scene3d";
import type { Geometry3D } from "./geometry";
import type { EnvironmentData3D } from "./scene-settings";
import { isSurfaceTexture3D, resolveSurfaceSource, texture3DSource } from "./texture";
import {
    canvas3DResourceKey, canvas3DResourceLoader,
    type Canvas3DResourceKind, type Canvas3DResourceLoader,
} from "./resources";
import { forEachTexture3D } from "./walk";

/** Declares every asset a 3D scene or drawable list needs: textures as images, models and environment panoramas through the backend's loader, each `Tex.surface` node source as a subtree of the declaring node. A `Graphics2D` surface source declares nothing. */
export function declare3DResources(g3: Graphics3D | Scene3D, assets: AssetScope): void {
    forEachTexture3D(g3, (value) => {
        if (isSurfaceTexture3D(value)) {
            const source = resolveSurfaceSource(value.source);
            if (source.kind === "node") assets.subtree(source.node);
            return;
        }
        const src = texture3DSource(value);
        if (src !== null) assets.image(src);
    });

    const geometry = (value: Geometry3D | undefined): void => {
        if (value === undefined) return;
        if (value.type === "modelGeometry") {
            declareLoader("gltf", value.src, assets);
        } else if (value.type === "edges" || value.type === "wireframe") {
            geometry(value.source);
        }
    };

    for (const op of g3.ops()) {
        switch (op.kind) {
            case "mesh":
            case "points":
            case "line":
            case "instances":
                geometry(op.geometry);
                break;
            case "model":
                declareLoader("gltf", op.src, assets);
                break;
        }
    }

    if (g3 instanceof Scene3D) declareEnvironment(g3.environmentDescriptor(), assets);
}

/** An environment's panoramas. A `preset` is generated and needs nothing. */
export function declareEnvironment(
    environment: Pick<EnvironmentData3D, "src" | "faces"> | null,
    assets: AssetScope,
): void {
    if (environment === null) return;
    if (environment.src !== undefined) declareLoader(hdrKind(environment.src), environment.src, assets);
    for (const face of environment.faces ?? []) declareLoader(hdrKind(face), face, assets);
}

// Stable per backend loader and key, so declaring a resource again hands the scope
// the same function rather than tripping its conflicting-loader check.
const resourceLoads = new WeakMap<Canvas3DResourceLoader, Map<string, LoaderFn>>();

function declareLoader(kind: Canvas3DResourceKind, src: string, assets: AssetScope): void {
    const load = canvas3DResourceLoader();
    if (!load) return;
    const key = canvas3DResourceKey(kind, src);
    let byKey = resourceLoads.get(load);
    if (!byKey) resourceLoads.set(load, (byKey = new Map()));
    let fn = byKey.get(key);
    if (!fn) byKey.set(key, (fn = () => load(kind, src)));
    assets.loader(key, fn);
}

function hdrKind(src: string): Canvas3DResourceKind {
    const lower = src.toLowerCase();
    if (lower.endsWith(".exr")) return "exr";
    return "hdr";
}
