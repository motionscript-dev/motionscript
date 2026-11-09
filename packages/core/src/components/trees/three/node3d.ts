import { declareMembers, property } from "@/attributes/properties/decorator";
import { optionalVector3Property, quaternionProperty } from "@/attributes/properties/typed";
import {
    resolveVector3,
    type Euler3, type EulerOrder, type Quaternion, type Vector3, type Vector3Input,
} from "@/render3d/vector3";
import type { RenderContext3D } from "@/render3d/render-context3d";
import { Scene3D } from "@/render3d/scene3d";
import { declare3DResources } from "@/render3d/tracking";
import type { AssetScope } from "@/assets/scope";
import type { Shadow3D, Transform3D } from "@/render3d/transform";
import { Node, type NodeConfig, type NodeDimension, type NodeProps } from "@/components/trees/node/node";
import type { Command, CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";
import type { EasingFunction } from "@/tween/ease/type";
import type { TweenStepper } from "@/tween/stepper";

export interface Node3DProps extends NodeProps {
    /** Position in the parent's local space. A scalar sets all three axes. */
    position: Vector3Input;
    /** Position on one axis. The same names 2D uses, one dimension over. */
    x: number;
    y: number;
    z: number;
    /**
     * Euler rotation in **degrees**, matching 2D `rotation`. Ignored when
     * {@link quaternion} is set.
     */
    rotation: Vector3Input | Euler3;
    /** Rotation about one axis, in **degrees**. Same names as 2D's. */
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    /** The order the Euler axes are applied in. Default `"XYZ"`. */
    rotationOrder: EulerOrder;
    /**
     * Rotation as a unit quaternion. Wins over {@link rotation} — use it for
     * tumbles where Euler interpolation would gimbal.
     */
    quaternion: Quaternion;
    /** Per-axis scale; a scalar scales uniformly. Default 1. */
    scale: Vector3Input;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    /**
     * World-space point to orient toward, applied after {@link position}. Wins
     * over both {@link rotation} and {@link quaternion}.
     */
    lookAt: Vector3Input | undefined;
    /** Hide without removing — the cached renderer object stays alive. */
    visible: boolean;
    /**
     * Shadow participation. Default `true`, so turning shadows on for the scene
     * turns them on. Pass `false` to opt out, or `"cast"`/`"receive"` for one half.
     */
    shadow: Shadow3D;
    /** Draw-order override, for tuning transparent sorting. */
    renderOrder: number;
}

/**
 * A 3D parent's own coordinates for where its children sit: the units of a
 * graph, say. Position only, as a `ChildPlane` is in 2D: a child keeps its
 * size, turn and scale. Answered by the parent ({@link Node3D._spaceOf}, or
 * `Canvas3D._spaceOf` for a child of the viewport itself).
 */
export interface ChildSpace3D {
    /** A child's `x`/`y`/`z` as a point in the parent's local space. */
    toLocal(x: number, y: number, z: number): Vector3;
}

/** A parent that may place its 3D children in coordinates of its own: a `Node3D`, or a 3D viewport. */
interface SpaceHolder3D {
    _spaceOf(child: Node3D | null): ChildSpace3D | null;
}

/**
 * The coordinates `node`'s parent places it by, or `null` when they are the
 * parent's local space. The parent may be a 3D node or the viewport holding it.
 */
/** @internal */
export function parentSpaceOf(node: Node3D): ChildSpace3D | null {
    const parent = node.parent as Partial<SpaceHolder3D> | null;
    return typeof parent?._spaceOf === "function" ? parent._spaceOf(node) : null;
}

/** The three axis props each vector prop distributes into, in order. */
const VECTOR_SUGAR: Readonly<Record<string, readonly [string, string, string]>> = {
    position: ["x", "y", "z"],
    rotation: ["rotationX", "rotationY", "rotationZ"],
    scale: ["scaleX", "scaleY", "scaleZ"],
};

/**
 * A thing in 3D space — the root of the 3D scene graph.
 *
 * The sibling of {@link Node2D}: same tree, same props, same `to()`/`set()`/
 * `save()`/`restore()`, same refs, context and per-node clock, all inherited from
 * {@link Node}. What differs is the only thing that genuinely differs between the
 * two — how a node is placed and how it draws. There is no `width`, no `padding`,
 * no anchor and no flex here, because none of them mean anything for a mesh; a 3D
 * node's whole placement is its transform.
 *
 *   Canvas3D({
 *       children: [
 *           Camera3D({ orbit: 30, elevation: 18, distance: 6 }),
 *           AmbientLight3D({ intensity: 0.4 }),
 *           Group3D({ ref: rig, children: [Box3D({ width: 2, cornerRadius: 0.15, fill: "tomato" })] }),
 *       ],
 *   })
 *
 *   rig().to({ data: { rotationY: 360, y: 1 }, duration: 2 });
 *
 * ── Axes are scalars, and vectors are sugar over them ─────────────────────────
 * `x`, `y`, `z`, `rotationX/Y/Z` and `scaleX/Y/Z` are the real props, and they
 * are named exactly what 2D names them. `position`, `rotation` and `scale` are
 * distributed into those three, the way `Node2D` already distributes `size` into
 * `width`/`height` — so both spellings tween identically and there is one source
 * of truth for where a node is. That is what makes `to({ y: 3 })` work: with a
 * single vector prop it would have had nothing to interpolate on the other two
 * axes, which is exactly the trap that made every 3D scene restate coordinates it
 * did not mean to change.
 *
 * A `Node3D` only ever lives under a `Canvas3D` — the one node that holds both
 * dimensions. Parenting one to a `Rect` throws rather than silently drawing
 * nothing (see {@link Node.acceptsChild}). Every 3D node type is a
 * `component3d`, which lowers onto this class and draws from its `render`.
 */
export class Node3D<P extends Node3DProps = Node3DProps> extends Node<P> {
    get dimension(): NodeDimension { return "3d"; }

    declare x: number;
    declare y: number;
    declare z: number;

    declare rotationX: number;
    declare rotationY: number;
    declare rotationZ: number;
    declare rotationOrder: EulerOrder;

    declare quaternion: Quaternion;

    declare scaleX: number;
    declare scaleY: number;
    declare scaleZ: number;

    declare lookAt: Vector3Input | undefined;
    declare visible: boolean;
    declare shadow: Shadow3D;
    declare renderOrder: number;

    constructor(props?: NodeConfig<any, P>) {
        super(props);
        // Distributed before `initProps`, which only ever applies keys that are
        // registered props — a `position` left in the bag would be dropped.
        this.initProps(distributeVectors(props) as NodeConfig<any, P>);
        this.adoptChildrenProp(props);
    }

    /** Animate the position, whichever axes are given; the rest stay where they are. */
    moveTo(args: CommandArgs<{ x?: number; y?: number; z?: number }> & { duration: number }): Command<P> {
        return this.to({ data: stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** Animate the Euler rotation, in degrees, whichever axes are given. */
    rotateTo(
        args: CommandArgs<{ rotationX?: number; rotationY?: number; rotationZ?: number }> & { duration: number },
    ): Command<P> {
        return this.to({ data: stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** Animate the scale: `scale` on every axis, and any axis given beside it on that one. */
    scaleTo(
        args: CommandArgs<{ scale?: number; scaleX?: number; scaleY?: number; scaleZ?: number }> & { duration: number },
    ): Command<P> {
        return this.to({ data: stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** This node's position, composed from the axis props. */
    get position(): Vector3 {
        return { x: this.x, y: this.y, z: this.z };
    }
    set position(value: Vector3Input) {
        this.set({ position: value } as never);
    }

    /** This node's Euler rotation in degrees, composed from the axis props. */
    get rotation(): Euler3 {
        return { x: this.rotationX, y: this.rotationY, z: this.rotationZ, order: this.rotationOrder };
    }
    set rotation(value: Vector3Input | Euler3) {
        this.set({ rotation: value } as never);
    }

    /** This node's scale, composed from the axis props. */
    get scale(): Vector3 {
        return { x: this.scaleX, y: this.scaleY, z: this.scaleZ };
    }
    set scale(value: Vector3Input) {
        this.set({ scale: value } as never);
    }

    /**
     * Distribute the vector sugar into axis props, then write as usual.
     *
     * Same shape as `Node2D.set`'s handling of `size`, and for the same reason:
     * `position` has no slot of its own, so it has to become three writes
     * before the generic loop runs. An explicitly stated axis in the same call
     * wins over the vector, which is what lets `{ position: p, y: 0 }` mean what
     * it reads like.
     */
    override set(props: { [K in keyof P]?: P[K] | (() => P[K]) }): void {
        super.set(distributeVectors(props) as typeof props);
    }

    /**
     * The tween half of the same rule. Expanded here rather than in the command
     * so `to({ position: [...] })` and `to({ x, y, z })` produce identical
     * steppers — one interpolating path, whichever way it was written.
     */
    override _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        return super._prepareStep(distributeVectors(to) as Partial<P>, duration, easing);
    }

    /**
     * This node's placement, as the renderer's own vocabulary.
     *
     * Sampled fresh every frame from the prop slots, so a tween moves the object
     * without anything here caching state between frames.
     *
     * `quaternion` is only emitted when it has been set away from identity: it
     * wins over `rotation` in a {@link Transform3D}, so always sending it would
     * make `rotation` silently do nothing.
     */
    protected transform3D(): Transform3D {
        const quaternion = this.quaternion as unknown as Quaternion;
        const identityQuaternion =
            quaternion.x === 0 && quaternion.y === 0 && quaternion.z === 0 && quaternion.w === 1;
        const space = parentSpaceOf(this);
        return {
            position: space ? space.toLocal(this.x, this.y, this.z) : this.position,
            rotation: this.rotation,
            quaternion: identityQuaternion ? undefined : quaternion,
            scale: this.scale,
            lookAt: this.lookAt,
            visible: this.visible,
            shadow: this.shadow,
            renderOrder: this.renderOrder,
        };
    }

    /**
     * The coordinates `child`'s `x`/`y`/`z` are in, or `null` (the default) when
     * they are this node's local space. A `null` child is one not here yet.
     */
    /** @internal */
    _spaceOf(_child: Node3D | null): ChildSpace3D | null {
        return null;
    }

    /**
     * The transform that goes on this node's *group* — the scope its children
     * nest inside. Defaults to this node's own placement, which is right for
     * everything that lives at its own origin.
     *
     * A camera answers identity and places itself instead: three aims a
     * camera's -Z at `lookAt` but a plain group's +Z, so hanging a camera's
     * placement on its group would point the shot backwards.
     */
    protected groupTransform(): Transform3D {
        return this.transform3D();
    }

    /**
     * Draw this node's own contribution to the scene — a `ctx.draw(graphics3D)`
     * for something with geometry, a `ctx.light(...)` for a light, nothing at all
     * for a plain {@link Group3D}. Children are recorded after it, nested inside
     * this node's transform.
     */
    protected renderSelf(ctx: RenderContext3D): void { }

    /**
     * Record this node and its subtree into `ctx`.
     *
     * An invisible node still opens its scope: `visible: false` is a renderer-side
     * flag on a live object rather than a removal, which is what lets a node be
     * hidden and shown again without its GPU resources being rebuilt. Skipping the
     * walk here would instead sweep the whole subtree out of the cache.
     */
    render(ctx: RenderContext3D): void {
        // The editor's flag folds into `visible` rather than adding a second one:
        // the 3D side already has exactly this concept, honoured by the picking
        // walk, and two flags meaning "do not show this" would be two places to
        // ask. Still opens its scope — see the note above on why an invisible
        // node keeps its cached renderer object.
        if (this.hidden) {
            ctx.begin({ id: this.id, transform: { ...this.groupTransform(), visible: false } });
            ctx.end();
            return;
        }
        ctx.begin({ id: this.id, transform: this.groupTransform() });
        this.renderSelf(ctx);
        for (const child of this._children) {
            if (child instanceof Node3D) child.render(ctx);
        }
        ctx.end();
    }

    /**
     * What {@link renderSelf} records, never {@link render}: the placement lives on
     * the group scope, so moving a node does not change what it declares.
     */
    declareAssets(assets: AssetScope): void {
        if (this.renderSelf === Node3D.prototype.renderSelf) return;
        const scene = new Scene3D();
        this.renderSelf(scene);
        declare3DResources(scene, assets);
    }
}

declareMembers(Node3D, {
    x: property({ default: 0 }),
    y: property({ default: 0 }),
    z: property({ default: 0 }),
    rotationX: property({ default: 0 }),
    rotationY: property({ default: 0 }),
    rotationZ: property({ default: 0 }),
    rotationOrder: property({ default: "XYZ" }),
    quaternion: quaternionProperty(),
    scaleX: property({ default: 1 }),
    scaleY: property({ default: 1 }),
    scaleZ: property({ default: 1 }),
    lookAt: optionalVector3Property("snap"),
    visible: property({ default: true }),
    shadow: property({ default: true }),
    renderOrder: property({ default: 0 }),

    moveTo: command({ args: ["x", "y", "z"] }),
    rotateTo: command({ args: ["rotationX", "rotationY", "rotationZ"] }),
    scaleTo: command({
        args: [{ key: "scale", kind: "number", min: 0, step: 0.05, unit: "×" }, "scaleX", "scaleY", "scaleZ"],
    }),
});

/**
 * Expand `position`/`rotation`/`scale` in a prop bag into their axis props.
 *
 * Returns the bag untouched when it names none of them, so the common write path
 * allocates nothing. A **binding** expands into three bindings that each resolve
 * the vector and take one component — so `position={() => lift()}` stays a
 * binding, and one thunk driving all three axes is still read once per axis per
 * frame rather than being frozen at bind time.
 */
function distributeVectors<T extends object>(props: T | undefined): T | undefined {
    if (!props) return props;

    let out: Record<string, unknown> | undefined;

    for (const key in VECTOR_SUGAR) {
        const value = (props as Record<string, unknown>)[key];
        if (value === undefined) continue;

        out ??= { ...(props as Record<string, unknown>) };
        delete out[key];

        const axes = VECTOR_SUGAR[key];

        if (typeof value === "function") {
            const read = value as () => Vector3Input;
            for (let i = 0; i < 3; i++) {
                const axis = axes[i];
                if (out[axis] !== undefined) continue;
                out[axis] = () => componentOf(resolveVector3(read()), i);
            }
            continue;
        }

        const vector = resolveVector3(value as Vector3Input);
        for (let i = 0; i < 3; i++) {
            const axis = axes[i];
            if (out[axis] === undefined) out[axis] = componentOf(vector, i);
        }

        // `order` rides on an Euler and has nowhere else to go.
        if (key === "rotation") {
            const order = (value as Euler3).order;
            if (order !== undefined && out.rotationOrder === undefined) out.rotationOrder = order;
        }
    }

    return (out as T) ?? props;
}

/** `data` without the keys left unstated, so a tween never aims an axis at `undefined`. */
function stated<T extends object>(data: T | undefined): Partial<T> {
    const out: Partial<T> = {};
    for (const key in data) if (data[key] !== undefined) out[key] = data[key];
    return out;
}

function componentOf(vector: Vector3, index: number): number {
    return index === 0 ? vector.x : index === 1 ? vector.y : vector.z;
}
