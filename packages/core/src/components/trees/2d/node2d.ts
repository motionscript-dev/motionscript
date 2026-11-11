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

/** Shared empty stand-in when the context never reads reference rects; the shape `computeSpaceRects` returns for a parentless node. */
const NO_SPACE_RECTS: SpaceRects = {};

/** The node centre in the normalised `[-1, 1]` alignment space — `pivot`'s own default. */
const ORIGIN_2D: Vector2 = { x: 0, y: 0 };

/**
 * A slot's turn, size, tilt, depth and fade in a parent's arrangement (a ring of cards, tiles on a
 * sphere). Applied about the box centre and before the child's own transform, so the child's
 * `x`/`y`/`rotation`/`scale` and their commands stay relative to the slot. Answered by the parent
 * ({@link Node2D._placementOf}) rather than stored on the child, so a reparented child can't carry a stale slot.
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
 * A parent's own coordinates for where its children sit (graph units, say). Position only: a child
 * keeps its size, turn and scale. Answered by the parent ({@link Node2D._planeOf}), like a slot.
 */
export interface ChildPlane {
    /** A child's `x`/`y` as a pixel offset, y-up, from the centre of its layout box. */
    toOffset(x: number, y: number): Vector2;
    toCoords(x: number, y: number): Vector2;
}

/**
 * A point an editor can drag to set one of the node's `Vector2` props. `at` is in the node's own
 * frame, y-up from its origin, the frame {@link Node2D._localBounds} is in.
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

export { Node } from "@/components/trees/node/node";
export type { NodeChildren, NodeConfig, NodeMetadata, NodeDimension, NodeProps } from "@/components/trees/node/node";
export type { WorldTransform } from "@/attributes/layout/world-transform";
export type { PropInput, PropInputs } from "@/attributes/properties/inputs";

/** @internal */
export interface CameraScope {
    /** World point (y-up) the viewport centres on — what the camera is aimed at. */
    lookAt: Vector2;
    zoom: number;
    /** Viewport rotation in degrees; the renderer applies it as `rotate(-heading)`. */
    heading: number;
}

export interface Node2DProps extends NodeProps {
    x: number; // 0 is center, negative is left, positive is right
    y: number; // 0 is center, negative is down, positive is up
    width: SizeInput;
    height: SizeInput;
    /** Weight `[0, 1]` for the gap this child contributes to its parent's flex run; collapse a child without the gap popping. */
    gapScale: number;
    /** Sugar for `width` and `height`; an explicit `width` or `height` wins (`{ size: 200, width: 100 }` is 100 by 200). */
    size: SizeInput;
    scale: number;
    rotation: number;
    opacity: number;
    /** Layer blend mode. `'pass-through'` (default) does not isolate the node — its opacity scales each child/fill while they blend against the backdrop. Any other mode isolates the node and blends its flattened result against the backdrop. */
    blend: NodeBlendMode;
    effects: Effect;
    padding: Insets;
    /** When true, content drawn outside this node's outline is clipped away (see {@link Node2D.clipSelf}). */
    clip: boolean;
    /**
     * Pivot for rotation and scale: a named alignment (`'center'`, `'topRight'`, ...) or a normalised
     * {@link Vector2} (`(0,0)` centre, `(-1,1)` top-left). Set automatically when an alignment positioning prop is used.
     */
    pivot: Alignment;

    // Mirrors and the third dimension: the CSS transform functions that still apply to a flat plane.
    // `rotation` supplies the Z axis (see `transform3D`); every one turns about `pivot`, or `transformOrigin` where set.

