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

/**
 * One recorded operation in a {@link Scene3D}.
 *
 * A superset of {@link Graphics3DOp}: everything a node draws, plus the four
 * things that describe the scene around it — the `push`/`pop` nesting the node
 * tree produces, the lights in it, and where it is viewed from.
 */
export type Scene3DOp =
    | { kind: "push"; transform?: Transform3D }
    | { kind: "pop" }
    | { kind: "light"; light: LightData3D; transform?: Transform3D }
    | { kind: "camera"; camera: CameraData3D }
    | Graphics3DOp;

/**
 * A recorded 3D scene — and the {@link RenderContext3D} that records it.
 *
 * One value plays both parts, exactly as `Graphics2D` is both the builder and the
 * thing handed to a backend. A `Node3D` tree draws into it, and the result is a
 * flat op list plus a handful of scene-wide settings that a renderer replays.
 *
 * Almost always produced for you: a `Canvas3D` opens one per frame, walks its
 * `Node3D` children through it and paints the result through its own path. The
 * builder surface below is the escape hatch — it is what lets a scene be shaded
 * through *any* 2D shape rather than only a rect:
 *
 *   const scene = new Scene3D()
 *       .perspective({ orbit: 30, elevation: 20, distance: 6 })
 *       .light({ type: "ambient", intensity: 0.4 })
 *       .draw(new Graphics3D().box({ width: 2, fill: "tomato" }));
 *
 *   Text({ text: "DEPTH", fontSize: 320, fill: scene })
 *
 * A bare `Scene3D` coerces to a `canvas3D` fill the way a bare CSS string coerces
 * to a solid one, so `fill={scene}` and `fill={["#0b0d12", scene]}` both work.
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
    /**
     * The `shadow` of each open node scope, innermost last (`undefined` for a
     * scope that states none). What a drawable that states none of its own takes.
     */
    private _shadowScopes: (Shadow3D | undefined)[] = [];

    // ─── Node scopes ─────────────────────────────────────────────────────────

    override begin(state: Node3DRenderState): void {
        // The node's id rides on the transform's `key`, which is the renderer's
        // identity slot — so a group is cached against the node that opened it
        // rather than against its index among its siblings.
        this._ops.push({ kind: "push", transform: { ...state.transform, key: state.id } });
        this._shadowScopes.push(state.transform?.shadow);
        this._depth++;
    }

    override end(): void {
        this._ops.push({ kind: "pop" });
        this._shadowScopes.pop();
        this._depth--;
    }

    // ─── Drawables ───────────────────────────────────────────────────────────

    /**
     * Splice what a node draws into the scene at the current scope.
     *
     * The ops are copied rather than referenced: a `Graphics3D` is rebuilt every
     * frame, so there is nothing to share, and a flat list is what the renderer
     * walks.
     *
     * A drawable that states no `shadow` of its own takes the one of the node
     * scope it is drawn in. That is what carries a node's `shadow` to its mesh: the
     * node's scope becomes a group, and a renderer reads casting and receiving off
     * the mesh, never off a group, so the scope's value would otherwise never be
     * seen. A `shadow` on the op itself wins.
     */
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

    // ─── Lights ──────────────────────────────────────────────────────────────

    override light(light: LightData3D, transform?: Transform3D): this {
        this._ops.push({ kind: "light", light, transform });
        return this;
    }

    // ─── Camera ──────────────────────────────────────────────────────────────

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

    // ─── Scene settings ──────────────────────────────────────────────────────
    //
    // Fields rather than ops: a scene has exactly one fog and one environment.
    // Recording them positionally would imply an ordering that doesn't exist.
    // Last writer wins.

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

    // ─── Consumption ─────────────────────────────────────────────────────────

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

    /**
     * True when nothing would be drawn — no mesh, light or other drawable. The
     * node skips the whole 3D pass (and the WebGL context entirely) in that case.
     */
    isEmpty(): boolean {
        return !this._ops.some((op) => DRAWABLE_KINDS.has(op.kind));
    }

    /**
     * Throw if `push` and `pop` are unbalanced. Called once by the consumer before
     * replay, so a mismatched scope fails loudly rather than silently reparenting
     * everything after it.
     *
     * A `Node3D` tree cannot get this wrong — `begin`/`end` are bracketed by the
     * walk — so in practice this catches a hand-built scene.
     */
    assertBalanced(): void {
        if (this._depth !== 0) {
            const verb = this._depth > 0 ? "unclosed begin()" : "extra end()";
            throw new Error(
                `Scene3D has ${Math.abs(this._depth)} ${verb}.`,
            );
        }
    }
}
