import { beforeAll, describe, expect, it } from "vitest";

import { ManifestAssetCatalog } from "@/assets/catalog";
import { AssetDeclaration } from "@/assets/scope";
import { Fills } from "@/attributes/shape/fill/chain";
import { registerCanvas3DResourceLoader } from "@/render3d/resources";
import { Scene3D } from "@/render3d/scene3d";
import { component2d } from "@/components/factory/component2d";
import * as Corners from "@/components/modules/corners";
import * as Flow from "@/components/modules/flow";
import * as Paint from "@/components/modules/paint";
import * as View3D from "@/components/modules/view3d";
import { Graphics3D } from "@/render3d/graphics3d";
import { Tex } from "@/render3d/builders";
import { ContextMap } from "@/util/context";
import type { Node } from "@/components/trees/node/node";
import {
    bindDetached, declareNode, declareTree, forEachOwner,
} from "@/components/trees/node/node-walk";
import { Rect, Ellipse } from "@/components/builtins/geometry/geometry";
import { Text, RichText } from "@/components/builtins/text/text";
import { Canvas3D } from "@/components/builtins/three/canvas3d";
import { Box3D, Plane3D, Model3D, Environment3D, Fog3D, Camera3D, AmbientLight3D, Group3D } from "@/components/builtins/three/three";

/** `declareAssets`, node type by node type. A `Tex.surface` source has to be bound by the declaration itself. */

const image = (src: string) => ({ src, width: 8, height: 8, sizeBytes: 0 });

const catalog = new ManifestAssetCatalog({
    image: Object.fromEntries(
        ["photo.png", "paper.png", "map.png", "grain.png", "stamp.png", "shader.png", "sub.png",
            "wood.png", "normal.png", "crate.png", "plinth.png"].map((src) => [src, image(src)]),
    ),
    video: { "clip.mp4": { src: "clip.mp4", width: 8, height: 8, duration: 10, sizeBytes: 0 } },
    audio: {},
    font: {},
});

const SHADER = "fn fill(in: FillIn) -> vec4f { return sample_texture(in.uv); }";

function mount<T extends Node>(node: T): T {
    node.attach({ assets: catalog, context: ContextMap.EMPTY, time: 0 });
    return node;
}

/** key → asset type. */
function declarations(root: Node): Record<string, string> {
    const scope = new AssetDeclaration(catalog, { bindSubtree: (node) => bindDetached(root, node) });
    declareTree(root, scope);
    return Object.fromEntries([...scope.declarations].map(([key, decl]) => [key, decl.type]));
}

/** A viewport that builds a model into its scene, beside the children it is given. */
const OrbitingGlobe = component2d({
    key: "orbitingGlobe",
    state: { ...Paint.state, ...Flow.state, ...Corners.state, ...View3D.state },
    allowedChildren: ["2d", "3d"],
    load: (loader) => View3D.load(loader),
    children: (state) => [Model3D({ src: "globe.glb" }), ...state.children] as never,
    render: (ctx, state) => View3D.draw(ctx, state),
});

/** A viewport that draws furniture of its own into its scene: `load` takes the `extend` its render draws with. */
const furnish = (scene: Scene3D) => scene.draw(new Graphics3D().box({ width: 1, fill: "plinth.png" }).model({ src: "stand.glb" }));
const FurnishedView = component2d({
    key: "furnishedView",
    state: { ...Paint.state, ...Flow.state, ...Corners.state, ...View3D.state },
    allowedChildren: ["2d", "3d"],
    load: (loader) => View3D.load(loader, furnish),
    render: (ctx, state) => View3D.draw(ctx, state, furnish),
});

