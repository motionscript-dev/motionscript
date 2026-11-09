import { _observer, PropSlot } from "@/props/slot";
import { LAYOUT_SLOT } from "@/props/observer";
import { EasingFunction } from "@/tween/ease/type";
import { type Command, type CommandArgs } from "@/tween/command";
import { TweenStepper } from "@/tween/stepper";
import type { AssetScope } from "@/assets/scope";
import { AssetNotLoadedError } from "@/assets/errors";
import { declareMembers, property } from "@/attributes/properties/decorator";
import { effectsProperty, insetsProperty, alignmentProperty } from "@/attributes/properties/typed";
import { createMotionHistory, MotionHistory, sampleMotion, primeMotion } from "./node-motion";
import { addChildAtAnimated, removeChildAtAnimated, reparentAnimated } from "./node-lifecycle";

import type { NodeEffect } from "@/attributes/shape/effects/union";
import type { NodeBlendMode } from "@/attributes/shape/fill/blend";
import { BoxBounds } from "@/layout/bounds";
import { Vector2 } from "@/attributes/layout/vector2";
import { Alignment, alignmentOps } from "@/attributes/layout/alignment";
import type { WorldTransform } from "@/attributes/layout/world-transform";
import { Node, type NodeConfig, type NodeDimension, type NodeProps } from "@/components/trees/node/node";
import {
    applyToPoint,
    facesAway,
    hasProjection3D,
    invert,
    Matrix2D,
    multiply,
    type Projection3D,
} from "@/attributes/layout/matrix2d";
import { expandTransform3D, type NodeTransform3D } from "@/attributes/layout/transform3d";
import { multiplyAffine3, nodeSpaceMatrix, type Affine3, type SpaceCamera } from "@/attributes/layout/space3d";
import { localMatrix, rotateOffset, worldAnchors } from "./node-transform";
import { spaceChildFrame, spaceChildOrder, spaceRootFrame, type SpaceFrame } from "./node-space";
import {
    applyBackdropEffects as applyBackdropEffectsImpl,
    applyContentEffectScope,
    computeSpaceRects,
} from "./node-render";
import { SizeConstraints } from "@/layout/constraints";
import { NodeRenderState, RenderContext2D, RenderPass2D, SpaceRects } from "@/render/render-context2d";
import { Clip } from "@/render/clip";
import { TransformState } from "@/render/descriptors/transform";
import { command } from "@/tween/command-decorator";
import { PathBuilder } from "@/render/descriptors/path-builder";
import type { PathData } from "@/render/descriptors/path";
import { pathOps } from "@/attributes/shape/path/ops";
import { Size2D, SizeInput, size2DOps, sizeInputOps } from "@/attributes/layout/size";
import { Effect } from "@/attributes/shape/effects/chain";
import { Insets, InsetsResolved, insetsOps } from "@/attributes/layout/insets";
import { lerpPerspective } from "@/tween/lerp";
import { MeasureContext2D } from "@/render/measure-context";
import { flowOps } from "@/layout/ops";
import type { FlowMeasure, FlowSettings } from "@/layout/types";

/**
 * Stand-in for a node's reference rects when the context never reads them.
 * Shared and empty — `computeSpaceRects` returns the same shape for a node with
 * no parent, so consumers already handle it.
 */
const NO_SPACE_RECTS: SpaceRects = {};

/** The node centre in the normalised `[-1, 1]` alignment space — `pivot`'s own default. */
const ORIGIN_2D: Vector2 = { x: 0, y: 0 };

/**
 * Where a parent puts a child beyond the box it laid it out in: the turn, size,
 * tilt, depth and fade of a slot in an arrangement — a ring of cards, tiles on a
 * sphere. Applied about the box's centre and *before* the child's own
 * transform, so the child's `x`/`y`/`rotation`/`scale`, and every command on
 * them, keep working relative to the slot.
 *
 * Answered by the parent ({@link Node2D._placementOf}) rather than written onto
 * the child, so a child moved to another parent cannot carry a stale slot, and
 * read by the renderer, picking and `global` alike, so a selection box lands on
 * the pixels.
 */
export interface ChildPlacement {
    /** In-plane turn, degrees clockwise. */
    readonly rotation: number;
    readonly scale: number;
    /** Tilt, degrees — as the child's own `rotationX`/`rotationY`. */
    readonly rotationX: number;
    readonly rotationY: number;
    /** Push toward the viewer, px. Only a space gives it perspective. */
    readonly depth: number;
    /** Multiplies the child's own opacity. */
    readonly opacity: number;
}

/**
 * A parent's own coordinates for where its children sit — the units of a graph,
 * say. Position only: a child keeps its size, turn and scale, so a label on a
 * plot follows the plot's range without being stretched by it.
 *
 * Answered by the parent ({@link Node2D._planeOf}) for the reasons a slot is,
 * and read by the renderer, picking, `global` and `moveTo({ target })` alike.
 */
export interface ChildPlane {
    /** A child's `x`/`y` as a pixel offset, y-up, from the centre of its layout box. */
    toOffset(x: number, y: number): Vector2;
    /** The inverse: the `x`/`y` that put a child at that offset. */
    toCoords(x: number, y: number): Vector2;
}

/**
 * A point of a node an editor can drag to set one of its `Vector2` props: the
 * two ends of an arrow. `at` is in the node's own frame, y-up from its origin,
 * the frame {@link Node2D._localBounds} is in.
 */
export interface NodeHandle {
    readonly prop: string;
    readonly at: Vector2;
}

const NO_HANDLES: readonly NodeHandle[] = [];

// Filled per call and read synchronously by the matrix builders, like `_projectionScratch`.
const SLOT_PROJECTION: Projection3D = {
    rotationX: 0, rotationY: 0, rotationZ: 0, depth: 0, perspective: 0,
    flipHorizontal: false, flipVertical: false,
};

function slotProjection(placement: ChildPlacement): Projection3D {
    SLOT_PROJECTION.rotationX = placement.rotationX;
    SLOT_PROJECTION.rotationY = placement.rotationY;
    SLOT_PROJECTION.depth = placement.depth;
    return SLOT_PROJECTION;
}

/** No settings: centred freeform, which is how a plain node arranges its children. */
const DEFAULT_FLOW: FlowSettings = Object.freeze({});

/** Where a node last placed its children, and by what flow: see {@link Node2D._childSpace}. */
export interface ChildSpace {
    readonly settings: FlowSettings;
    readonly inner: BoxBounds;
}

const NO_CONTENT: Size2D = { width: 0, height: 0 };

// WorldTransform, PropInput, and PropInputs now live in dedicated
// modules (see imports above) and are re-exported below so existing
// `from ".../node2d"` imports keep resolving.
export { Node } from "@/components/trees/node/node";
export type { NodeChildren, NodeConfig, NodeMetadata, NodeDimension, NodeProps } from "@/components/trees/node/node";
export type { WorldTransform } from "@/attributes/layout/world-transform";
export type { PropInput, PropInputs } from "@/attributes/properties/inputs";

/**
 * The camera props a node pushes around its children — the three inputs
 * `RenderContext2D.beginCamera` takes beyond the viewport rect. See
 * {@link Node2D._cameraScope}.
 */
/** @internal */
export interface CameraScope {
    /** World point (y-up) the viewport centres on — what the camera is aimed at. */
    lookAt: Vector2;
    /** Uniform zoom factor. */
    zoom: number;
    /** Viewport rotation in degrees; the renderer applies it as `rotate(-heading)`. */
    heading: number;
}

export interface Node2DProps extends NodeProps {
    x: number; // 0 is center, negative is left, positive is right
    y: number; // 0 is center, negative is down, positive is up
    width: SizeInput;
    height: SizeInput;
    /**
     * Per-child weight for the gap this node contributes to its parent's flex
     * run, `[0, 1]`. See the property's own note — set it to collapse a child
     * without the surrounding gap popping.
     */
    gapScale: number;
    /**
     * Sets `width` and `height` to the same value in one go. Pure sugar: at
     * construction time, an author-facing `size` is expanded into `width`/
     * `height` before either is applied. Explicit `width` or `height` takes
     * precedence over `size` (mirroring `padding`'s side-vs-shorthand rule),
     * so `{ size: 200, width: 100 }` yields `width: 100, height: 200`.
     * Reactive bindings and `to()`/`set()` targets both work the same as
     * `width`/`height` — `size: 'fill'`, `size: () => ...`, or
     * `node.to({ size: 300 }, 0.5)` are all valid.
     */
    size: SizeInput;
    scale: number;
    rotation: number;
    opacity: number;
    /** Layer blend mode. `'pass-through'` (default) does not isolate the node — its opacity scales each child/fill while they blend against the backdrop. Any other mode isolates the node and blends its flattened result against the backdrop. */
    blend: NodeBlendMode;
    effects: Effect;
    /** Inner spacing between this node's edges and its content/children. */
    padding: Insets;
    /** When true, content drawn outside this node's outline is clipped away (see {@link Node2D.clipSelf}). */
    clip: boolean;
    /**
     * Pivot point for rotation and scale. Either a **named alignment** (`'center'`,
     * `'topRight'`, `'bottomLeft'`, … — the node `align` vocabulary) or an explicit
     * {@link Vector2}: `(0,0)`=center, `(-1,1)`=top-left, `(1,-1)`=bottom-right. Set
     * automatically when an alignment *positioning* prop is used.
     */
    pivot: Alignment;

    // ---- Mirrors and the third dimension -----------------------------------
    // A node is a flat plane, and these are the CSS transform functions that
    // still apply to one: the two mirrors, the two out-of-plane rotations, a
    // push along the view axis and the perspective that makes it read as depth.
    // `rotation` supplies the Z axis (see `transform3D` for why there is no
    // `rotationZ` beside it), and every one of them turns about `pivot` — or
    // about `transformOrigin`, where that is set.

