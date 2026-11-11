import { DRAWABLE_KINDS, Graphics3D, type Graphics3DOp } from "./graphics3d";
import { RenderContext3D, type Node3DRenderState } from "./render-context3d";
import type { CameraData3D, OrthographicCameraData3D, PerspectiveCameraData3D } from "./camera";
import type { LightData3D } from "./light";
import {
    resolveShadows3D,
    type EnvironmentData3D, type FogData3D, type PostEffect3D,
    type ShadowSettings3D, type Shadows3D, type ToneSettings3D,
} from "./scene-settings";
import { warnInert3D } from "./inert";
import type { Shadow3D, Transform3D } from "./transform";
import type { Color } from "@/attributes/shape/fill/color/parser";

/** Options accepted by every `Camera3D` node and by {@link Scene3D.perspective}. */
type ParamsOf<T extends { type: string }> = Omit<T, "type">;

/** One recorded operation: everything a node draws ({@link Graphics3DOp}) plus `push`/`pop` nesting, lights and the camera. */
export type Scene3DOp =
    | { kind: "push"; transform?: Transform3D }
    | { kind: "pop" }
    | { kind: "light"; light: LightData3D; transform?: Transform3D }
    | { kind: "camera"; camera: CameraData3D }
    | Graphics3DOp;

/**
 * A recorded 3D scene and the {@link RenderContext3D} that records it (as `Graphics2D` is both builder and thing
 * handed to a backend): a `Node3D` tree draws into it, yielding a flat op list plus scene-wide settings that a
 * renderer replays. A `Canvas3D` normally opens one per frame; building one by hand lets a scene be shaded
 * through any 2D shape:
 *
 *   const scene = new Scene3D().perspective({ distance: 6 }).draw(new Graphics3D().box({ fill: "tomato" }));
 *   Text({ text: "DEPTH", fontSize: 320, fill: scene })
 *
 * A bare `Scene3D` coerces to a `canvas3D` fill, so `fill={scene}` and `fill={["#0b0d12", scene]}` both work.
 */
export class Scene3D extends RenderContext3D {
    private _ops: Scene3DOp[] = [];
    private _camera: CameraData3D | null = null;
    private _fog: FogData3D | null = null;
    private _environment: EnvironmentData3D | null = null;
    private _shadows: ShadowSettings3D | null = null;
    private _tone: ToneSettings3D | null = null;
    private _post: PostEffect3D[] = [];
    /** Open `push` count, so {@link assertBalanced} can report a leak. */
    private _depth = 0;
    /** The `shadow` of each open node scope, innermost last; what a drawable stating none of its own takes. */
    private _shadowScopes: (Shadow3D | undefined)[] = [];

    override begin(state: Node3DRenderState): void {
        // The node's id rides on the transform's `key` (the renderer's identity slot), so a group is cached against the node that opened it, not its index among siblings.
        this._ops.push({ kind: "push", transform: { ...state.transform, key: state.id } });
        this._shadowScopes.push(state.transform?.shadow);
        this._depth++;
    }

    override end(): void {
        this._ops.push({ kind: "pop" });
        this._shadowScopes.pop();
        this._depth--;
    }