    /** Mirror across the vertical centre line (CSS `scaleX(-1)`); the box and layout don't move. */
    flipHorizontal: boolean;
    /** Mirror across the horizontal centre line — CSS's `scaleY(-1)`. See {@link flipHorizontal}. */
    flipVertical: boolean;
    /** Tilt about the horizontal axis, in **degrees**. Positive tips the top edge away from the viewer. */
    rotationX: number;
    /** Tilt about the vertical axis, in **degrees**. Positive swings the right edge away from the viewer. */
    rotationY: number;
    /**
     * In-plane rotation of the 3D transform, degrees clockwise. Independent of {@link rotation}, which
     * turns the node's shape (box and selection outline); this is paint-only and spins the picture inside a
     * box that stays put. They add.
     */
    rotationZ: number;
    /** Push along the view axis, px (CSS `translateZ`); positive is toward the viewer. Inert without {@link perspective}. */
    depth: number;
    /**
     * Distance from the viewer to the node's plane, px. `0` (default) is a parallel projection: a tilt
     * squashes evenly instead of receding. Smaller is more dramatic (~800-1500 reads like a page on a desk).
     * Per node, not inherited as in CSS: a scene graph has no viewport element, and a node carrying its own
     * can be nested and animated without its depth depending on where it was dropped.
     */
    perspective: number;
    /** Whether the node paints once turned past edge-on (CSS `backface-visibility`, default visible); `false` gives the card flip. Decided by tilt alone (see `facesAway`), so {@link flipHorizontal} doesn't hide it. */
    backfaceVisible: boolean;
    /** Origin every rotation, scale and mirror turns about (CSS `transform-origin`), same vocabulary as {@link pivot}. Unset it is the pivot; set it wins for the whole transform, so there is one origin as in CSS. */
    transformOrigin: Alignment;
    /** The 3D props in one bag: construction sugar expanded into the individual props before anything reads them, like {@link size}. Its `rotationZ` is not {@link rotation}. */
    transform3D: NodeTransform3D;

    // Alignment positioning: any one of these, instead of or beside x/y, offsets the node so the alignment
    // lands at the scene-space point. Callbacks re-evaluate when the value or this node's layout changes.
    center: Vector2 | (() => Vector2);
    topLeft: Vector2 | (() => Vector2);
    topRight: Vector2 | (() => Vector2);
    bottomLeft: Vector2 | (() => Vector2);
    bottomRight: Vector2 | (() => Vector2);
    topCenter: Vector2 | (() => Vector2);
    bottomCenter: Vector2 | (() => Vector2);
    centerLeft: Vector2 | (() => Vector2);
    centerRight: Vector2 | (() => Vector2);

    /** Share of free main-axis space relative to sibling `fill` children (Flutter's `Expanded(flex:)`), default 1. Setting it without `width`/`height` defaults both to `'fill'`. */
    flex: number;

    // Grid placement, read only by a parent whose `flow` is 'grid'.
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
 * The 2D tree's base: what every `component2d` lowers onto, and the scene root ({@link Canvas2D}).
 * Props are {@link PropSlot}-backed (a value or a thunk); `to()` returns a {@link Command}; `measure()`
 * runs top-down, then `layout()` places the node and its children.
 */
export class Node2D<P extends Node2DProps = Node2DProps> extends Node<P> {
    get dimension(): NodeDimension { return "2d"; }

    /** Null only for a detached node or the root; the base tree holds both dimensions, so this is typed rather than cast. */
    protected get parent2D(): Node2D | null {
        const parent = this._parent;
        return parent instanceof Node2D ? parent : null;
    }

    /** Narrowed to the 2D tree: only a `Node2D` can adopt a `Node2D` (see {@link Node.acceptsChild}). */
    override get parent(): Node2D | null {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this.parent2D;
    }

    /** Children in the 2D tree. `Canvas3D` also holds `Node3D` children outside it (reached through its own accessor); otherwise the live array is returned uncopied. */
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

        // Expand the `size`/`transform3D` sugar in place, so the `_props` object `super()` kept carries the expanded values.
        if (props) {
            size2DOps.expand(props as Record<string, unknown>);
            expandTransform3D(props as Record<string, unknown>);
        }

        // Deferred from `super()`: the cells these props write into are this class's own fields, which only initialize after `super()` returns.
        this.initProps(props);

        // `flex` signals intent to fill the main axis, so an unset width/height defaults to 'fill' and skips the has-children default.
        if (props && (props as any).flex !== undefined) {
            if (props.width === undefined) this.applyProp("width", "fill", { tween: sizeInputOps.lerp });
            if (props.height === undefined) this.applyProp("height", "fill", { tween: sizeInputOps.lerp });
        } else {
            this.applyDefaultSize(props);
        }

        // Alignment positioning: validate, derive pivot, bind x/y reactively (the `to()` path uses the one-shot form).
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

