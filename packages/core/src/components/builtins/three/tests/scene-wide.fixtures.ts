import { component3d } from "@/components/factory/component3d";
import type { NodeOf } from "@/components/factory/api";
import { Types } from "@/components/factory/types";
import { defined, optional, optionalColor, optionalNumber, optionalVector3 } from "@/components/modules/three-entries";
import type { CameraData3D } from "@/render3d/camera";
import type { LightData3D } from "@/render3d/light";
import type { EnvironmentData3D, FogData3D } from "@/render3d/scene-settings";

// Children that set what a `Canvas3D` otherwise owns, through the render context any 3D component has.

export const SceneCamera = component3d({
    key: "sceneCamera",
    state: {
        type: Types.oneOf(["perspective", "orthographic"] as const),
        fov: optionalNumber({}),
        frustumHeight: optionalNumber({}),
        zoom: optionalNumber({}),
        target: optionalVector3("origin"),
    },
    render: (ctx, s) => ctx.camera({ type: s.type, ...defined<object>(s, ["fov", "frustumHeight", "zoom", "target"]) } as CameraData3D),
});
export type SceneCamera = NodeOf<typeof SceneCamera>;

export const SceneLight = component3d({
    key: "sceneLight",
    state: {
        type: Types.oneOf(["ambient", "directional", "point"] as const),
        intensity: optionalNumber({}),
        target: optionalVector3("origin"),
    },
    render: (ctx, s) => ctx.light({ type: s.type, ...defined<object>(s, ["intensity", "target"]) } as LightData3D),
});

export const SceneFog = component3d({
    key: "sceneFog",
    state: { color: optionalColor(), near: optionalNumber({}), far: optionalNumber({}) },
    render: (ctx, s) => ctx.fog(defined<FogData3D>(s, ["color", "near", "far"])),
});

export const SceneEnvironment = component3d({
    key: "sceneEnvironment",
    state: { preset: optional<"studio">(), src: optional<string>(), faces: optional<readonly string[]>() },
    render: (ctx, s) => {
        const environment = defined<EnvironmentData3D>(s, ["preset", "src", "faces"]);
        ctx.environment(Object.keys(environment).length > 0 ? environment : null);
    },
});
