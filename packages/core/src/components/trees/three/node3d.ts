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
    x: number;
    y: number;
    z: number;
    /** Euler rotation in **degrees**, matching 2D `rotation`; ignored when {@link quaternion} is set. */
    rotation: Vector3Input | Euler3;
    /** Rotation about one axis, in **degrees**. Same names as 2D's. */
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    /** The order the Euler axes are applied in. Default `"XYZ"`. */
    rotationOrder: EulerOrder;
    /** Unit quaternion; wins over {@link rotation}. Use it for tumbles where Euler would gimbal. */
    quaternion: Quaternion;
    /** Per-axis scale; a scalar scales uniformly. Default 1. */
    scale: Vector3Input;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    /** World-space point to orient toward, applied after {@link position}; wins over {@link rotation} and {@link quaternion}. */
    lookAt: Vector3Input | undefined;
    /** Hide without removing: the cached renderer object stays alive. */
    visible: boolean;
    /** Shadow participation, default `true` so enabling shadows for the scene is enough. `false` opts out; `"cast"`/`"receive"` for one half. */
    shadow: Shadow3D;
    /** Draw-order override, for tuning transparent sorting. */
    renderOrder: number;
}

/** A 3D parent's own coordinates for where its children sit (graph units, say). Position only, as a 2D `ChildPlane`. Answered by the parent ({@link Node3D._spaceOf}, or `Canvas3D._spaceOf` for the viewport's own children). */
export interface ChildSpace3D {
    /** A child's `x`/`y`/`z` as a point in the parent's local space. */
    toLocal(x: number, y: number, z: number): Vector3;
}

/** A parent that may place its 3D children in coordinates of its own: a `Node3D`, or a 3D viewport. */
interface SpaceHolder3D {
    _spaceOf(child: Node3D | null): ChildSpace3D | null;
}

/** The coordinates `node`'s parent places it by, or `null` when they are the parent's local space. The parent may be a 3D node or the viewport holding it. */
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
 * A thing in 3D space, the root of the 3D scene graph: the sibling of {@link Node2D}, with the same tree,
 * `to()`/`set()`, refs, context and clock inherited from {@link Node}. Only placement and drawing differ: there is no
 * `width`, `padding`, anchor or flex, since a 3D node's whole placement is its transform.
 *
 *   Canvas3D({ children: [Camera3D(...), AmbientLight3D(...), Group3D({ ref: rig, children: [Box3D(...)] })] })
 *   rig().to({ data: { rotationY: 360, y: 1 }, duration: 2 });
 *
 * Axes are scalars and vectors are sugar: `x`/`y`/`z`, `rotationX/Y/Z` and `scaleX/Y/Z` are the real props (named as in
 * 2D) and `position`, `rotation`, `scale` distribute into them, as `Node2D` distributes `size`. That is what makes
 * `to({ y: 3 })` work: a single vector prop would have nothing to interpolate on the other axes.
 *
 * Lives only under a `Canvas3D` (the one node holding both dimensions); a `Rect` parent throws (see
 * {@link Node.acceptsChild}). Every 3D node type is a `component3d` lowering onto this class and drawing from its `render`.
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
        // Distributed before `initProps`, which applies only registered props: a `position` left in the bag would be dropped.
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

    /** Distributes the vector sugar into axis props, then writes as usual (like `Node2D.set`'s `size`): `position` has no slot, so it becomes three writes. An explicit axis in the same call wins, so `{ position: p, y: 0 }` means what it reads like. */
    override set(props: { [K in keyof P]?: P[K] | (() => P[K]) }): void {
        super.set(distributeVectors(props) as typeof props);
    }

    /** The tween half of the same rule: expanded here so `to({ position })` and `to({ x, y, z })` produce identical steppers. */
    override _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        return super._prepareStep(distributeVectors(to) as Partial<P>, duration, easing);
    }

    /** This node's placement in the renderer's vocabulary, sampled fresh each frame from the prop slots. `quaternion` is emitted only when set away from identity: it wins over `rotation` in a {@link Transform3D}, so always sending it would make `rotation` do nothing. */
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

    /** The coordinates `child`'s `x`/`y`/`z` are in, or `null` for this node's local space. A `null` child is one not here yet. */
    /** @internal */
    _spaceOf(_child: Node3D | null): ChildSpace3D | null {
        return null;
    }

    /** The transform on this node's *group* (the scope its children nest in); defaults to its own placement. A camera answers identity and places itself instead: three aims a camera's -Z at `lookAt` but a plain group's +Z, so the group transform would point the shot backwards. */
    protected groupTransform(): Transform3D {
        return this.transform3D();
    }

    /** Draws this node's own contribution (a `ctx.draw(...)` for geometry, `ctx.light(...)` for a light, nothing for a plain {@link Group3D}); children are recorded after it, nested inside its transform. */
    protected renderSelf(ctx: RenderContext3D): void { }

    /** Records this node and its subtree into `ctx`. An invisible node still opens its scope: `visible: false` is a renderer-side flag on a live object, so hiding and showing rebuilds no GPU resources, where skipping the walk would sweep the subtree out of the cache. */
    render(ctx: RenderContext3D): void {
        // The editor's flag folds into `visible` (honoured by the picking walk) rather than adding a second "do not show"
        // flag; the scope still opens, as above.
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

    /** What {@link renderSelf} records, never {@link render}: placement lives on the group scope, so moving a node doesn't change what it declares. */
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

/** Expands `position`/`rotation`/`scale` into axis props; the bag is returned untouched when it names none. A **binding** expands into three bindings each taking one component of the resolved vector, so `position={() => lift()}` stays reactive rather than frozen at bind time. */
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