    override set(props: { [K in keyof P]?: P[K] | (() => P[K]) }): void {
        // `size` has no slot; write it to width/height (explicit width/height in the same call wins).
        const sizeVal = (props as any).size;
        // `transform3D` is expanded up front so the generic loop writes its fields; only the rare object case allocates.
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

    override _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        // Expand the sugar before anchor validation and per-key tween setup see it.
        size2DOps.expand(to as Record<string, unknown>);
        expandTransform3D(to as Record<string, unknown>);

        // `pivot` is a transient origin for this step's rotation and scale (the object-form option of
        // moveTo/rotateTo/scaleTo, or a bare `to()` key). Not a prop, so strip it before anything else sees it.
        const explicitPivot = (to as { pivot?: Alignment }).pivot;
        if (explicitPivot !== undefined) delete (to as { pivot?: Alignment }).pivot;

        alignmentOps.validateProps(to as Record<string, unknown>);

        // An alignment key in the target resolves to x/y targets plus a transform origin (one-shot alignmentOps math).
        const alignmentKey = alignmentOps.findKey(to as Record<string, unknown>);
        if (alignmentKey) {
            const raw = (to as any)[alignmentKey] as Vector2;
            const { pivot, x, y } = alignmentOps.resolveTargetOnce(alignmentKey, this._layoutBounds.get(), raw);
            // Written to `transformOrigin`, not `pivot`: `pivot` is the node's permanent origin, set at construction,
            // and a tween's alignment must not re-point later rotations. An explicit step `pivot` overrides the
            // alignment-derived value: where a position is stated against and where a rotation turns are separate questions.
            this._writeProp('transformOrigin', explicitPivot !== undefined ? alignmentOps.resolve(explicitPivot) : pivot);
            (to as any).x = x;
            (to as any).y = y;
        } else if (explicitPivot !== undefined) {
            this._writeProp('transformOrigin', alignmentOps.resolve(explicitPivot));
        }

        return super._prepareStep(to, duration, easing);
    }

    /** Effects are the only assets a bare node declares; component paint entries declare their own. */
    override declareAssets(assets: AssetScope): void {
        assets.effects(this.effects as NodeEffect[]);
    }

    override _sample(): void {
        this._sampleMotion();
    }

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

    // Mirrors and the third dimension (see Node2DProps). Angles and depth tween like x/y; booleans snap at the end of a
    // tween; `perspective` tweens in reciprocal space ({@link lerpPerspective}).

    declare flipHorizontal: boolean;
    declare flipVertical: boolean;
    declare rotationX: number;
    declare rotationY: number;
    /** The 3D block's in-plane rotation, degrees — distinct from {@link rotation}. See {@link Node2DProps.rotationZ}. */
    declare rotationZ: number;
    declare depth: number;
    /** Tweened in reciprocal space ({@link lerpPerspective}): the projection varies with `1/perspective`, so a linear lerp flashes a near-degenerate projection at the start of a `0 -> n` tween. */
    declare perspective: number;
    declare backfaceVisible: boolean;
    /**
     * `undefined` means "follow the pivot", which no default could say since every alignment is a real point.
     * Hence a plain `property`, not `alignmentProperty()` (which folds a missing default to `'center'`).
     */
    declare transformOrigin: Alignment | undefined;

    /** When true, content drawn by this node's children is clipped to its outline (see {@link clipSelf}). */
    declare clip: boolean;

    declare flex: number;
    /** Flex gap weight `[0, 1]`, default 1. The animated `addChildAt`/`removeChildAt` drive it so the gap opens and closes with the child's box (see {@link addChildAtAnimated}); settable so a host can collapse a child in place. */
    declare gapScale: number;
    declare column: number | undefined;
    declare row: number | undefined;
    declare colSpan: number;
    declare rowSpan: number;

    private readonly _layoutBounds = new PropSlot<BoxBounds>({ x: 0, y: 0, width: 0, height: 0 }, this, LAYOUT_SLOT);

    /**
     * Limits and measurer from the last {@link measure} pass, so off-tree work (the animated child-insert in
     * `node-lifecycle.ts`) can size a detached hug child without shifting siblings. Undefined until measured.
     *
     * @internal
     */
    lastMeasure?: { constraints: SizeConstraints; measurer: MeasureContext2D };

    /** The box the last layout pass allocated: size, and position in the parent's space (canvas y-down). Reactive. Written only via {@link setLayoutBounds}, where the layout invariants live. */
    get layoutBounds(): BoxBounds { return this._layoutBounds.get(); }

    /** {@link flattenChildrenProp} narrowed to children that take part in 2D layout (not 3D or audio). */
    protected static flowChildrenProp(props: { children?: unknown } | undefined): Node2D[] {
        return Node2D.flattenChildrenProp(props).filter((c): c is Node2D => c instanceof Node2D);
    }