const fixtures: Record<string, { build: () => Node; expected: Record<string, string> }> = {
    "Rect: fill, video overlay and shadow": {
        build: () => new Rect({
            fill: Fills.image("photo.png"),
            overlay: Fills.video("clip.mp4", { trimStart: 1 }),
            shadow: { fill: Fills.image("grain.png"), blur: 4 },
        }),
        expected: { "photo.png": "image", "clip.mp4": "video", "grain.png": "image" },
    },
    "Ellipse: image stroke and a shader fill's texture": {
        build: () => new Ellipse({
            stroke: { fill: Fills.image("stamp.png"), weight: 3 },
            fill: Fills.shader(SHADER, { textures: [{ name: "u_tex", src: "shader.png" }] }),
        }),
        expected: { "stamp.png": "image", "shader.png": "image" },
    },
    "Ellipse: a canvas3D fill": {
        build: () => new Ellipse({
            fill: Fills.canvas3D(new Scene3D().draw(new Graphics3D().box({ width: 1, fill: "crate.png" }))),
        }),
        expected: { "crate.png": "image" },
    },
    "Text: a family plus a run's face and paint": {
        build: () => new Text({
            text: "hello world", fontFamily: "Inter", fontWeight: 600,
            runs: [{ start: 6, end: 11, fontFamily: "Georgia", fill: Fills.image("photo.png"), stroke: { fill: Fills.image("sub.png"), weight: 1 } }],
        }),
        expected: { Inter: "font", Georgia: "font", "photo.png": "image", "sub.png": "image" },
    },
    "RichText: every run's face and paint": {
        build: () => new RichText({
            fontFamily: "Inter",
            spans: [
                { text: "a", fontFamily: "Lora", fill: Fills.image("photo.png") },
                { text: "b", stroke: { fill: Fills.image("sub.png"), weight: 2 } },
            ],
        }),
        expected: { Lora: "font", Inter: "font", "photo.png": "image", "sub.png": "image" },
    },
    "Canvas3D: textures, a model, an environment and a surface source": {
        build: () => new Canvas3D({
            fill: Fills.image("photo.png"),
            children: [
                new Camera3D({ orbit: 30 }),
                new AmbientLight3D({ intensity: 0.4 }),
                new Fog3D({ near: 5, far: 30 }),
                new Environment3D({ src: "sky.hdr", faces: ["px.exr"] }),
                new Group3D({
                    children: [
                        new Box3D({ fill: "wood.png", normalMap: "normal.png" }),
                        new Model3D({ src: "robot.glb" }),
                    ],
                }),
                new Plane3D({ fill: Tex.surface(new Text({ text: "HUD", fontFamily: "Mono" }), { width: 256, height: 128 }) }),
                new Text({ text: "FPS", fontFamily: "Inter" }),
            ],
        }),
        expected: {
            "three:runtime": "loader",
            "photo.png": "image",
            "wood.png": "image",
            "normal.png": "image",
            "three:gltf:robot.glb": "loader",
            "three:hdr:sky.hdr": "loader",
            "three:exr:px.exr": "loader",
            Mono: "font",
            Inter: "font",
        },
    },
    "A viewport building a part into its scene: the part's, beside its children's": {
        build: () => new OrbitingGlobe({ children: [new Box3D({ fill: "crate.png" })] }),
        expected: { "three:runtime": "loader", "three:gltf:globe.glb": "loader", "crate.png": "image" },
    },
    "A viewport drawing into its scene itself: what it draws, beside its children's": {
        build: () => new FurnishedView({ children: [new Box3D({ fill: "crate.png" })] }),
        expected: { "three:runtime": "loader", "plinth.png": "image", "three:gltf:stand.glb": "loader", "crate.png": "image" },
    },
};

beforeAll(() => {
    registerCanvas3DResourceLoader(async () => () => { });
});

describe("declareAssets", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
        it(name, () => {
            expect(declarations(mount(fixture.build()))).toEqual(fixture.expected);
        });
    }
});

describe("declareNode", () => {
    it("declares only the node it is given, never its children", () => {
        const root = mount(new Rect({ fill: Fills.image("photo.png"), children: [new Rect({ fill: Fills.image("map.png") })] }));
        const scope = new AssetDeclaration(catalog);
        declareNode(root, scope);
        expect([...scope.declarations.keys()]).toEqual(["photo.png"]);
    });

    it("visits owners with structural paths over every dimension, stopping at unmounted nodes", () => {
        const box = new Box3D();
        const hud = new Text({ text: "x" });
        const root = mount(new Canvas3D({ children: [box, hud] }));
        const loose = new Rect({});
        const paths: [string, string][] = [];
        forEachOwner(root, (node, path) => paths.push([node.className, path]));
        forEachOwner(loose, (node, path) => paths.push([node.className, path]));
        // A component's class is named from its key.
        expect(paths).toEqual([["Canvas3d", ""], ["Box3d", "0"], ["Text", "1"]]);
    });
});