    /**
     * Mirror the node (and its whole subtree) across its vertical centre line.
     * The same thing CSS's `scaleX(-1)` is: text reads backwards, a left-pointing
     * arrow points right, and nothing about the node's box or its layout moves.
     */
    flipHorizontal: boolean;
    /** Mirror across the horizontal centre line — CSS's `scaleY(-1)`. See {@link flipHorizontal}. */
    flipVertical: boolean;
    /** Tilt about the horizontal axis, in **degrees**. Positive tips the top edge away from the viewer. */
    rotationX: number;
    /** Tilt about the vertical axis, in **degrees**. Positive swings the right edge away from the viewer. */
    rotationY: number;
    /**
     * In-plane rotation belonging to the 3D transform, in **degrees** clockwise —
     * the Z axis of the `rotateX · rotateY · rotateZ` block.
     *
     * **Not a second name for {@link rotation}.** The two are independent numbers
     * and editing one never moves the other. What separates them is which side of
     * the geometry/paint line they fall on: `rotation` turns the node's *shape*,
     * so its box turns with it and everything reading that box follows, while
     * this is part of the projection, which is paint (see `Node2D._localMatrix`).
     * Turning a node with `rotation` turns its selection outline; turning it with
     * `rotationZ` spins the picture inside a box that stays where it was.
     *
     * They compose the only way two rotations about one axis can — they add.
     */
    rotationZ: number;
    /**
     * Push along the view axis, in px — CSS's `translateZ`. Positive brings the
     * node toward the viewer, so it projects larger.
     *
     * **Inert without {@link perspective}.** With no perspective the projection is
     * parallel and z is simply dropped, exactly as in CSS: there is no viewpoint
     * for a thing to be nearer to.
     */
    depth: number;
    /**
     * Distance from the viewer to the plane the node sits in, in px. `0` (the
     * default) is no perspective at all — a parallel projection, where a tilt
     * squashes the node evenly rather than making its far edge recede.
     *
     * Smaller is more dramatic: the node subtends more of the field of view, so
     * the convergence is stronger. Somewhere around 800–1500 reads like a page
     * on a desk; a few hundred reads like a wide-angle lens.
     *
     * Declared per node rather than inherited from an ancestor, which is where
     * CSS puts it. A scene graph has no viewport element to hang it on, and a
     * node that carries its own is one that can be handed around, nested and
     * animated without its depth depending on where it was dropped.
     */
    perspective: number;
    /**
     * Whether the node still paints once it has turned past edge-on and is
     * showing its back — CSS's `backface-visibility`, defaulted the CSS way
     * (`visible`).
     *
     * Set it `false` for the card-flip: two nodes back to back, one at
     * `rotationY: 0` and one at `180`, each hidden exactly while the other faces
     * out. The test is the tilt alone (see `facesAway`) — a {@link flipHorizontal}
     * mirrors the node without turning it around, so it does not hide it.
     */
    backfaceVisible: boolean;
    /**
     * The point every rotation, scale and mirror turns about — CSS's
     * `transform-origin`, in the same `[-1, 1]` vocabulary as {@link pivot}
     * (a named alignment, or a {@link Vector2} where `(0,0)` is the centre).
     *
     * Unset (the default) it *is* the pivot, so a node keeps turning about
     * whatever its alignment positioning gave it and nothing changes. Set, it wins
     * for the whole transform rather than for the 3D half of it — one origin, the
     * way CSS has one. A second origin that only some of the rotations respected
     * would produce a picture nobody could predict.
     */
    transformOrigin: Alignment;
    /**
     * All of the above in one bag — construction sugar, expanded into the
     * individual props before anything reads them (exactly as {@link size} is
     * expanded into `width`/`height`), so `set()`, `to()` and reactive callbacks
     * all behave identically whichever form is used.
     *
     * ```ts
     * Rect({ transform3D: { rotationX: 45, rotationY: -17, perspective: 900 } })
     * card().to({ transform3D: { rotationY: 180 } }, 0.8)
     * ```
     *
     * `rotationZ` is the block's own in-plane rotation and is **not** the node's
     * {@link rotation} under another name — see its note for what separates them.
     */
    transform3D: NodeTransform3D;

    // ---- Alignment-based positioning -----------------------------------------
    // Pass any one of these instead of (or in addition to) x/y.
    // The node will reactively offset itself so the named alignment lands at the
    // given scene-space position. Callbacks are supported and re-evaluated
    // whenever the referenced value or this node's layout changes.
    center: Vector2 | (() => Vector2);
    topLeft: Vector2 | (() => Vector2);
    topRight: Vector2 | (() => Vector2);
    bottomLeft: Vector2 | (() => Vector2);
    bottomRight: Vector2 | (() => Vector2);
    topCenter: Vector2 | (() => Vector2);
    bottomCenter: Vector2 | (() => Vector2);
    centerLeft: Vector2 | (() => Vector2);
    centerRight: Vector2 | (() => Vector2);

    /**
     * Proportional share of the free space along the parent's main axis,
     * relative to sibling `fill` children (like Flutter's `Expanded(flex:)`).
     * Only meaningful when this node fills the main axis — in a row that's
     * `width:'fill'`, in a column `height:'fill'`. Two siblings with `flex` 2
     * and 1 split the free space 2:1. Defaults to 1. Specifying `flex` without
     * an explicit `width`/`height` defaults both to `'fill'`.
     */
    flex: number;

    // ---- Grid placement (only read by a parent whose `flow` is 'grid') -------
    /** 1-based column index for explicit grid placement. Undefined = auto-placed. */
    column: number;
    /** 1-based row index for explicit grid placement. Undefined = auto-placed. */
    row: number;
    /** How many grid columns this child spans. Default 1. */
    colSpan: number;
    /** How many grid rows this child spans. Default 1. */
    rowSpan: number;
}

/**
 * The 2D tree's base: what every `component2d` lowers onto, and the scene root
 * ({@link Canvas2D}). It wires together three systems:
 *
 * **Properties** — each declared prop is backed by a {@link PropSlot}, which
 * holds either a value or a thunk. {@link set} updates props imperatively, and
 * a callback `() => expr` binds one to a derived value.
 *
 * **Tweening** — `to({ data, duration, easing })` returns a {@link Command}
 * that animates props to target values, evaluable at a time via `at(t)`.
 * `moveTo`, `fadeTo`, `rotateTo`, `scaleTo` and the rest wrap it.
 *
 * **Layout** — `measure()` is called top-down to resolve sizes, then
 * `layout()` places the node in its allocated `BoxBounds` and its children in
 * its content box.
 *
 * ### Built-in visual props
 * | prop      | default  | unit / notes                          |
 * |-----------|----------|---------------------------------------|
 * | `x`       | 0        | horizontal offset in scene pixels     |
 * | `y`       | 0        | vertical offset (positive = up)       |
 * | `width`   | `'fill'` | `SizeInput`: px, `'fill'`, `'auto'`  |
 * | `height`  | `'fill'` | same                                  |
 * | `size`    | —        | sugar: sets `width` and `height` together |
 * | `scale`   | 1        | uniform scale factor                  |
 * | `rotate`  | 0        | degrees, clockwise                    |
 * | `opacity` | 1        | 0–1                                   |
 * | `blend`   | `'pass-through'` | layer blend mode (`NodeBlendMode`) |
 * | `effects` | []       | post-process / blend effects          |
 * | `padding` | 0        | inner spacing, all four edges         |
 */
export class Node2D<P extends Node2DProps = Node2DProps> extends Node<P> {
    get dimension(): NodeDimension { return "2d"; }

    /**
     * This node's parent, when that parent is itself 2D.
     *
     * A `Node2D` can only ever be adopted by another `Node2D` (see
     * {@link Node.acceptsChild}), so this is `null` only for a detached node or
     * the root — but it is typed honestly rather than cast, because the base
     * tree holds both dimensions.
     */
    protected get parent2D(): Node2D | null {
        const parent = this._parent;
        return parent instanceof Node2D ? parent : null;
    }

    /**
     * This node's parent, narrowed to the 2D tree.
     *
     * Only a `Node2D` can adopt a `Node2D` (see {@link Node.acceptsChild}), so
     * this never hides a real parent — it just spares every 2D caller a cast.
     */
    override get parent(): Node2D | null {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this.parent2D;
    }

    /**
     * This node's children **in the 2D tree**.
     *
     * `Canvas3D` is the one node that holds both dimensions, and its `Node3D`
     * children are not part of the 2D tree — they describe a scene it paints,
     * not boxes it lays out — so they are reached through its own accessor
     * instead. Every other node's list is already 2D, and this returns the live
     * array untouched in that case rather than allocating a copy per read.
     */
    override get children(): Node2D[] {
        if (_observer !== null) _observer.read(this._structureSlot());
        const all = this._children;
        for (let i = 0; i < all.length; i++) {
            if (!(all[i] instanceof Node2D)) {
                return all.filter((c): c is Node2D => c instanceof Node2D);
            }
        }
        return all as Node2D[];
    }

    constructor(props?: NodeConfig<any, P>) {
        super(props);

        // Expand the `size` and `transform3D` sugar into the props they name
        // before anything reads either — in place, so the single object `super()`
        // retained as `_props` already carries the expanded values.
        if (props) {
            size2DOps.expand(props as Record<string, unknown>);
            expandTransform3D(props as Record<string, unknown>);
        }

        // Fires the ref, adopts the seed, and applies every `property` default.
        // Deferred to here rather than run by `super()` because the cells those
        // props write into are this class's own fields, and a subclass's field
        // initializers only run once `super()` has returned.
        this.initProps(props);

        // Specifying `flex` signals intent to fill the parent's main axis, so an
        // unspecified width/height defaults to 'fill' (flex is a no-op on a
        // fixed/hug axis) and skips the has-children default below.
        if (props && (props as any).flex !== undefined) {
            if (props.width === undefined) this.applyProp("width", "fill", { tween: sizeInputOps.lerp });
            if (props.height === undefined) this.applyProp("height", "fill", { tween: sizeInputOps.lerp });
        } else {
            this.applyDefaultSize(props);
        }

        // Alignment-based positioning: validate, derive pivot, bind x/y. The pivot
        // and centre offset math lives in alignmentOps (shared with the
        // `to()` path); here we use its reactive binding form.
        if (props) {
            alignmentOps.validateProps(props as Record<string, unknown>);
            const alignmentKey = alignmentOps.findKey(props as Record<string, unknown>);
            if (alignmentKey) {
                const raw = (props as any)[alignmentKey] as Vector2 | (() => Vector2);
                const getTarget: () => Vector2 = typeof raw === 'function' ? raw : () => raw;
                const { pivot, x, y } = alignmentOps.bindTarget(alignmentKey, getTarget, () => this._layoutBounds.get());
                this._writeProp('pivot', pivot);
                this._writeProp('x', x);
                this._writeProp('y', y);
            }
        }

        this.adoptChildrenProp(props);
    }