    /** Splices what a node draws into the scene at the current scope. Ops are copied: a `Graphics3D` is rebuilt every frame and the renderer walks a flat list. A drawable stating no `shadow` takes its node scope's, since a renderer reads casting/receiving off the mesh, never a group; a `shadow` on the op wins. */
    override draw(graphics: Graphics3D): this {
        const ops = graphics.ops();
        const scope = this._shadowScopes[this._shadowScopes.length - 1];
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            if (scope === undefined || op.transform?.shadow !== undefined) {
                this._ops.push(op);
            } else {
                this._ops.push({ ...op, transform: { ...op.transform, shadow: scope } });
            }
        }
        return this;
    }

    override light(light: LightData3D, transform?: Transform3D): this {
        this._ops.push({ kind: "light", light, transform });
        return this;
    }

    override camera(camera: CameraData3D): this {
        this._camera = camera;
        this._ops.push({ kind: "camera", camera });
        return this;
    }

    /** Set a perspective camera. The usual choice. */
    perspective(options?: ParamsOf<PerspectiveCameraData3D>): this {
        return this.camera({ type: "perspective", ...options } as PerspectiveCameraData3D);
    }

    /** Set an orthographic camera — parallel projection, for isometric looks. */
    orthographic(options?: ParamsOf<OrthographicCameraData3D>): this {
        return this.camera({ type: "orthographic", ...options } as OrthographicCameraData3D);
    }

    // Fields, not ops: a scene has one fog and one environment, and recording them positionally would imply an ordering that doesn't exist. Last writer wins.

    override fog(fog: FogData3D | Color | null): this {
        if (fog === null) {
            this._fog = null;
        } else if (typeof fog === "object" && !Array.isArray(fog)) {
            this._fog = fog as FogData3D;
        } else {
            this._fog = { color: fog as Color };
        }
        return this;
    }

    override environment(environment: EnvironmentData3D | null): this {
        if (environment) {
            if (environment.src !== undefined || (environment.faces?.length ?? 0) > 0) {
                warnInert3D(
                    "environment-src",
                    "An environment's `src` and `faces` (HDR, EXR, cubemap) are recorded, and no backend loads them. Only `preset: \"studio\"` is rendered: "
                    + "without a preset the scene gets no image-based light and its `background` is not drawn.",
                );
            }
            if (environment.params && Object.keys(environment.params).length > 0) {
                warnInert3D(
                    "environment-params",
                    "`params` on an environment is not applied: nothing assigns it onto the generated environment.",
                );
            }
        }
        this._environment = environment;
        return this;
    }

    override shadows(settings?: Shadows3D): this {
        this._shadows = resolveShadows3D(settings ?? true);
        return this;
    }

    override tone(settings: ToneSettings3D): this {
        this._tone = settings;
        return this;
    }

    override post(effects: PostEffect3D | readonly PostEffect3D[]): this {
        const added = Array.isArray(effects) ? (effects as PostEffect3D[]) : [effects as PostEffect3D];
        if (added.length > 0) {
            warnInert3D(
                "post",
                `Post-processing (${added.map((effect) => `"${effect.type}"`).join(", ")}) is recorded, and no backend applies a pass: the scene renders exactly as it would without \`post\`. `
                + "Use the Canvas3D's 2D `effects` over the composited result instead.",
            );
        }
        this._post.push(...added);
        return this;
    }

    /** The recorded ops, in order. Replayed by the renderer. */
    ops(): readonly Scene3DOp[] {
        return this._ops;
    }

    /** The camera, or `null` to let the renderer supply a default framing. */
    cameraDescriptor(): CameraData3D | null {
        return this._camera;
    }
    fogDescriptor(): FogData3D | null {
        return this._fog;
    }
    environmentDescriptor(): EnvironmentData3D | null {
        return this._environment;
    }
    shadowSettings(): ShadowSettings3D | null {
        return this._shadows;
    }
    toneSettings(): ToneSettings3D | null {
        return this._tone;
    }
    postEffects(): readonly PostEffect3D[] {
        return this._post;
    }

    /** True when nothing would be drawn (no mesh, light or other drawable); the node then skips the whole 3D pass. */
    isEmpty(): boolean {
        return !this._ops.some((op) => DRAWABLE_KINDS.has(op.kind));
    }

    /** Throws if `push` and `pop` are unbalanced, so a mismatched scope fails loudly rather than silently reparenting everything after it. A `Node3D` walk brackets `begin`/`end` itself, so this catches hand-built scenes. */
    assertBalanced(): void {
        if (this._depth !== 0) {
            const verb = this._depth > 0 ? "unclosed begin()" : "extra end()";
            throw new Error(
                `Scene3D has ${Math.abs(this._depth)} ${verb}.`,
            );
        }
    }
}
