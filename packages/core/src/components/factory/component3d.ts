import type { AssetScope } from "@/assets/scope";
import type { Color } from "@/attributes/shape/fill/color/parser";
import { getNodeDescriptor } from "@/document/node-decorator";
import type { Node } from "@/components/trees/node/node";
import { Node3D, type ChildSpace3D } from "@/components/trees/three/node3d";
import type { CameraData3D } from "@/render3d/camera";
import type { Graphics3D } from "@/render3d/graphics3d";
import type { LightData3D } from "@/render3d/light";
import type { RenderContext3D as SceneTarget } from "@/render3d/render-context3d";
import type { EnvironmentData3D, FogData3D } from "@/render3d/scene-settings";
import { declareEnvironment } from "@/render3d/tracking";
import type { Transform3D } from "@/render3d/transform";
import type {
    Allowed, BuiltNode, CallProps3D, ChildView, Clock, Component, Element, Merge, RenderContext3D, Spec3D, StateSpec, Transform3DState,
} from "@/components/factory/api";
import { componentBase, finishComponent, lowering, type CoreSpec } from "@/components/factory/factory";
import { childView, setKeyLookup } from "@/components/factory/views";

setKeyLookup((n) => getNodeDescriptor(n.constructor as new () => object)?.key);

type AnySpec = Spec3D<string, any, any, any, any, any>;

interface Host3D extends Node3D {
    _ownTransform(): Transform3D;
}

/** What a 3D `render` draws into: the scene being built, with a camera placed where its node stands. */
class RenderContext3DImpl implements RenderContext3D {
    target: SceneTarget | null = null;
    /** Set when `render` asks for a camera: such a node is no group, and stands its camera instead. */
    camera3D = false;
    environment3D: EnvironmentData3D | null = null;
    declaring = false;

    constructor(readonly host: Host3D) { }

    get time(): Clock {
        return this.host.time;
    }

    draw(graphics: Graphics3D | null | undefined): void {
        if (graphics) this.target?.draw(graphics);
    }

    light(light: LightData3D, transform?: Transform3D): void {
        this.target?.light(light, transform);
    }

    camera(camera: CameraData3D): void {
        this.camera3D = true;
        this.target?.camera({ ...this.host._ownTransform(), ...camera } as CameraData3D);
    }

    fog(fog: FogData3D | Color | null): void {
        this.target?.fog(fog);
    }

    environment(environment: EnvironmentData3D | null): void {
        this.environment3D = environment;
        this.target?.environment(environment);
    }
}

/**
 * A 3D component: placed by its transform, drawn with `Graphics3D`, lights and
 * cameras. Lowers onto a generated `Node3D` subclass; its children render
 * after it, in its space.
 */
export function component3d<
    const K extends string,
    const S extends StateSpec = {},
    const C = {},
    const A extends Allowed = null,
    const B extends Element = never,
>(spec: Spec3D<K, Merge<Transform3DState, S>, S, C, A, B>): Component<K, Merge<Transform3DState, S>, C, A, Node3D, CallProps3D<Merge<Transform3DState, S>, BuiltNode<Merge<Transform3DState, S>, C, Node3D>>> {
    const s = spec as unknown as AnySpec;
    const l = lowering(s as unknown as CoreSpec, Node3D);

    class Generated extends componentBase(Node3D, l) implements Host3D {
        declare _ctx3d: RenderContext3DImpl;
        declare _isCamera: boolean | undefined;

        constructor(props?: Record<string, unknown>) {
            super(props);
            this._ctx3d = new RenderContext3DImpl(this);
        }

        protected override renderSelf(ctx: SceneTarget): void {
            if (!s.render) return;
            const c = this._ctx3d;
            c.target = ctx;
            try {
                s.render(c, this._view as never);
            } finally {
                c.target = null;
            }
        }

        /** A node that stands a camera places the camera, not a group: its children stay in the parent's space. */
        protected override groupTransform(): Transform3D {
            return this._rendersCamera() ? {} : super.groupTransform();
        }

        _rendersCamera(): boolean {
            if (this._isCamera === undefined) {
                const c = this._ctx3d;
                c.camera3D = false;
                if (s.render) s.render(c, this._view as never);
                this._isCamera = c.camera3D;
            }
            return this._isCamera;
        }

        _ownTransform(): Transform3D {
            return this.transform3D();
        }

        /** What `render` draws loads itself: its textures and models, and an environment map it sets. */
        override declareAssets(assets: AssetScope): void {
            const c = this._ctx3d;
            c.environment3D = null;
            c.declaring = true;
            try {
                super.declareAssets(assets);
            } finally {
                c.declaring = false;
            }
            declareEnvironment(c.environment3D, assets);
        }

        override _commandChildren(): readonly ChildView[] {
            return (this.children as Node[]).filter((c) => c instanceof Node3D).map(childView);
        }
    }

    if (s.space) {
        const space = s.space;
        (Generated.prototype as unknown as { _spaceOf: (child: Node3D | null) => ChildSpace3D | null })._spaceOf = function (this: Generated) {
            return space(this._view as never);
        };
    }

    return finishComponent(Generated, l) as never;
}