    /**
     * The 2D half of `set()`: `size` and `transform3D` are sugar with no slot of
     * their own, so they are distributed into the props that do have one before
     * the generic write loop runs.
     */
    override set(props: { [K in keyof P]?: P[K] | (() => P[K]) }): void {
        // `size` has no slot of its own — it's sugar written straight to
        // width/height (explicit width/height in the same call still wins).
        const sizeVal = (props as any).size;
        // Same for `transform3D`, but expanded up front rather than after the
        // loop: its fields are real props, so distributing them into `props`
        // first means the generic loop writes them like any other key. Only the
        // present-and-an-object case allocates, which is the rare one.
        if ((props as any).transform3D !== undefined) {
            props = { ...props };
            expandTransform3D(props as Record<string, unknown>);
        }
        super.set(props);
        if (sizeVal !== undefined) {
            if ((props as any).width === undefined) this._writeProp('width', sizeVal);
            if ((props as any).height === undefined) this._writeProp('height', sizeVal);
        }
    }

    /**
     * The 2D half of `_prepareStep`: expand the positional sugar into the props
     * that actually have cells, then let the base resolve the step.
     *
     * `to` is mutated in place, so the base sees the expanded target — which is
     * why this can run entirely before `super`.
     */
    override _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        // `size` has no slot of its own — expand it into width/height targets
        // before anchor validation and the per-key tween setup below see it.
        // `transform3D` is sugar in the same way, so it expands here too and its
        // fields tween individually, exactly as if they had been named directly.
        size2DOps.expand(to as Record<string, unknown>);
        expandTransform3D(to as Record<string, unknown>);

        // `pivot`: an explicit, transient origin for *this step's* rotation and
        // scale — `moveTo`/`rotateTo`/`scaleTo`'s own option (see their object-form
        // overloads below), or just as well a bare key on a `to()` target. Not a
        // real prop — nothing on the node holds a value named `pivot` that a tween
        // interpolates — so it's read and stripped before anything else here (the
        // alignment validation included) ever sees it.
        const explicitPivot = (to as { pivot?: Alignment }).pivot;
        if (explicitPivot !== undefined) delete (to as { pivot?: Alignment }).pivot;

        alignmentOps.validateProps(to as Record<string, unknown>);

        // If an alignment key is in the tween target, resolve it to x/y targets and
        // set the transform origin (one-shot form of the shared alignment math in
        // alignmentOps).
        const alignmentKey = alignmentOps.findKey(to as Record<string, unknown>);
        if (alignmentKey) {
            const raw = (to as any)[alignmentKey] as Vector2;
            const { pivot, x, y } = alignmentOps.resolveTargetOnce(alignmentKey, this._layoutBounds.get(), raw);
            // Was `this._writeProp('pivot', pivot)`. `pivot` is the node's
            // *permanent* rotation/scale origin — set once, reactively, at
            // construction (see `alignmentOps.bindTarget`) from whichever alignment prop
            // positions it there. A *tween's* target used to overwrite that
            // permanent value with its own alignment every time one was used to
            // state a position, which means a `moveTo` aligned differently from
            // the node quietly re-pointed every rotation that ran after it.
            // `transformOrigin` (see its own doc) is the right prop for this
            // instead: it wins for the whole transform without being the node's
            // one true pivot. An explicit `pivot` given on this same step (via
            // `moveTo`/`rotateTo`/`scaleTo`'s object form) overrides the
            // alignment-derived value in turn — the point a position is stated
            // against and the point a rotation turns about are two different
            // questions once a step can state them separately.
            this._writeProp('transformOrigin', explicitPivot !== undefined ? alignmentOps.resolve(explicitPivot) : pivot);
            (to as any).x = x;
            (to as any).y = y;
        } else if (explicitPivot !== undefined) {
            this._writeProp('transformOrigin', alignmentOps.resolve(explicitPivot));
        }

