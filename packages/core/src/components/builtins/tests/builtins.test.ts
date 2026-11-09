import { describe, expect, it } from "vitest";
import { ManifestAssetCatalog } from "@/assets/catalog";
import type { AssetManifest } from "@/assets/manifest";
import { Registry } from "@/document/registry";
import type { TimedNodeSpec } from "@/document/types";
import type { Node2D } from "@/components/trees/2d/node2d";
import { attachScope } from "@/components/trees/node/node.fixtures";
import { laidOut, recorded } from "@/components/trees/tests/recording-context.fixtures";
import { FakeMeasureContext } from "@/runtime/runtime.fixtures";
import { comp, node, precompFor, project, track, type Step } from "@/runtime/document.fixtures";
import { nodeBoxAt } from "@/runtime/node-picking";
import { Rect } from "@/components/builtins/geometry/geometry";
import { OrbitCamera } from "@/components/builtins/layout/layout";
import { Text } from "@/components/builtins/text/text";
import { Canvas3D } from "@/components/builtins/three/canvas3d";
import { Box3D, Sphere3D } from "@/components/builtins/three/three";
import * as TextLayout from "@/components/modules/text-layout";

/** What the built-ins tell a host, and the behaviour they gained as components, beyond what the classes did. */

const described = (key: string) => new Registry().describe(key)!;

describe("what the built-ins describe", () => {
    it("lists a boolean's op and a mask's mode and inverted", () => {
        expect(Object.keys(described("boolean").properties!)).toContain("op");
        expect(Object.keys(described("mask").properties!)).toEqual(expect.arrayContaining(["mode", "inverted"]));
    });

    it("gives a camera's lookAt the vector2 kind its command arg had", () => {
        expect(described("camera").properties!.lookAt).toMatchObject({ kind: "vector2" });
        expect(described("orbitCamera").properties!.lookAt).toMatchObject({ kind: "vector2" });
    });

    it("reports an orbit camera's perspective of 1000, which it starts with", () => {
        expect(described("orbitCamera").properties!.perspective).toMatchObject({ default: 1000 });
        expect((new OrbitCamera({}) as Node2D).perspective).toBe(1000);
    });

    it("reports a shadow-casting light's shadow default", () => {
        for (const key of ["directional-light3d", "point-light3d", "spot-light3d"]) {
            expect(described(key).properties!.shadow, key).toMatchObject({ default: false });
        }
    });

    it("gives a sound and a video a play command", () => {
        const registry = new Registry();
        expect(registry.node("sound")!.commands.has("play")).toBe(true);
        expect(registry.node("video")!.commands.has("play")).toBe(true);
    });
});

describe("sound from commands", () => {
    const catalog = () => new ManifestAssetCatalog({
        image: {}, font: {},
        audio: { "vo.mp3": { src: "vo.mp3", duration: 6, sizeBytes: 0 } },
        video: { "clip.mp4": { src: "clip.mp4", duration: 6, width: 640, height: 360, sizeBytes: 0 } },
    } as unknown as AssetManifest);

    const scheduled = (nodes: TimedNodeSpec[], steps: Step[] = []) =>
        precompFor(project([track("a", comp(nodes, steps, 8))]), { registry: new Registry(), assets: catalog() }).run().tracks[0].audioRequests;

    it("plays a sound from a command, cut when the command ends", () => {
        const [req] = scheduled([node("s", "sound", { src: "vo.mp3" })], [2, { type: "play", target: "s", duration: 1.5, args: {} }]);
        expect([req.startAt, req.endAt]).toEqual([2, 3.5]);
    });

    it("plays a sound row with no play command over its span", () => {
        const [req] = scheduled([{ ...node("s", "sound", { src: "vo.mp3" }), startAt: 1, endAt: 4 }]);
        expect(req.startAt).toBe(1);
    });

    it("keeps a paused or muted video silent", () => {
        expect(scheduled([node("v", "video", { src: "clip.mp4", playing: false })])).toEqual([]);
        expect(scheduled([node("v", "video", { src: "clip.mp4", muted: true })])).toEqual([]);
    });
});

describe("text", () => {
    it("hands caret geometry from what it drew, and none before", () => {
        const text = new Text({ id: "t", text: "caret here", wrap: true, width: 160, height: 80, textAlign: "left" } as never) as Node2D;
        text.attach(attachScope());
        text.layout({ x: 0, y: 0, width: 160, height: 80 }, new FakeMeasureContext() as never);
        expect(TextLayout.textStateOf(text)).toBeNull();
        recorded(text);
        expect(TextLayout.textStateOf(text)).not.toBeNull();
    });
});

describe("canvas3d", () => {
    type Ctor = new (props?: Record<string, unknown>) => Node2D;
    const mesh = () => [new (Box3D as unknown as Ctor)({ id: "box", width: 2, fill: "tomato", x: 1 }), new (Sphere3D as unknown as Ctor)({ id: "ball", radius: 0.5, z: -2 })];
    const viewport = () => laidOut(new (Canvas3D as unknown as Ctor)({ id: "view", width: 400, height: 300, children: mesh() }), { x: 0, y: 0, width: 400, height: 300 });

    it("fills the room it is given by default", () => {
        const canvas = new (Canvas3D as unknown as Ctor)({});
        expect([canvas.width, canvas.height]).toEqual(["fill", "fill"]);
    });

    it("paints its scene as a fill layer", () => {
        const fill = recorded(viewport()).graphics[0]?.ops().find((op) => op.kind === "fill") as { fills: { type?: string }[] } | undefined;
        expect(fill?.fills.map((layer) => layer.type)).toContain("canvas3D");
    });

    it("finds a 3D child by path through the viewport", () => {
        expect(nodeBoxAt(viewport(), "0")).not.toBeNull();
    });

    it("takes a 2D child as a HUD", () => {
        const canvas = laidOut(new (Canvas3D as unknown as Ctor)({ id: "view", width: 400, height: 300, children: [Rect({ id: "hud", width: 50, height: 20, fill: "white" } as never)] }));
        expect(canvas.children).toHaveLength(1);
    });
});