    /** True if any child requests `"fill"` on `axis`, so a size default can avoid hugging a child that would have nothing to fill. */
    protected static hasFillChild(children: Node2D[], axis: "width" | "height"): boolean {
        return children.some((c) => (axis === "width" ? c.width : c.height) === "fill");
    }

    /** Hug when given children, fill when empty. Skipped when `flex` is set (implies `'fill'`); `component2d` replaces it with the component rule. */
    protected applyDefaultSize(props?: NodeConfig<any, P>): void {
        const hasChildren = Node2D.flowChildrenProp(props).length > 0;
        const defaultSize = hasChildren ? "hug" : "fill";
        if (!props || props.width === undefined) this.applyProp("width", defaultSize, { tween: sizeInputOps.lerp });
        if (!props || props.height === undefined) this.applyProp("height", defaultSize, { tween: sizeInputOps.lerp });
    }

    // Each helper returns its `Command` unwrapped: a `Command` can be evaluated at a time, anything that only advances can't.

    /**
     * Animate `x`/`y` to a position, along `path`, or onto another node. `pivot` sets
     * {@link Node2DProps.transformOrigin} (carried forward until restated), not the permanent {@link pivot}.
     *
     * `path` or `target` replaces the `x`/`y` destination (stating both is an error). A path is walked by arc
     * length and its coordinates are `x`/`y` values in the library-wide y-up space. `target` is a node id and
     * `targetAnchor` the point of its box (centre when absent), resolved when the command is built; an absent
     * target leaves the node in place. With both, the path is turned and scaled about its start until its end lands on the target.
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

    fadeTo(args: CommandArgs<{ opacity: number }> & { duration: number }): Command<P> {
        return this.to({ data: args.data as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** Animate `rotation` (degrees, clockwise); `pivot` behaves as in {@link moveTo}. */
    rotateTo(args: CommandArgs<{ rotation: number; pivot?: Alignment }> & { duration: number }): Command<P> {
        return this.to({ data: args.data as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** Animate `scale`; `pivot` behaves as in {@link moveTo}. */
    scaleTo(args: CommandArgs<{ scale: number; pivot?: Alignment }> & { duration: number }): Command<P> {
        return this.to({ data: args.data as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** Animate `width`, `height` and `padding`, whichever are given. A size keyword (`'fill'`, `'hug'`) snaps; a number interpolates. */
    layoutTo(args: CommandArgs<{ width?: SizeInput; height?: SizeInput; padding?: Insets }> & { duration: number }): Command<P> {
        return this.to({ data: _stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    /** Swell to `factor` times the size and settle back; ends as it began. */
    pulse(args: CommandArgs<{ factor?: number }> & { duration: number }): Command<P> {
        const rest = this.scale;
        const factor = args.data?.factor ?? 1.2;
        return this.command<P>(
            (t) => ({ scale: rest * (1 + (factor - 1) * Math.sin(Math.PI * t)) }) as Partial<P>,
            args.duration,
            args.easing,
        );
    }

    /** Rock about the node's own turn, `angle` degrees each way for `turns` swings, building up and dying away; ends as it began. */
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

    effectTo(args: CommandArgs<{ effects: Effect }> & { duration: number }): Command<P> {
        return this.to({ data: _stated(args.data) as Partial<P>, duration: args.duration, easing: args.easing });
    }

    get measuredWidth(): number {
        return this.layoutBounds.width;
    }

    get measuredHeight(): number {
        return this.layoutBounds.height;
    }

    // Alignment points: getters read `layoutBounds` and x/y/rotation, and a bound prop recomputes on every read,
    // so a callback built from them stays current.

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

    // Global (world-space) transform: unlike the parent-relative alignment getters above, these fold in the full
    // ancestor chain. Each read walks live props, so a binding over them stays current.

    /**
     * This node's local transform in canvas (y-down) space; {@link worldMatrix} composes it up the chain, and
     * every world-space reading comes from it ({@link global}, `runtime/node-picking.ts`, editor overlays).
     *
     * Deliberately flat: a node that mirrors or tilts is painted through a projected matrix (see
     * {@link applyTransform}) but measures and hit-tests as its upright rectangle, because handles, outlines and
     * alignment targets mean nothing on a trapezoid (a foreshortened "width" edge, a corner behind the viewer).
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
        // No projection: geometry stays flat while paint does not (see above).
        return localMatrix(
            cx, cy, this.rotation, this.scale, this._transformOrigin(),
            r?.width ?? 0, r?.height ?? 0,
        );
    }

    /** @internal The slot {@link _placementOf} puts this node in, from its parent. */
    _placement(): ChildPlacement | null {
        return this.parent2D?._placementOf(this) ?? null;
    }

    /** The slot this node places `child` in beyond its layout box, or `null` when the box says it all. The renderer, picking and `global` follow it. See {@link ChildPlacement}. */
    /** @internal */
    _placementOf(_child: Node2D): ChildPlacement | null {
        return null;
    }

    /** The coordinates `child`'s `x`/`y` are in, or `null` for pixels. A `null` child asks for a not-yet-added one (where a host would drop or paste it). See {@link ChildPlane}. */
    /** @internal */
    _planeOf(_child: Node2D | null): ChildPlane | null {
        return null;
    }

    /**
     * Where its own layout would centre a not-yet-added child of `size`, y-down from its centre; `null` when it
     * arranges children in a run or grid (the run decides) or has laid none out.
     */
    /** @internal */
    _slotFor(size: Size2D): Vector2 | null {
        const space = this._childSpace;
        const box = space ? flowOps.freeSlot(space.settings, space.inner, size) : null;
        return space && box ? { x: space.inner.x + box.x, y: space.inner.y - box.y } : null;
    }

    /** Where its centre sits from the point `x`/`y` place, in the parent's frame (y-down), at `rotation` and `scale`: what turning about an off-centre pivot adds. */
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

    /** `x`/`y` as the pixel offset the parent sees; every position read goes through here so paint, picking and `global` agree under a {@link ChildPlane}. The result is reused: read it at once. */
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
     * The flat part of this node's slot: the layout box's centre turned and scaled by the slot, or `null` with
     * no slot. With `paint`, also the slot's tilt, which only paint sees.
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

    /** `transformOrigin` where set, else the alignment-derived `pivot`; read by {@link _localMatrix} and {@link applyTransform} alike. */
    private _transformOrigin(): Vector2 {
        return (this.transformOrigin as Vector2 | undefined) ?? (this.pivot as Vector2);
    }

    // Reused like `_transformScratch`: `_localMatrix` runs per ancestor per `global` read, and the Projection3D
    // consumers read it synchronously without retaining it.
    private readonly _projectionScratch: Projection3D = {
        rotationX: 0, rotationY: 0, rotationZ: 0, depth: 0, perspective: 0,
        flipHorizontal: false, flipVertical: false,
    };

    /** Out-of-plane fields for the matrix builders and the backface test. A space root overrides it: its 3D props aim the camera rather than turn the root. */
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

    /** Product of every ancestor's local matrix, root down; walks the live parent chain per call. */
    protected worldMatrix(): Matrix2D {
        const local = this._localMatrix();
        const parent = this.parent2D;
        return parent ? multiply(parent.worldMatrix(), local) : local;
    }

    /**
     * Absolute scene coordinates for the alignment points and metrics, folded through the ancestor chain; every
     * field is reactive. See {@link WorldTransform}.
     *
     * For reading only: `x`/`y` are parent-relative, so landing on `other` under a different parent needs
     * `x: () => other.global.x - myParent.global.x` (a shared parent origin needs no compensation).
     */
    get global(): WorldTransform {
        const r = this.layoutBounds;
        const anchors = worldAnchors(this.worldMatrix(), (r?.width ?? 0) / 2, (r?.height ?? 0) / 2);

        // Rotation sums; scale and opacity multiply, matching the renderer's nested transforms and pass-through alpha fold.
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

    /** The `x`/`y` that put this node on `anchor` of node `id`, or `null` if no such 2D node is here right now. */
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

    // Typed to the shared base because a tree holds both dimensions; the guard rejects a Node3D before it lands where
    // it would never draw. Registered as a command on {@link Node}, which owns the instant insert.
    override addChildAt(args: CommandArgs<{ child: Node; index: number }> & { duration?: undefined }): void;
    override addChildAt(args: CommandArgs<{ child: Node; index: number }> & { duration: number }): Command<Record<string, never>>;
    override addChildAt(args: CommandArgs<{ child: Node; index: number }>): void | Command<Record<string, never>> {
        const { child, index } = args.data as { child: Node; index: number };
        this.assertAcceptsChild(child);
        if (args.duration === undefined) {
            this._insertChildAt(child, index);
            return;
        }
        // Past the guard this is a 2D child; the animated insert measures it off-tree, which only a laid-out node can do.
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

    // Reused per frame so applyTransform doesn't allocate a descriptor per node per frame; ctx.transform reads it synchronously and never retains it.
    private readonly _transformScratch: TransformState = {
        x: 0, y: 0, width: 0, height: 0,
        scale: 1, rotation: 0, opacity: 1, blend: 'pass-through',
        effects: [], pivot: { x: 0, y: 0 },
    };

    // Motion (velocity/direction/speed/angular/scale) is sampled once per frame from ellapse() as a backward
    // difference, on every advanced frame (not just rendered ones) so velocity stays right through a scrub.
    // ellapse() runs before the frame's generator.next(), so x/y hold the previous frame's value: velocity trails
    // the rendered position by one constant frame. Layout-dependent fields (rects) can't resolve here, since layout
    // hasn't run for advanced-but-unrendered frames; renderState() fills them at draw time.

    /** Allocated once; mutated in place by {@link _sampleMotion}. */
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
     * Computes motion into {@link _renderState} as a backward difference against the previous frame, then rolls the
     * history. Velocity is zero when no trustworthy delta exists (first frame, or a non-monotonic time jump: only
     * `0 < dt <= MAX` is trusted, so a scrub doesn't read as a huge velocity). World position matches
     * {@link applyTransform} (y-down).
     */
    protected _sampleMotion(): void {
        // Reactive world position (y-down, as applyTransform); the math lives in sampleMotion (no per-frame alloc).
        const r = this.layoutBounds;
        const o = this._offset();
        const x = (r?.x ?? 0) + o.x;
        const y = (r?.y ?? 0) - o.y;
        sampleMotion(this._renderState, this._motionHistory, x, y, this.rotation, this.scale, this._time.total);
    }

    /**
     * Pushes this node's transform. A node in its own plane passes the decomposed fields; one that mirrors or tilts
     * passes a precomposed {@link TransformState.matrix}. This is the one place the out-of-plane half is applied:
     * mirrors and tilt are paint, not geometry (see {@link _localMatrix}).
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

    /** Outline as a {@link Clip}: confines children when `clip` is set and bounds backdrop effects. `null` (default) is no outline. A component answers with the shape its `render` paints. */
    protected clipSelf(): Clip | null { return null; }

    /**
     * The camera scope pushed around this node's children (`beginCamera`), or `null`; non-null exactly when the node
     * opens one, so a consumer can reproduce the renderer's transform and viewport clip. Read by
     * `runtime/node-picking.ts`: a camera applies at render time only, so it isn't part of {@link worldMatrix}.
     */
    /** @internal */
    _cameraScope(): CameraScope | null { return null; }

    /** The camera this node opens a 2.5D space with, or `null`; only a space root overrides it. See `node-space.ts`. */
    /** @internal */
    _spaceCamera(): SpaceCamera | null { return null; }

    /** Whether children pass on into the space this node sits in. False for a node that composites its children itself (mask, boolean, nested camera), flattening them into its own plane. Picking reads it; the renderer agrees because such a node never reaches the base {@link renderChildren}. */
    /** @internal */
    _rendersChildrenInSpace(): boolean { return true; }

    /** @internal Set by the parent for the length of this node's render while it is inside a space. */
    _spaceFrame: SpaceFrame | null = null;

    /** Whether the renderer confines children to this node's box: `clip` set with an outline to clip to (a bare `clip` without {@link clipSelf} is a no-op, see {@link applyClip}), or a camera scope clipping to the viewport. Picking skips a whole subtree outside a confining node. */
    /** @internal */
    _confinesChildren(): boolean {
        if (this._cameraScope() !== null) return true;
        if (!this.clip) return false;
        const clip = this.clipSelf();
        return clip !== null && !clip.isEmpty();
    }

    /**
     * Whether `local` (node-centred, y-up, rotation and scale removed) is inside the node within `tolerance` scene
     * units of its edge, applied outward as grab-slop (an editor passes a zoom-corrected value). Defaults to the
     * layout box; a component narrows it to the outline its `render` paints.
     */
    protected hitTestSelf(local: Vector2, tolerance: number): boolean {
        const b = this._localBounds();
        return Math.abs(local.x - b.x) <= b.width / 2 + tolerance
            && Math.abs(local.y - b.y) <= b.height / 2 + tolerance;
    }

    /**
     * Extent of the node's ink in its own space, **y-up and relative to the node's centre** (unlike `layoutBounds`,
     * canvas y-down relative to the parent): what an editor boxes and the default {@link hitTestSelf} grabs.
     * Defaults to the layout box. Separate from the layout rect because a boolean group or mask draws where its
     * children's ink is, possibly off-centre; a component's `bounds` answers here without perturbing layout.
     */
    /** @internal */
    _localBounds(): BoxBounds {
        return { x: 0, y: 0, width: this.measuredWidth, height: this.measuredHeight };
    }

    /** @internal Dispatch seam so `node-picking.ts` can reach the protected override. */
    _hitTestSelf(local: Vector2, tolerance: number): boolean {
        return this.hitTestSelf(local, tolerance);
    }

    /** Opens `clipSelf()`'s outline as a clip scope; returns whether one was opened (so the caller closes it). */
    protected applyClip(ctx: RenderContext2D): boolean {
        const clip = this.clipSelf();
        if (!clip || clip.isEmpty()) return false;
        ctx.beginClip(clip);
        return true;
    }

    /** Backdrop effects (blur, magnify, backdrop shader, ...) beneath the node, confined to its silhouette, so content underneath is filtered while the node's own edges stay sharp. One scope runs them all; no-op without a {@link clipSelf} outline. */
    private applyBackdropEffects(ctx: RenderContext2D): void {
        const effects = this.effects as NodeEffect[];
        // Bail before building the silhouette: `clipSelf()` allocates a Clip and op list, and a node with no effects is the overwhelmingly common case.
        if (effects.length === 0) return;
        applyBackdropEffectsImpl(ctx, effects, this.clipSelf(), this.layoutBounds?.width ?? 0, this.layoutBounds?.height ?? 0);
    }

    /** Runs `body` (own painting + children) inside the effect scopes, outermost first: {@link applyBackdropEffects} beneath the node, then a `foreground` scope capturing everything `body` paints. The caller has already pushed {@link applyTransform}. */
    protected renderContentWithEffects(ctx: RenderContext2D, body: () => void): void {
        this.applyBackdropEffects(ctx);
        applyContentEffectScope(ctx, this.effects as NodeEffect[], this.layoutBounds?.width ?? 0, this.layoutBounds?.height ?? 0, body);
    }

    protected renderChildren(ctx: RenderPass2D): void {
        // A node opening its own space flattens its subtree into its own plane, whatever space it sits in (as picking's `spaceFrameOf` does, checking for a camera first).
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

    /** Paints children placed in `frame` far to near, each with its frame set only for its own render, so a node reached any other way (a mask's children, a `Tex.surface` source) draws flat. */
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

    /** Per-frame render state for the scope {@link render} opens. Motion was sampled when the clock advanced; only layout-dependent fields are filled here. */
    private renderState(ctx: RenderContext2D): NodeRenderState {
        const s = this._renderState;
        // Skipped when the context never resolves `space:'parent'` fills: the precomp pass walks every node purely to discover assets, so this would be a per-node per-frame allocation nothing reads.
        s.rects = ctx.readsSpaceRects ? this._spaceRects() : NO_SPACE_RECTS;
        s.elapsed = this._time.elapsed;
        return s;
    }

    /** Reference rects for `space:'parent'` fills, in this node's local space (origin at its positioned centre, y-down). The viewport (`space:'global'`) is the renderer's job. This node's rotation/scale aren't folded in: the rect is the axis-aligned parent box, which gradients expect. */
    protected _spaceRects(): SpaceRects {
        const o = this._offset();
        return computeSpaceRects(this.parent2D?.layoutBounds, this.layoutBounds, o.x, o.y);
    }

    /** Draws this node and its subtree: skip checks, then this node's draw scope around {@link renderContent}. Takes a {@link RenderPass2D} because opening the scope is this method's job; callees get the narrower surface so nothing below can open one. */
    render(ctx: RenderPass2D): void {
        if (!this.mounted) return;
        // A zero-opacity subtree paints nothing, so a visible-only context needn't walk it (a chart's reserved-gutter axis,
        // cross-fades). `drawsVisibleOnly` is false on the tracking walk, which must still descend so an invisible
        // node's fonts and images are discovered before it fades in.
        if (ctx.drawsVisibleOnly && this.opacity * (this._placement()?.opacity ?? 1) <= 0) return;
        // Hidden by the editor; same tracking-walk exemption, so a node hidden then shown has its assets discovered.
        if (ctx.drawsVisibleOnly && this.hidden) return;
        // Past edge-on and declining to show its back paints nothing either (same tracking-walk exemption: a face-down
        // card's assets must still be discovered). In a space the camera decides facing, not the node's own tilt.
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

    /** Everything this node paints: transform, effect envelope, own drawing, children, overlay. A component's `render` replaces it, keeping every guard {@link render} performs above it. */
    protected renderContent(ctx: RenderPass2D): void {
        this.applyTransform(ctx);
        const frame = this._spaceFrame;
        // Edge-on or behind the lens: no plane of its own, but its children are placed by frames of their own.
        if (frame && !frame.paints) {
            this.renderChildren(ctx);
            return;
        }
        const cut = frame?.nearCut ?? null;
        this.renderContentWithEffects(ctx, () => {
            this._paintInFront(ctx, cut, () => this.renderSelf(ctx));
            // Built once from clipSelf(); `clipped` is false with no outline, keeping endClip() balanced.
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

    /** What {@link measure} hands {@link layoutChildren} within a pass; consumed there. */
    private _flowMeasure: FlowMeasure<Node2D> | null = null;

    /** The content box children were last placed in (y-down from this node's centre) and the flow that placed them; what {@link _slotFor} answers from. A component's flow layout records it too (`Flow.layout`). */
    /** @internal */
    _childSpace: ChildSpace | null = null;
    private _flowWarned = false;

    /** Records the allocated bounds without touching children. Compared field by field (callers build fresh literals, so identity always differs, even for a node sitting still) to keep the object stable for the aliasing reason below. */
    protected setLayoutBounds(rect: BoxBounds): void {
        const current = this._layoutBounds.get();
        if (
            current.x === rect.x
            && current.y === rect.y
            && current.width === rect.width
            && current.height === rect.height
        ) return;
        // Stores the new object rather than mutating: `layoutBounds` is handed to its public reader, `computeSpaceRects`
        // and bound anchors, and mutating it would alias under all of them.
        this._layoutBounds.set(rect);
    }

    /** Children this node lays out itself: its 2D children minus hidden ones. Measure and layout iterate this, not `children`. Returns the live array when nothing is filtered, so an ordinary tree allocates nothing per pass. */
    flowChildren(): Node2D[] {
        const children = this._children;
        // Only a hidden child, or a 3D child under a `Canvas3D`, leaves the flow; both rare enough to check before allocating.
        let i = 0;
        for (; i < children.length; i++) {
            const child = children[i];
            if (!(child instanceof Node2D) || child.hidden) break;
        }
        if (i === children.length) return children as Node2D[];
        // A hidden child gives up its cell and its gap (`display: none`, not `visibility: hidden`).
        return children.filter((c): c is Node2D => c instanceof Node2D && !c.hidden);
    }

    /** The inset children are laid out within; a node with a stroke to clear adds the part that intrudes (see `Paint.inset`). */
    effectivePadding(): InsetsResolved {
        return this.padding as InsetsResolved;
    }

    /** Centred freeform by default. The root answers with its layout props; a component lays children out with `Flow`. */
    protected flowArrangement(): FlowSettings {
        return DEFAULT_FLOW;
    }

    layout(rect: BoxBounds, scope: MeasureContext2D): void {
        this.setLayoutBounds(rect);
        this.layoutChildren(rect, scope);
    }

    /** Places flow children in `rect`'s content box by {@link flowArrangement}. Reuses {@link measure}'s result when the box is the one it measured in (or exactly what an axis hugged), else re-measures: a box the node wasn't measured for would leave the children arranged wrong. */
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

        // Boxes are y-up from the content box's centre; a layout rect is y-down from this node's.
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

    /** Resolves `width`/`height`: a `'hug'` axis wraps the flow children (by {@link flowArrangement}) plus padding; the result is kept for {@link layoutChildren}. Only flow children are measured: a canvas-pinned child is sized against the canvas, so hugging it would wrap a box this node never contains. */
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
        // Tweening into an origin from "none" starts where it ends: there is no point to travel from.
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

/** Where `node`'s frame sits in `host`'s: its centre as a y-up offset, and its turn and scale relative to it. */
export function frameIn(host: Node2D, node: Node2D): Vector2 & Pick<WorldTransform, "rotation" | "scale"> {
    const there = node.global;
    const here = host.global;
    const inverse = here.scale === 0 ? 0 : 1 / here.scale;
    const offset = rotateOffset(0, 0, -here.rotation, (there.x - here.x) * inverse, (there.y - here.y) * inverse);
    return { x: offset.x, y: offset.y, rotation: there.rotation - here.rotation, scale: there.scale * inverse };
}