        return super._prepareStep(to, duration, easing);
    }

    /**
     * A component's paint entries declare themselves, so only a node painting
     * something its attributes do not describe has anything to add.
     */
    override declareAssets(assets: AssetScope): void {
        assets.effects(this.effects as NodeEffect[]);
    }

    /** Sample this node's own derived render state for the current frame. */
    override _sample(): void {
        this._sampleMotion();
    }

    /**
     * Record this node's current position as the motion history's previous
     * frame, stamped `at`, deriving no velocity — see the base's note.
     */
    override _primeMotion(at: number): void {
        const r = this.layoutBounds;
        const o = this._offset();
        primeMotion(
            this._motionHistory,
            (r?.x ?? 0) + o.x,
            (r?.y ?? 0) - o.y,
            this.rotation,
            this.scale,
            at,
        );
    }

    // ---- Visual properties ------------------------------------------------

    declare x: number;
    declare y: number;
    declare width: SizeInput;
    declare height: SizeInput;
    declare scale: number;
    declare rotation: number;
    declare opacity: number;
    declare blend: NodeBlendMode;
    declare effects: Effect;
    declare padding: Insets;

    declare readonly pivot: Alignment;

    // ---- Mirrors and the third dimension -----------------------------------
    // See the matching entries on Node2DProps for what each one means. The
    // angles and depth are plain numeric cells, so they tween like x/y/rotation
    // do; the booleans snap at the end of a tween the way every other discrete
    // cell does. `perspective` is the one exception — see {@link lerpPerspective}.

    /** Mirror across the vertical centre line. See {@link Node2DProps.flipHorizontal}. */
    declare flipHorizontal: boolean;
    /** Mirror across the horizontal centre line. See {@link Node2DProps.flipVertical}. */
    declare flipVertical: boolean;
    /** Tilt about the horizontal axis, degrees. See {@link Node2DProps.rotationX}. */
    declare rotationX: number;
    /** Tilt about the vertical axis, degrees. See {@link Node2DProps.rotationY}. */
    declare rotationY: number;
    /** The 3D block's in-plane rotation, degrees — distinct from {@link rotation}. See {@link Node2DProps.rotationZ}. */
    declare rotationZ: number;
    /** Push along the view axis, px. See {@link Node2DProps.depth}. */
    declare depth: number;
    /**
     * Viewer distance in px; `0` is a parallel projection. See
     * {@link Node2DProps.perspective}.
     *
     * Tweened in reciprocal space ({@link lerpPerspective}), not linearly: the
     * renderer's own projection math varies with `1/perspective`, so a plain
     * lerp of the raw distance sweeps through the near-zero numbers next to
     * "off" and flashes an exaggerated, near-degenerate projection right at the
     * start of a `0 → n` tween (or the end of an `n → 0` one) before settling
     * to the depth actually asked for.
     */
    declare perspective: number;
    /** Whether the node paints while showing its back. See {@link Node2DProps.backfaceVisible}. */
    declare backfaceVisible: boolean;
    /**
     * The point the transform turns about, overriding {@link pivot}. See
     * {@link Node2DProps.transformOrigin}.
     *
     * `undefined` until set — that absence *is* "follow the pivot", which no
     * default value could say, since every alignment is a real point including the
     * centre. Same shape as the `column`/`row` cells above. Declared with a plain
     * `property` rather than `alignmentProperty()` for exactly that reason: that one
     * folds a missing `default` back onto `'center'`.
     */
    declare transformOrigin: Alignment | undefined;

    /** When true, content drawn by this node's children is clipped to its outline (see {@link clipSelf}). */
    declare clip: boolean;

    declare flex: number;
    /**
     * Per-child weight for the flex gap this node contributes to its parent's
     * main axis, in `[0, 1]`. Default `1` = a full gap on each side (normal
     * layout). Driven `0 → 1` (insert) / `1 → 0` (remove) by the animated
     * `addChildAt`/`removeChildAt` overloads so the surrounding gap opens/closes
     * in lockstep with the child's box instead of popping — see
     * {@link addChildAtAnimated}. Read only by flex containers off their
     * children.
     *
     * Rarely set by hand, but it has to be *settable*: a host collapsing a child
     * in place rather than removing it — which is what makes a show/hide a value
     * a time can produce instead of an effect that has to have run — needs the
     * gap to close with it. Declared on {@link Node2DProps} for that reason; it
     * used to be reachable only through a cast, which is why the lifecycle
     * helpers carry one.
     */
    declare gapScale: number;
    declare column: number | undefined;
    declare row: number | undefined;
    declare colSpan: number;
    declare rowSpan: number;

    private readonly _layoutBounds = new PropSlot<BoxBounds>({ x: 0, y: 0, width: 0, height: 0 }, this, LAYOUT_SLOT);

    /**
     * The size limits and the measurer threaded through this node's last
     * {@link measure} pass.
     *
     * Retained so off-tree work can measure a not-yet-attached child *in
     * isolation* — the animated child-insert in `node-lifecycle.ts` needs a hug
     * child's natural size without putting it in this node's flow first, or the
     * siblings shift for a frame. Undefined until this node is first measured.
     *
     * One object rather than two loose fields, because the two are only ever
     * useful together and were previously reached through a
     * `{ constraints?; _lastScope? }` structural cast from two other modules —
     * a cast that would have gone on compiling through any rename.
     *
     * @internal
     */
    lastMeasure?: { constraints: SizeConstraints; measurer: MeasureContext2D };

    /**
     * The box the last layout pass allocated this node: its size, and where it
     * sits in its parent's space (canvas y-down).
     *
     * Reactive — a read inside a binding is tracked, so a prop bound to another
     * node's box re-evaluates when that box moves.
     *
     * **Public, and a single member.** It used to be a `protected layoutRect`
     * plus a public `measuredRect` alias that existed only so the picking walk
     * could reach it — and, in practice, a `(node as any).layoutRect` cast in
     * every test that needed a box. Two names for one value, one of them
     * reachable only by lying to the compiler, is worse than the thing
     * `protected` was buying. Writing it is still {@link setLayoutBounds}, which
     * is where the layout engine's invariants live.
     */
    get layoutBounds(): BoxBounds { return this._layoutBounds.get(); }

    /**
     * {@link flattenChildrenProp}, narrowed to the children this node will
     * actually lay out — a 3D or audio child sits in the same `children` prop but
     * takes no part in 2D layout, so it can't inform the size defaults either.
     */
    protected static flowChildrenProp(props: { children?: unknown } | undefined): Node2D[] {
        return Node2D.flattenChildrenProp(props).filter((c): c is Node2D => c instanceof Node2D);
    }

    /**
     * True if any of `children` requests `"fill"` on `axis` — the signal a
     * component's size default reads to decide whether hugging on that axis
     * would strand the child with no space to fill into.
     */
    protected static hasFillChild(children: Node2D[], axis: "width" | "height"): boolean {
        return children.some((c) => (axis === "width" ? c.width : c.height) === "fill");
    }

    /**
     * Default for `width`/`height`: hug-to-content when the node is given
     * children, fill-the-parent when it's empty. Called once from the
     * constructor (skipped when `flex` is set, since that already implies
     * 'fill'); `component2d` replaces it with the component rule.
     */
    protected applyDefaultSize(props?: NodeConfig<any, P>): void {
        const hasChildren = Node2D.flowChildrenProp(props).length > 0;
        const defaultSize = hasChildren ? "hug" : "fill";
        if (!props || props.width === undefined) this.applyProp("width", defaultSize, { tween: sizeInputOps.lerp });
        if (!props || props.height === undefined) this.applyProp("height", defaultSize, { tween: sizeInputOps.lerp });
    }

    // ---- Motion helpers ---------------------------------------------------
    //
    // Each returns the `Command` it delegates to rather than wrapping it in
    // anything, because the wrapper would discard the thing worth having: a
    // `Command` can be *evaluated* at a time, and anything that merely advances
    // can only be run to one.

    /**
     * Animate `x`/`y` to the given position, along `path`, or onto another node.
     * `pivot` (optional) sets {@link Node2DProps.transformOrigin} — the point
     * later rotate/scale turn about — independent of the node's own permanent
     * {@link pivot}, and it carries forward like any other prop until something
     * restates it.
     *
     * `path` replaces the destination rather than qualifying it — stating both is
     * an error, since the path's own end is where the move ends — and the node
     * walks it by **arc length**, so easing shapes the travel rather than the
     * curve's parameter. Its coordinates *are* `x`/`y` values, in the same y-up
     * space a `PathCommand[]` is authored in library-wide: the path says where
     * the node is at `t`, not how far it has come from wherever the previous
     * command left it.
     *
     * `target` is a node id and `targetAnchor` the point of its box to land on
     * (centre when absent), resolved when the command is built — so moving the
     * target re-aims the move with nothing to re-author, and a target absent at
     * that moment leaves the node where it is. Like `path`, it replaces `x`/`y`.
     * Given a `path` as well, the path is turned and scaled about its own start
     * until its end lands on the target, which is exact where the two already
     * agree and keeps the curve's shape where the target has since moved.
     *
     * @example
     * node.moveTo({ data: { x: 200, y: 100, pivot: 'topRight' }, duration: 0.5 });
     * node.moveTo({ data: { path: new PathBuilder().arc({ width: 600, startAngle: 180, sweep: -180 }) }, duration: 2 });
     * node.moveTo({ data: { target: 'card', targetAnchor: 'topRight' }, duration: 1 });
     */
    moveTo(
        args: CommandArgs<{
            x?: number;
            y?: number;
            path?: PathData | PathBuilder;
            target?: string;
            targetAnchor?: Alignment;
            pivot?: Alignment;
        }> & { duration: number },
    ): Command<P> {
        const { path, target, targetAnchor, ...destination } = args.data ?? {};
        const positioned = destination.x !== undefined || destination.y !== undefined;
        const aimed = typeof target === "string" && target !== "";
        if (aimed && positioned) {
            throw new Error(
                "moveTo takes a `target` or an `x`/`y` destination, not both — the target's anchor is where the move ends.",
            );
        }
        const aim = aimed ? this._pointOnNode(target, targetAnchor) : null;
        if (path === undefined || path === null) {
            return this.to({ data: { ...destination, ...aim } as Partial<P>, duration: args.duration, easing: args.easing });
        }
        if (positioned) {
            throw new Error(
                "moveTo takes a `path` or an `x`/`y` destination, not both — the path's own end is where the move ends.",
            );
        }
        const sampler = pathOps.sampler(path instanceof PathBuilder ? path.toCommands() : path);
        const { length } = sampler;
        const first = sampler.frameAt(0);
        const last = sampler.frameAt(length);
        const fit = aim && first && last ? pathOps.endFit(first, last, aim) : null;
        const origin = destination.pivot;
        return this.command<P>((t) => {
            const frame = sampler.frameAt(length * t);
            // A degenerate path has no point to be at, so the move writes
            // nothing rather than collapsing the node onto the origin.
            if (!frame) return {} as Partial<P>;
            const point = fit ? fit(frame) : frame;
            const at = { x: point.x, y: point.y } as Partial<P>;
            if (origin !== undefined) (at as { transformOrigin?: Alignment }).transformOrigin = origin;
            return at;
        }, args.duration, args.easing);
    }

    /** Animate `opacity` to the target value, in `[0, 1]`. */
    fadeTo(args: CommandArgs<{ opacity: number }> & { duration: number }): Command<P> {
        return this.to({ data: args.data as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /**
     * Animate `rotation` to the target angle (degrees, clockwise). `pivot`
     * (optional) behaves as in {@link moveTo}.
     *
     * @example
     * node.rotateTo({ data: { rotation: 180, pivot: 'topRight' }, duration: 0.6 });
     */
    rotateTo(args: CommandArgs<{ rotation: number; pivot?: Alignment }> & { duration: number }): Command<P> {
        return this.to({ data: args.data as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /**
     * Animate `scale` to the target factor. `pivot` (optional) behaves as in
     * {@link moveTo}.
     *
     * @example
     * node.scaleTo({ data: { scale: 2, pivot: 'topRight' }, duration: 0.4 });
     */
    scaleTo(args: CommandArgs<{ scale: number; pivot?: Alignment }> & { duration: number }): Command<P> {
        return this.to({ data: args.data as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /**
     * Animate the box: `width`, `height` and `padding`, whichever are given.
     * A size keyword (`'fill'`, `'hug'`) snaps; a number interpolates.
     *
     * @example
     * node.layoutTo({ data: { width: 640, height: 360 }, duration: 0.5 });
     */
    layoutTo(args: CommandArgs<{ width?: SizeInput; height?: SizeInput; padding?: Insets }> & { duration: number }): Command<P> {
        return this.to({ data: _stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /**
     * Swell to `factor` times the node's size and settle back: a nudge of the
     * eye toward it. It ends as it began, so nothing after it needs restating.
     *
     * @example
     * node.pulse({ data: { factor: 1.3 }, duration: 0.6 });
     */
    pulse(args: CommandArgs<{ factor?: number }> & { duration: number }): Command<P> {
        const rest = this.scale;
        const factor = args.data?.factor ?? 1.2;
        return this.command<P>(
            (t) => ({ scale: rest * (1 + (factor - 1) * Math.sin(Math.PI * t)) }) as Partial<P>,
            args.duration,
            args.easing,
        );
    }

    /**
     * Rock about the node's own turn, `angle` degrees each way for `turns`
     * swings, building up and dying away. It ends as it began.
     *
     * @example
     * node.wiggle({ data: { angle: 10, turns: 4 }, duration: 0.8 });
     */
    wiggle(args: CommandArgs<{ angle?: number; turns?: number }> & { duration: number }): Command<P> {
        const rest = this.rotation;
        const angle = args.data?.angle ?? 8;
        const turns = args.data?.turns ?? 3;
        return this.command<P>(
            (t) => ({ rotation: rest + angle * Math.sin(2 * Math.PI * turns * t) * Math.sin(Math.PI * t) }) as Partial<P>,
            args.duration,
            args.easing,
        );
    }

    /** Animate the `effects` stack to another one. */
    effectTo(args: CommandArgs<{ effects: Effect }> & { duration: number }): Command<P> {
        return this.to({ data: _stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    // ---- Layout queries ---------------------------------------------------

    get measuredWidth(): number {
        return this.layoutBounds.width;
    }

    get measuredHeight(): number {
        return this.layoutBounds.height;
    }

    // ---- Alignment points ----------------------------------------------------
    // All getters read `layoutBounds` and the x/y/rotation props, and a bound prop
    // recomputes on every read — so a callback built from them is always current.

    /** Rotate offset (ox, oy) by this node's rotation (degrees clockwise) around the node center. */
    private _rotateOffset(ox: number, oy: number): Vector2 {
        const o = this._offset();
        return rotateOffset(o.x, o.y, this.rotation, ox, oy);
    }

    /** Center of the node — equivalent to its x/y position (0,0 is the center of the layout cell). */
    get center(): Vector2 {
        const o = this._offset();
        return { x: o.x, y: o.y };
    }

    get topLeft(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(-r.width / 2, r.height / 2);
    }

    get topRight(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(r.width / 2, r.height / 2);
    }

    get bottomLeft(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(-r.width / 2, -r.height / 2);
    }

    get bottomRight(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(r.width / 2, -r.height / 2);
    }

    get topCenter(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(0, r.height / 2);
    }

    get bottomCenter(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(0, -r.height / 2);
    }

    get centerLeft(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(-r.width / 2, 0);
    }

    get centerRight(): Vector2 {
        const r = this.layoutBounds;
        return this._rotateOffset(r.width / 2, 0);
    }

    // ---- Global (world-space) transform -----------------------------------
    // The local alignment getters above are relative to this node's *parent*; their
    // global counterparts below fold in the full ancestor chain so a node can be
    // aligned to another regardless of where each sits in the tree:
    //   new Rect({ x: () => other().global.x, y: () => other().global.y })
    // Each read walks this node's and every ancestor's live
    // layout/x/y/rotation/scale/pivot props, so a binding over them stays current.

    /**
     * This node's local transform in canvas (y-down) space — position, rotation,
     * scale, about its origin. Composed with the parent chain by
     * {@link worldMatrix}, and the matrix every world-space *reading* of the node
     * comes from: {@link global}, `runtime/node-picking.ts`, and so any editor
     * overlay drawn on top of a scene.
     *
     * **It is flat, deliberately, and the renderer's is not.** A node that
     * mirrors or tilts ({@link Node2DProps.rotationX}, {@link Node2DProps.perspective},
     * {@link Node2DProps.flipHorizontal}, …) is *painted* through a projected
     * matrix, but goes on measuring, reporting and hit-testing as the upright
     * rectangle it was — see {@link applyTransform}.
     *
     * That is a choice, not an oversight. Everything that reads a node's box
     * reads it to put a handle on: a selection outline, a resize grip, a rotation
     * dial, `other.global.topRight` as an alignment target. Those all mean
     * something on a rectangle and stop meaning it on a trapezoid — a "width"
     * handle on a foreshortened edge does not correspond to any number, and a
     * corner that has swung behind the viewer has no screen position at all.
     * Letting the projection through would make the tilt a thing that quietly
     * breaks every other tool in the editor; keeping the geometry flat makes it
     * exactly what it looks like, a way of drawing the node.
     */
    /** @internal Composed with the camera scopes in between by `runtime/node-picking.ts`. */
    _localMatrix(): Matrix2D {
        const r = this.layoutBounds;
        const slot = this._slotMatrix();
        const { x: ox, y: oy } = this._offset();
        if (slot) {
            return multiply(slot, localMatrix(
                ox, -oy, this.rotation, this.scale, this._transformOrigin(),
                r?.width ?? 0, r?.height ?? 0,
            ));
        }
        const cx = (r?.x ?? 0) + ox;
        const cy = (r?.y ?? 0) - oy;
        // The accessor stores the resolved normalised pivot via the mapper.
        // No projection: see the note above for why a node's *geometry* stays
        // flat while its paint does not.
        return localMatrix(
            cx, cy, this.rotation, this.scale, this._transformOrigin(),
            r?.width ?? 0, r?.height ?? 0,
        );
    }

    /** @internal The slot {@link _placementOf} puts this node in, from its parent. */
    _placement(): ChildPlacement | null {
        return this.parent2D?._placementOf(this) ?? null;
    }

    /**
     * The slot this node places `child` in beyond its layout box, or `null` —
     * the default — when the box says it all. A layout that turns, scales or
     * fades each of its children answers here, and the renderer, picking and
     * `global` all follow. See {@link ChildPlacement}.
     */
    /** @internal */
    _placementOf(_child: Node2D): ChildPlacement | null {
        return null;
    }

    /**
     * The coordinates `child`'s `x`/`y` are in, or `null` — the default — when
     * they are pixels. A `null` child asks for one that is not here yet: where
     * a host would drop or paste it. See {@link ChildPlane}.
     */
    /** @internal */
    _planeOf(_child: Node2D | null): ChildPlane | null {
        return null;
    }

    /**
     * Where its own layout would centre a child of `size` that is not here yet,
     * y-down from its centre, or `null` when it arranges its children in a run
     * or a grid (the run decides) or has not laid any out.
     */
    /** @internal */
    _slotFor(size: Size2D): Vector2 | null {
        const space = this._childSpace;
        const box = space ? flowOps.freeSlot(space.settings, space.inner, size) : null;
        return space && box ? { x: space.inner.x + box.x, y: space.inner.y - box.y } : null;
    }

    /**
     * Where its centre sits from the point its `x`/`y` place, in its parent's
     * frame, y-down, at `rotation` and `scale`: what turning or scaling about an
     * off-centre pivot adds.
     */
    /** @internal */
    _centreShift(rotation = this.rotation, scale = this.scale): Vector2 {
        const r = this.layoutBounds;
        const own = localMatrix(0, 0, rotation, scale, this._transformOrigin(), r?.width ?? 0, r?.height ?? 0);
        return applyToPoint(own, { x: 0, y: 0 });
    }

    /** The points an editor may drag on this node, where they sit now; none by default. See {@link NodeHandle}. */
    /** @internal */
    _handles(): readonly NodeHandle[] {
        return NO_HANDLES;
    }

    /** The value `prop` takes for its handle to sit at `at`, in this node's own frame; `null` when it has none. */
    /** @internal */
    _handleValue(_prop: string, _at: Vector2): Vector2 | null {
        return null;
    }

    private readonly _offsetScratch: Vector2 = { x: 0, y: 0 };

    /**
     * This node's `x`/`y` as the pixel offset its parent sees. Every position
     * read goes through here, which is what keeps paint, picking and `global`
     * agreeing under a {@link ChildPlane}. The result is reused: read it at once.
     */
    /** @internal */
    _offset(): Vector2 {
        const plane = this.parent2D?._planeOf(this);
        if (plane) return plane.toOffset(this.x, this.y);
        const o = this._offsetScratch;
        o.x = this.x;
        o.y = this.y;
        return o;
    }

    /**
     * The flat part of this node's slot, as the frame its own `x`/`y` move in —
     * the layout box's centre, turned and scaled by the slot. `null` when it has
     * no slot. With `paint`, the slot's tilt as well, which only paint sees.
     */
    /** @internal Also the plane `runtime/node-picking.ts` drags a placed node across. */
    _slotMatrix(paint = false): Matrix2D | null {
        const slot = this._placement();
        if (!slot) return null;
        const r = this.layoutBounds;
        return localMatrix(
            r?.x ?? 0, r?.y ?? 0, slot.rotation, slot.scale, ORIGIN_2D, 0, 0,
            paint ? slotProjection(slot) : undefined,
        );
    }

    /** @internal {@link _slotMatrix} in a space, where the slot's tilt and depth are geometry. */
    _slotAffine(): Affine3 | null {
        const slot = this._placement();
        if (!slot) return null;
        const r = this.layoutBounds;
        return nodeSpaceMatrix(r?.x ?? 0, r?.y ?? 0, slot.rotation, slot.scale, 0, 0, slotProjection(slot));
    }

    /**
     * The point this node's transform turns about, normalised: `transformOrigin`
     * where one is set, the alignment-derived `pivot` otherwise. One resolution,
     * read by {@link _localMatrix} and {@link applyTransform} alike.
     */
    private _transformOrigin(): Vector2 {
        return (this.transformOrigin as Vector2 | undefined) ?? (this.pivot as Vector2);
    }

    // Reused for the same reason `_transformScratch` is: `_localMatrix` runs once
    // per ancestor per `global` read, and the two functions that take a
    // Projection3D read it synchronously and never retain it.
    private readonly _projectionScratch: Projection3D = {
        rotationX: 0, rotationY: 0, rotationZ: 0, depth: 0, perspective: 0,
        flipHorizontal: false, flipVertical: false,
    };

    /**
     * This node's out-of-plane fields, gathered for the matrix builders — and for
     * the backface test. A space root overrides it, because its 3D props aim the
     * camera rather than turn the root.
     */
    protected _projection(): Projection3D {
        const p = this._projectionScratch;
        p.rotationX = this.rotationX;
        p.rotationY = this.rotationY;
        p.rotationZ = this.rotationZ;
        p.depth = this.depth;
        p.perspective = this.perspective;
        p.flipHorizontal = this.flipHorizontal;
        p.flipVertical = this.flipVertical;
        return p;
    }

    /** @internal This node's transform in its parent's 3D frame, when it is inside a space. See `node-space.ts`. */
    _spaceMatrix(): Affine3 {
        const r = this.layoutBounds;
        const width = r?.width ?? 0;
        const height = r?.height ?? 0;
        const origin = this._transformOrigin();
        const slot = this._slotAffine();
        const { x: ox, y: oy } = this._offset();
        if (slot) {
            return multiplyAffine3(slot, nodeSpaceMatrix(
                ox, -oy, this.rotation, this.scale,
                origin.x * (width / 2), -origin.y * (height / 2),
                this._projection(),
            ));
        }
        return nodeSpaceMatrix(
            (r?.x ?? 0) + ox, (r?.y ?? 0) - oy, this.rotation, this.scale,
            origin.x * (width / 2), -origin.y * (height / 2),
            this._projection(),
        );
    }

    /**
     * This node's full transform in canvas (y-down) world space — the product of
     * every ancestor's local matrix from the root down to this node. Walks the
     * live parent chain on every call, reading each node's transform props.
     */
    protected worldMatrix(): Matrix2D {
        const local = this._localMatrix();
        const parent = this.parent2D;
        return parent ? multiply(parent.worldMatrix(), local) : local;
    }

    /**
     * Resolved world-space transform — the same alignment points and metrics as the
     * local getters (`center`, `topRight`, `rotation`, …) but folded through the
     * full ancestor chain, so values are absolute scene coordinates rather than
     * parent-relative ones. See {@link WorldTransform}. Every field is reactive.
     *
     * @example
     * // Read another node's absolute corner, regardless of its parent:
     * const p = other.global.topRight;   // world-space {x, y}
     *
     * ### Reading vs. placing
     * `global` is for *reading* world coordinates. `x`/`y` (and the alignment props)
     * are **parent-relative**, so assigning a world value to them does not by
     * itself place this node in world space — it offsets it from this node's own
     * parent. To land exactly on another node regardless of either parent,
     * subtract this node's parent's world contribution:
     *
     * @example
     * // Place this node's origin exactly on `other`, any parent:
     * new Rect({
     *   x: () => other.global.x - (myParent.global.x),
     *   y: () => other.global.y - (myParent.global.y),
     * });
     *
     * When both nodes share the same parent origin (e.g. both at the scene root),
     * `x: () => other.global.x` already lands on target with no compensation.
     */
    get global(): WorldTransform {
        const r = this.layoutBounds;
        const anchors = worldAnchors(this.worldMatrix(), (r?.width ?? 0) / 2, (r?.height ?? 0) / 2);

        // Accumulate ancestor rotation/scale/opacity up the chain (rotation sums,
        // scale and opacity multiply — all match the renderer's nested transforms
        // and its pass-through alpha fold).
        let rotation = 0;
        let scale = 1;
        let opacity = 1;
        for (let n: Node2D | null = this; n; n = n.parent2D) {
            const slot = n._placement();
            rotation += n.rotation + (slot?.rotation ?? 0);
            scale *= n.scale * (slot?.scale ?? 1);
            opacity *= n.opacity * (slot?.opacity ?? 1);
        }

        return {
            x: anchors.center.x,
            y: anchors.center.y,
            ...anchors,
            rotation,
            scale,
            opacity,
        };
    }

    /**
     * The `x`/`y` that put this node on `anchor` of the node `id` names, in this
     * tree — or `null` when there is no such 2D node here right now.
     */
    private _pointOnNode(id: string, anchor: Alignment | undefined): Vector2 | null {
        const target = findNode2D(this, id);
        if (!target) return null;

        const a = alignmentOps.resolve(anchor ?? "center");
        const box = target.layoutBounds;
        const world = applyToPoint(target.worldMatrix(), {
            x: a.x * ((box?.width ?? 0) / 2),
            y: -a.y * ((box?.height ?? 0) / 2),
        });
        const parent = this.parent2D;
        const toParent = parent ? invert(parent.worldMatrix()) : null;
        if (parent && !toParent) return null;
        const local = toParent ? applyToPoint(toParent, world) : world;
        const own = this.layoutBounds;
        const x = local.x - (own?.x ?? 0);
        const y = (own?.y ?? 0) - local.y;
        return parent?._planeOf(this)?.toCoords(x, y) ?? { x, y };
    }

    // `child` typed to the shared base because that is what a tree holds; the
    // guard below rejects a `Node3D` before it can land in a tree that would
    // never draw it. Registered as a command on {@link Node}, which owns the instant insert.
    override addChildAt(args: CommandArgs<{ child: Node; index: number }> & { duration?: undefined }): void;
    override addChildAt(args: CommandArgs<{ child: Node; index: number }> & { duration: number }): Command<Record<string, never>>;
    override addChildAt(args: CommandArgs<{ child: Node; index: number }>): void | Command<Record<string, never>> {
        const { child, index } = args.data as { child: Node; index: number };
        this.assertAcceptsChild(child);
        if (args.duration === undefined) {
            this._insertChildAt(child, index);
            return;
        }
        // Past the guard, so this is a 2D child: the animated insert measures it
        // off-tree, which only a laid-out node can do.
        return addChildAtAnimated(this, child as Node2D, index, args.duration, args.easing);
    }

    removeChildAt(args: CommandArgs<{ index: number }> & { duration?: undefined }): Node2D | null;
    removeChildAt(args: CommandArgs<{ index: number }> & { duration: number }): Command<Record<string, never>>;
    removeChildAt(args: CommandArgs<{ index: number }>): (Node2D | null) | Command<Record<string, never>> {
        const index = (args.data as { index: number }).index;
        if (args.duration === undefined) {
            if (index < 0 || index >= this._children.length) return null;
            if (_observer !== null) this._structureChanged(this._children[index]);
            const [removed] = this._children.splice(index, 1);
            if (removed) {
                (removed as Node2D)._parent = null;
                removed.detach();
            }
            return (removed as Node2D) ?? null;
        }
        return removeChildAtAnimated(this, index, args.duration, args.easing);
    }

    // ---- Rendering --------------------------------------------------------

    // Reused each frame so applyTransform doesn't allocate a fresh descriptor
    // per node per frame. ctx.transform reads it synchronously and never retains
    // it, so a single mutated instance is safe.
    private readonly _transformScratch: TransformState = {
        x: 0, y: 0, width: 0, height: 0,
        scale: 1, rotation: 0, opacity: 1, blend: 'pass-through',
        effects: [], pivot: { x: 0, y: 0 },
    };

    // ---- Motion sampling --------------------------------------------------
    // Per-node motion (velocity/direction/speed/angular/scale) is sampled once
    // per frame from ellapse() (see its call site) as a backward difference
    // against the previous frame. Sampling every advanced frame — not just
    // rendered ones — is what keeps velocity correct through a scrub/rewind,
    // which advances through frames without rendering them. Because ellapse()
    // runs before the frame's generator.next(), x/y here hold the *previous*
    // frame's value, so the velocity trails the rendered position by one frame;
    // the lag is constant and identical forward vs. scrub. Layout-dependent
    // fields (rects) can't be resolved here — layout hasn't run for advanced-
    // but-unrendered frames — so renderState() fills those in at draw time,
    // leaving the motion fields untouched.

    /** Rolling history for the backward-difference velocity estimate. Allocated once (not per frame); mutated in place by {@link _sampleMotion}. */
    private readonly _motionHistory: MotionHistory = createMotionHistory();

    /** Reused per-node state handed to `ctx.begin()` (mirrors `_transformScratch`). */
    private readonly _renderState: NodeRenderState = {
        id: this.id,
        rects: {},
        elapsed: 0,
        dt: 0,
        velocity: { x: 0, y: 0 },
        direction: 0,
        speed: 0,
        angularVelocity: 0,
        scaleVelocity: 0,
    };

    /**
     * Compute this frame's motion (velocity/direction/speed/angular/scale) into
     * {@link _renderState} as a backward difference against the previous frame,
     * and roll the history forward. Velocity is `0`/`{0,0}` when no trustworthy
     * delta exists — the first frame, or after a non-monotonic time jump (only
     * `0 < dt <= MAX` is trusted, so a scrub that resets the clock reads as
     * "unknown" rather than a spurious huge velocity). The world position
     * matches {@link applyTransform} (`layoutBounds + x`, `layoutBounds - y`,
     * y-down). Called via {@link _sample} every frame; layout-dependent fields
     * (`rects`/`elapsed`) are filled in by {@link renderState} at draw time.
     */
    protected _sampleMotion(): void {
        // Resolve the reactive world position (y-down, matching applyTransform);
        // the backward-difference math lives in sampleMotion (no per-frame alloc).
        const r = this.layoutBounds;
        const o = this._offset();
        const x = (r?.x ?? 0) + o.x;
        const y = (r?.y ?? 0) - o.y;
        sampleMotion(this._renderState, this._motionHistory, x, y, this.rotation, this.scale, this._time.total);
    }

    /**
     * Push this node's transform (position, scale, rotate, opacity, effects).
     *
     * The decomposed fields are the whole story for a node in its own plane, and
     * that path is untouched: the backend translates, rotates and scales exactly
     * as it always has. A node that mirrors or tilts hands over a precomposed
     * {@link TransformState.matrix} instead, built by the same `localMatrix`
     * {@link _localMatrix} calls — with the out-of-plane half switched on.
     *
     * **This is the one place that half is applied.** The mirrors and the tilt
     * are paint, not geometry: the node goes on measuring and hit-testing as the
     * upright rectangle it was, and only what is drawn is projected. See
     * {@link _localMatrix} for why.
     */
    protected applyTransform(ctx: RenderContext2D): void {
        const r = this.layoutBounds;
        const s = this._transformScratch;
        const { x: ox, y: oy } = this._offset();
        s.x = (r?.x ?? 0) + ox;
        s.y = (r?.y ?? 0) - oy;
        s.width = r?.width ?? 0;
        s.height = r?.height ?? 0;
        s.scale = this.scale;
        s.rotation = this.rotation;
        s.opacity = this.opacity;
        s.blend = this.blend;
        s.effects = this.effects as NodeEffect[];
        s.pivot = this._transformOrigin();
        const slotOpacity = this._placement()?.opacity;
        if (slotOpacity !== undefined) s.opacity *= slotOpacity;
        const frame = this._spaceFrame;
        const slot = frame ? null : this._slotMatrix(true);
        if (frame) {
            s.matrix = frame.local;
        } else if (slot) {
            s.matrix = multiply(slot, localMatrix(
                ox, -oy, s.rotation, s.scale, s.pivot, s.width, s.height, this._projection(),
            ));
        } else {
            const projection = this._projection();
            s.matrix = hasProjection3D(projection)
                ? localMatrix(s.x, s.y, s.rotation, s.scale, s.pivot, s.width, s.height, projection)
                : undefined;
        }
        ctx.transform(s);
    }

    /** What the node paints under its children, between the transform push and the children render: the root's fill. */
    protected renderSelf(ctx: RenderContext2D): void { }

    /** What the node paints over its children, clipped to its silhouette: the root's overlay. */
    protected renderOverlay(ctx: RenderContext2D): void { }

    /**
     * This node's outline as a {@link Clip}: the boundary `clip` confines its
     * children to, and the silhouette its backdrop effects are confined to.
     * `null` (the default) is no outline, so its children render unclipped and
     * it gets no backdrop effects. A component answers with the shape its
     * `render` paints.
     */
    protected clipSelf(): Clip | null { return null; }

    /**
     * The camera scope this node pushes around its **children** (`beginCamera`),
     * or `null` when it pushes none. Only {@link Canvas2D} and a component whose
     * `render` opens a camera answer, each non-null exactly when it actually
     * opens one — so a consumer can reproduce the renderer's transform *and* its
     * viewport clip without knowing which types have a camera.
     *
     * Read by `runtime/node-picking.ts`: a camera is applied at render time only,
     * so it is not part of {@link worldMatrix}, and a node's on-screen box would
     * be offset without it. `@internal`.
     */
    /** @internal */
    _cameraScope(): CameraScope | null { return null; }

    /**
     * The camera this node opens a 2.5D space with, or `null` when it opens none.
     * Only a space root overrides it: its children, and theirs, are then placed
     * in one 3D frame and seen through this camera. See `node-space.ts`.
     */
    /** @internal */
    _spaceCamera(): SpaceCamera | null { return null; }

    /**
     * Whether this node hands its children on into the space it sits in. False
     * for a node that composites its children itself — a mask, a boolean, a
     * nested camera — which flattens its subtree into its own plane, where the
     * per-node 3D rules apply again. Picking reads it; the renderer gets the same
     * answer because such a node never reaches the base {@link renderChildren}.
     */
    /** @internal */
    _rendersChildrenInSpace(): boolean { return true; }

    /** @internal Set by the parent for the length of this node's render while it is inside a space. */
    _spaceFrame: SpaceFrame | null = null;

    /**
     * Whether the renderer confines this node's children to its own box — either
     * because `clip` is set *and* the node has an outline to clip to (a bare
     * `clip` with no {@link clipSelf} is a no-op, see {@link applyClip}), or
     * because it opens a camera scope, which clips to the viewport rect.
     *
     * Read by `runtime/node-picking.ts`: a point outside a confining node cannot
     * hit anything inside it, so the whole subtree is skipped. `@internal`.
     */
    /** @internal */
    _confinesChildren(): boolean {
        if (this._cameraScope() !== null) return true;
        if (!this.clip) return false;
        const clip = this.clipSelf();
        return clip !== null && !clip.isEmpty();
    }

    /**
     * Whether `local` — a point in this node's local space (centred on the node,
     * y-up, rotation and scale already removed) — is inside the node, within
     * `tolerance` scene units of its edge.
     *
     * The default is the layout box, which is the right answer for containers,
     * text, and media: their box *is* their extent. A component narrows it to
     * the outline its `render` paints.
     *
     * `tolerance` is grab-slop, applied outward. An editor passes its
     * zoom-corrected pixel slop so the grab area stays constant on screen
     * regardless of preview zoom.
     */
    protected hitTestSelf(local: Vector2, tolerance: number): boolean {
        const b = this._localBounds();
        return Math.abs(local.x - b.x) <= b.width / 2 + tolerance
            && Math.abs(local.y - b.y) <= b.height / 2 + tolerance;
    }

    /**
     * The extent of this node's ink in its own local space — what an editor draws
     * a selection box around, and the region the default {@link hitTestSelf}
     * grabs.
     *
     * The returned {@link BoxBounds} is **y-up and relative to the node's own
     * centre**: `x`/`y` are where the ink's centre sits relative to the node,
     * normally `(0, 0)`. That is a different space from `layoutBounds`, which is
     * the same type but canvas y-down and relative to the parent — see
     * `BoxBounds`, which deliberately does not encode a space.
     *
     * Defaults to the layout box, centred on the node, which is right for every
     * node whose drawing fills its cell. It is a separate seam from the layout
     * rect because for some nodes the two genuinely differ: a boolean group or
     * a mask is drawn where its children's ink is, which can be both a different
     * size *and* off-centre from its own cell. A component's `bounds` answers
     * here, fixing the box and the grab region together without perturbing layout.
     */
    /** @internal */
    _localBounds(): BoxBounds {
        return { x: 0, y: 0, width: this.measuredWidth, height: this.measuredHeight };
    }

    /** @internal Dispatch seam so `node-picking.ts` can reach the protected override. */
    _hitTestSelf(local: Vector2, tolerance: number): boolean {
        return this.hitTestSelf(local, tolerance);
    }

    /**
     * Open `clipSelf()`'s outline as a clip scope, confining whatever is drawn
     * until the matching `ctx.endClip()` to the shape. Returns `true` when a
     * clip was actually opened (so the caller knows to close it) and `false`
     * when the node has no outline (the default).
     */
    protected applyClip(ctx: RenderContext2D): boolean {
        const clip = this.clipSelf();
        if (!clip || clip.isEmpty()) return false;
        ctx.beginClip(clip);
        return true;
    }

    /**
     * Apply backdrop effects (any `mode: "backdrop"` effect — blur, grayscale, …;
     * plus magnify and backdrop shader) beneath this node, clipped to its
     * silhouette, before the node's own content is drawn — so the content
     * underneath is filtered/warped while the node's own edges stay sharp. One
     * backdrop effect scope, confined to the silhouette clip, runs the lot; the
     * renderer routes each effect to a filter or shader pass. A no-op for nodes
     * without a {@link clipSelf} outline (there's no silhouette to confine to).
     */
    private applyBackdropEffects(ctx: RenderContext2D): void {
        const effects = this.effects as NodeEffect[];
        // Bail before building the silhouette. `applyBackdropEffectsImpl` returns
        // immediately when there are no backdrop effects, but by then `clipSelf()`
        // has already allocated a Clip and its op list for a node that will never
        // use it — and a node with no effects at all is the overwhelmingly common
        // case, so that allocation was pure waste on nearly every node, every frame.
        if (effects.length === 0) return;
        applyBackdropEffectsImpl(ctx, effects, this.clipSelf(), this.layoutBounds?.width ?? 0, this.layoutBounds?.height ?? 0);
    }

    /**
     * Run `body` (this node's own painting + children) inside the node's effect
     * scopes, so effects behave identically however a node draws. The caller
     * has already pushed the node's transform ({@link applyTransform}).
     * Outermost-first: {@link applyBackdropEffects} beneath the node, confined
     * to its {@link clipSelf} silhouette, then a `foreground` effect scope
     * capturing everything `body` paints.
     */
    protected renderContentWithEffects(ctx: RenderContext2D, body: () => void): void {
        this.applyBackdropEffects(ctx);
        applyContentEffectScope(ctx, this.effects as NodeEffect[], this.layoutBounds?.width ?? 0, this.layoutBounds?.height ?? 0, body);
    }

    protected renderChildren(ctx: RenderPass2D): void {
        // A node opening a space of its own flattens its subtree into its own
        // plane, whatever space it sits in — the same answer picking's
        // `spaceFrameOf` gives, which asks for a camera before anything else.
        const camera = this._spaceCamera();
        if (camera) {
            this._renderInSpace(ctx, spaceRootFrame(this, camera));
            return;
        }
        const frame = this._spaceFrame;
        if (frame) {
            this._renderInSpace(ctx, frame);
            return;
        }
        for (const child of this._children) if (child instanceof Node2D) child.render(ctx);
    }

    /**
     * Paint the children placed in `frame`, far to near rather than in authored
     * order — each with its frame set for exactly the length of its own render,
     * so a node reached any other way (a mask's children, a `Tex.surface`
     * source) draws flat.
     */
    /** @internal A space root opens its space through this. */
    protected _renderInSpace(ctx: RenderPass2D, frame: SpaceFrame): void {
        const children: Node2D[] = [];
        for (const child of this._children) if (child instanceof Node2D) children.push(child);
        const frames = children.map((child) => spaceChildFrame(frame, child));
        // Order is invisible to a walk that only discovers assets.
        const order = ctx.drawsVisibleOnly ? spaceChildOrder(frames) : frames.map((_, i) => i);
        for (const i of order) {
            const child = children[i];
            child._spaceFrame = frames[i];
            try {
                child.render(ctx);
            } finally {
                child._spaceFrame = null;
            }
        }
    }

    /** Run `paint` confined to `cut` — the part of the node in front of the lens — when there is one. */
    private _paintInFront(ctx: RenderContext2D, cut: Clip | null, paint: () => void): void {
        if (!cut) {
            paint();
            return;
        }
        ctx.beginClip(cut);
        try {
            paint();
        } finally {
            ctx.endClip();
        }
    }

    /**
     * This node's per-frame render state, resolved for the scope {@link render}
     * is about to open.
     *
     * Motion was already sampled when the clock advanced; only the
     * layout-dependent fields are filled in here, where layout is current.
     */
    private renderState(ctx: RenderContext2D): NodeRenderState {
        const s = this._renderState;
        // Skipped for contexts that never resolve a `space:'parent'` fill — the
        // precomp pass walks every node's render every frame purely to discover
        // assets, and this is an object allocation per node per frame that nothing
        // there would ever read.
        s.rects = ctx.readsSpaceRects ? this._spaceRects() : NO_SPACE_RECTS;
        s.elapsed = this._time.elapsed;
        return s;
    }

    /**
     * Reference rects for fills with `space:'parent'`, expressed in this node's
     * local space (origin = this node's positioned centre, y-down to match the
     * canvas). The viewport (`space:'global'`) is resolved by the renderer, which
     * knows the surface size. Rotation/scale of this node are not folded in —
     * the rect is the axis-aligned parent box, which is what gradients expect.
     */
    protected _spaceRects(): SpaceRects {
        const o = this._offset();
        return computeSpaceRects(this.parent2D?.layoutBounds, this.layoutBounds, o.x, o.y);
    }

    /**
     * Draw this node and its subtree: the skip checks, then this node's draw
     * scope around {@link renderContent}.
     *
     * Takes a {@link RenderPass2D} rather than a bare {@link RenderContext2D}
     * because opening this node's draw scope is *this* method's job; what it
     * calls is handed the narrower surface, so nothing below can open one.
     */
    render(ctx: RenderPass2D): void {
        // Not in the tree ⇒ no box, no surface, nothing to draw.
        if (!this.mounted) return;
        // A subtree at zero opacity paints nothing, so on a context that only
        // draws what can be seen there is no reason to walk it. Not a niche case:
        // a chart carries a full second axis at `opacity: 0` purely to reserve a
        // gutter, and every cross-fade spends its first and last frames here.
        //
        // `drawsVisibleOnly` is false on the tracking walk, which must still
        // descend — an invisible node's font and images have to be discovered or
        // they will not have loaded by the time it fades in. See the flag's doc.
        if (ctx.drawsVisibleOnly && this.opacity * (this._placement()?.opacity ?? 1) <= 0) return;
        // Hidden by the editor. Same exemption as the two checks around it: the
        // tracking walk still descends, or a node hidden and shown again would
        // come back before its fonts and images had been discovered.
        if (ctx.drawsVisibleOnly && this.hidden) return;
        // A node that has turned past edge-on and declines to show its back
        // paints nothing either — same reasoning, same walk skipped, and the same
        // exemption for the tracking pass, which still has to discover the assets
        // of a card that is currently face-down and will be face-up in a moment.
        // In a space the camera decides which way a node faces, not its own tilt.
        const frame = this._spaceFrame;
        if (ctx.drawsVisibleOnly && !this.backfaceVisible && this._facesAway(frame)) return;
        // Edge-on or behind the lens, a node whose children lie in its own plane
        // has nothing anywhere to show.
        if (ctx.drawsVisibleOnly && frame && !frame.paints && !this._rendersChildrenInSpace()) return;

        try {
            ctx.begin(this.renderState(ctx));
            try {
                this.renderContent(ctx);
            } finally {
                ctx.end();
            }
        } catch (error) {
            // The innermost node claims it, so the runtime can learn the segment against the node that drew.
            if (error instanceof AssetNotLoadedError) error.nodeId ??= this.id;
            throw error;
        }
    }

    /**
     * Everything this node paints: its transform, its effect envelope, its own
     * drawing, its children and its overlay. A component's `render` replaces it,
     * keeping every guard {@link render} performs above it.
     */
    protected renderContent(ctx: RenderPass2D): void {
        this.applyTransform(ctx);
        const frame = this._spaceFrame;
        // Edge-on or behind the lens: nothing of its own to draw and no plane to
        // draw it on, but its children are placed by frames of their own.
        if (frame && !frame.paints) {
            this.renderChildren(ctx);
            return;
        }
        const cut = frame?.nearCut ?? null;
        this.renderContentWithEffects(ctx, () => {
            this._paintInFront(ctx, cut, () => this.renderSelf(ctx));
            // Confine children to this node's outline. Built once from clipSelf();
            // skipped when the node has no outline (clipped === false) so the
            // endClip() below stays balanced.
            const clipped = this.clip && this.applyClip(ctx);
            this.renderChildren(ctx);
            if (clipped) ctx.endClip();
            this._paintInFront(ctx, cut, () => this.renderOverlay(ctx));
        });
    }

    /** Whether the node shows its back — to the space's camera when it is in one, else by its own tilt. */
    private _facesAway(frame: SpaceFrame | null): boolean {
        if (frame) return frame.facesAway;
        const p = this._projection();
        return facesAway(p.rotationX, p.rotationY);
    }

    // ---- Layout -----------------------------------------------------------

    /** What {@link measure} hands {@link layoutChildren} within a pass; consumed there. */
    private _flowMeasure: FlowMeasure<Node2D> | null = null;

    /**
     * The content box its children were last placed in, y-down from this
     * node's centre, and the flow that placed them: what {@link _slotFor}
     * answers from. A component's flow layout records it too (`Flow.layout`).
     */
    /** @internal */
    _childSpace: ChildSpace | null = null;
    private _flowWarned = false;

    /**
     * Record this node's allocated bounds without touching children.
     *
     * Compared field by field, because every caller builds a fresh object literal,
     * so identity always differs — including on every frame of a node that is
     * simply sitting still. Skipping the write keeps the object stable for the
     * aliasing reason below.
     */
    protected setLayoutBounds(rect: BoxBounds): void {
        const current = this._layoutBounds.get();
        if (
            current.x === rect.x
            && current.y === rect.y
            && current.width === rect.width
            && current.height === rect.height
        ) return;
        // Stores the *new* object rather than mutating the old one in place:
        // `layoutBounds` is handed out by `get()` to its public reader, to
        // `computeSpaceRects` and to bound anchor computations, and mutating it
        // under them would be an aliasing change none of them could see coming.
        this._layoutBounds.set(rect);
    }

    /**
     * The children this node lays out itself — its 2D children, minus the hidden
     * ones. Every measure and layout pass in a container iterates *this*, not
     * `children`.
     *
     * Returns the live array untouched in the common case, so an ordinary tree
     * allocates nothing per pass.
     */
    flowChildren(): Node2D[] {
        const children = this._children;
        // Only a hidden child — or a 3D child under a `Canvas3D` — can leave the
        // flow, and both are rare enough to be worth checking for before
        // allocating.
        let i = 0;
        for (; i < children.length; i++) {
            const child = children[i];
            if (!(child instanceof Node2D) || child.hidden) break;
        }
        if (i === children.length) return children as Node2D[];
        // A hidden child gives up its cell *and* its gap — `display: none`, not
        // `visibility: hidden`. Leaving the slot would put a hole in a row
        // wherever someone folded a layer away.
        return children.filter((c): c is Node2D => c instanceof Node2D && !c.hidden);
    }

    /**
     * The inset children are laid out within. A node with a stroke to clear adds
     * the part of it that intrudes (see `Paint.inset`).
     */
    effectivePadding(): InsetsResolved {
        return this.padding as InsetsResolved;
    }

    /**
     * How this node arranges its children: centred freeform. The root answers
     * with its own layout props; a component lays its children out with `Flow`.
     */
    protected flowArrangement(): FlowSettings {
        return DEFAULT_FLOW;
    }

    /** Record `rect`, then place the flow children in it — see {@link layoutChildren}. */
    layout(rect: BoxBounds, scope: MeasureContext2D): void {
        this.setLayoutBounds(rect);
        this.layoutChildren(rect, scope);
    }

    /**
     * Place the flow children in `rect`'s content box by {@link flowArrangement}.
     *
     * Reuses what {@link measure} found when the box is the one it measured in —
     * or, on an axis that hugs, exactly what it hugged — and measures again
     * otherwise: a parent laying this node out at a size it did not measure it
     * for would leave the children arranged for the wrong box.
     */
    protected layoutChildren(rect: BoxBounds, scope: MeasureContext2D): void {
        const pending = this._flowMeasure;
        this._flowMeasure = null;
        const inner = insetsOps.insetBounds(rect.width, rect.height, this.effectivePadding());
        const settings = this.flowArrangement();
        this._childSpace = { settings, inner };
        const children = this.flowChildren();
        if (children.length === 0) return;

        const measured = pending && flowOps.reusable(pending, inner)
            ? pending
            : flowOps.measure(settings, children, {
                width: inner.width,
                height: inner.height,
                hugWidth: this.width === "hug",
                hugHeight: this.height === "hug",
            }, scope);

        // The boxes are y-up from the content box's centre; a layout rect is y-down
        // from this node's.
        const boxes = flowOps.place(measured, settings, inner);
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            measured.items[i].layout(
                { x: inner.x + box.x, y: inner.y - box.y, width: box.width, height: box.height },
                scope,
            );
        }

        if (this._flowWarned) return;
        const warning = flowOps.collapsedRun(measured, rect);
        if (warning === null) return;
        this._flowWarned = true;
        console.warn(`[motionscript] "${this.className}" ${warning}`);
    }

    /**
     * Resolve `width`/`height`, measuring the flow children by
     * {@link flowArrangement}: a `'hug'` axis wraps what they come to, plus this
     * node's padding. What it finds is kept for {@link layoutChildren}.
     *
     * Only flow children are measured: a canvas-pinned child is sized against the
     * canvas, so hugging it would shrink-wrap a box this node never contains.
     */
    measure(constraints: SizeConstraints, scope: MeasureContext2D): Partial<Size2D> {
        this.lastMeasure = { constraints, measurer: scope };
        const padding = this.effectivePadding();
        const children = this.flowChildren();
        if (children.length === 0) {
            this._flowMeasure = null;
            return flowOps.size(this, constraints, padding, NO_CONTENT);
        }
        const space = flowOps.contentBox(this, constraints, padding);
        const measured = flowOps.measure(this.flowArrangement(), children, space, scope);
        this._flowMeasure = measured;
        return flowOps.size(this, constraints, padding, measured.hug);
    }

    // ---- Reparenting ------------------------------------------------------

    reparent(args: CommandArgs<{ newParent: Node2D }> & { duration?: undefined }): void;
    reparent(args: CommandArgs<{ newParent: Node2D }> & { duration: number }): Command<Record<string, never>>;
    reparent(args: CommandArgs<{ newParent: Node2D }>): void | Command<Record<string, never>> {
        const newParent = (args.data as { newParent: Node2D }).newParent;
        if (args.duration === undefined) {
            const old = this.parent;
            if (old) old.remove(this);
            newParent.add(this);
            return;
        }
        return reparentAnimated(this, newParent, args.duration, args.easing);
    }

}

declareMembers(Node2D, {
    x: property({ default: 0 }),
    y: property({ default: 0 }),
    width: property({ default: 'fill', tween: sizeInputOps.lerp }),
    height: property({ default: 'fill', tween: sizeInputOps.lerp }),
    scale: property({ default: 1 }),
    rotation: property({ default: 0 }),
    opacity: property({ default: 1 }),
    blend: property({ default: 'pass-through' }),
    effects: effectsProperty(),
    padding: insetsProperty(),
    pivot: alignmentProperty(),
    flipHorizontal: property({ default: false }),
    flipVertical: property({ default: false }),
    rotationX: property({ default: 0 }),
    rotationY: property({ default: 0 }),
    rotationZ: property({ default: 0 }),
    depth: property({ default: 0 }),
    perspective: property({ default: 0, tween: lerpPerspective }),
    backfaceVisible: property({ default: true }),
    transformOrigin: property<Alignment | undefined, Vector2 | undefined>({
        default: undefined,
        // `null` is unset too: a document read back from JSON has no `undefined`.
        mapper: (v) => (v == null ? undefined : alignmentOps.resolve(v)),
        // Tweening *into* an origin from "no origin set" starts where it ends —
        // there is no point to travel from, and snapping to the target's own
        // start is the one reading that isn't an invented one.
        tween: (from, to, t) => alignmentOps.lerp(from ?? to ?? ORIGIN_2D, to ?? ORIGIN_2D, t),
    }),
    clip: property({ default: false }),
    flex: property({ default: 1 }),
    gapScale: property({ default: 1 }),
    column: property({ default: undefined }),
    row: property({ default: undefined }),
    colSpan: property({ default: 1 }),
    rowSpan: property({ default: 1 }),

    moveTo: command({
        args: [
            "x",
            "y",
            { key: "path", kind: "path" },
            { key: "target", kind: "nodeRef" },
            { key: "targetAnchor", kind: "alignment" },
        ],
    }),
    fadeTo: command({ args: ["opacity"] }),
    rotateTo: command({ args: ["rotation"] }),
    scaleTo: command({ args: ["scale"] }),
    layoutTo: command({ args: [{ key: "width", kind: "size" }, { key: "height", kind: "size" }, { key: "padding", kind: "insets" }] }),
    pulse: command({ args: [{ key: "factor", kind: "number", min: 0, step: 0.05, unit: "×", default: 1.2 }] }),
    wiggle: command({
        args: [
            { key: "angle", kind: "number", min: 0, unit: "°", default: 8 },
            { key: "turns", kind: "number", min: 1, step: 1, default: 3 },
        ],
    }),
    effectTo: command({ args: [{ key: "effects", kind: "effects" }] }),
    removeChildAt: command({ args: ["index"] }),
    reparent: command({ args: ["newParent"] }),
});

/** A command's `data` without the arguments a document left out, which arrive as `undefined` and must not be tweened to. */
function _stated<T extends object>(data: T | undefined): Partial<T> {
    const stated: Partial<T> = {};
    for (const key in data) {
        if (data[key] !== undefined) stated[key] = data[key];
    }
    return stated;
}

/** The 2D node `id` names anywhere in the tree `from` is in, or `null`. */
export function findNode2D(from: Node, id: string): Node2D | null {
    let root = from;
    while (root.parent) root = root.parent;
    return findUnder(root, id);
}

function findUnder(at: Node, id: string): Node2D | null {
    if (at.id === id) return at instanceof Node2D ? at : null;
    for (const child of at._allChildren) {
        const found = findUnder(child, id);
        if (found) return found;
    }
    return null;
}

/**
 * Where `node`'s frame sits in `host`'s, wherever each is in the tree: its
 * centre as an offset (y-up) from `host`'s, and its turn and scale relative to it.
 */
export function frameIn(host: Node2D, node: Node2D): Vector2 & Pick<WorldTransform, "rotation" | "scale"> {
    const there = node.global;
    const here = host.global;
    const inverse = here.scale === 0 ? 0 : 1 / here.scale;
    const offset = rotateOffset(0, 0, -here.rotation, (there.x - here.x) * inverse, (there.y - here.y) * inverse);
    return { x: offset.x, y: offset.y, rotation: there.rotation - here.rotation, scale: there.scale * inverse };
}
