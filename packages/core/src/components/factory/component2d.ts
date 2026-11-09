import { sizeInputOps } from "@/attributes/layout/size";
import type { FlowMode } from "@/layout/types";
import type { Vector2 } from "@/attributes/layout/vector2";
import { getNodeDescriptor } from "@/document/node-decorator";
import type { BoxBounds } from "@/layout/bounds";
import type { SizeConstraints } from "@/layout/constraints";
import { flowOps } from "@/layout/ops";
import { Node2D, type ChildPlacement, type ChildPlane, type CameraScope, type NodeHandle } from "@/components/trees/2d/node2d";
import type { Clip } from "@/render/clip";
import { containsClip } from "@/render/clip-contains";
import type { Graphics2D } from "@/render/graphics2d";
import type { MeasureContext2D } from "@/render/measure-context";
import type { RenderPass2D } from "@/render/render-context2d";
import type { Allowed, Box2DState, ChildView, Component, Element, LayoutBox, Merge, Placement2D, Spec2D, StateSpec } from "@/components/factory/api";
import { clipOf } from "@/components/factory/clip-of";
import { componentBase, finishComponent, lowering, type CoreSpec } from "@/components/factory/factory";
import {
    childView, MeasurerImpl, RenderContextImpl, setKeyLookup, withPass, takeDecided, type ComponentHost, type Composite,
} from "@/components/factory/views";
import { childInkBounds } from "@/components/trees/2d/group-bounds";
import type { SpaceCamera } from "@/attributes/layout/space3d";
import { NO_PROJECTION_3D, type Projection3D } from "@/attributes/layout/matrix2d";
import type { ChildSpace3D } from "@/components/trees/three/node3d";
import type { Scene3D } from "@/render3d/scene3d";


const NO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };
const SIZE_KEYS = new Set(["width", "height"]);

setKeyLookup((n) => getNodeDescriptor(n.constructor as new () => object)?.key);

type AnySpec = Spec2D<string, any, any, any, any, any>;

function slotOf(p: Placement2D): ChildPlacement | null {
    if (p.rotation === undefined && p.scale === undefined && p.opacity === undefined
        && p.depth === undefined && p.rotationX === undefined && p.rotationY === undefined) return null;
    return {
        rotation: p.rotation ?? 0, scale: p.scale ?? 1, opacity: p.opacity ?? 1,
        depth: p.depth ?? 0, rotationX: p.rotationX ?? 0, rotationY: p.rotationY ?? 0,
    };
}

/**
 * A 2D component: laid out in a box, drawn with `Graphics2D`. Lowers the spec
 * onto a generated `Node2D` subclass, so a registry, a document and a host see
 * an ordinary node type.
 */
export function component2d<
    const K extends string,
    const S extends StateSpec = {},
    const C = {},
    const A extends Allowed = null,
    const B extends Element = never,
>(spec: Spec2D<K, Merge<Box2DState, S>, S, C, A, B>): Component<K, Merge<Box2DState, S>, C, A> {
    const s = spec as unknown as AnySpec;
    const l = lowering(s as unknown as CoreSpec, Node2D, SIZE_KEYS);
    const { defaults } = l;
    const flows = l.entries.has("flow");

    class Generated extends componentBase(Node2D, l) implements ComponentHost {
        _lastShape: Graphics2D | null = null;
        declare _measurer: MeasurerImpl;
        declare _ctx: RenderContextImpl;
        declare _probe: RenderContextImpl | undefined;
        declare _record: Composite | null | undefined;
        declare _slots: Map<Node2D, ChildPlacement> | null;
        declare _planes: Map<Node2D, ChildPlane> | null;
        declare _box: LayoutBox | null;

        constructor(props?: Record<string, unknown>) {
            super(props);
            this._measurer = new MeasurerImpl(this);
            this._ctx = new RenderContextImpl(this);
            this._slots = null;
            this._planes = null;
            this._box = null;
            // A node made of other nodes hugs them, unless told otherwise; `flex` already said fill.
            if (this._built > 0 && props?.flex === undefined) {
                for (const axis of SIZE_KEYS) {
                    if (props?.[axis] === undefined && defaults[axis] === undefined) this.applyProp(axis, "hug", { tween: sizeInputOps.lerp });
                }
            }
        }

        /**
         * Hug what it was given, fill when given nothing, and fill a main axis a
         * child fills, so a hugging parent doesn't leave that child no room: the
         * rule shapes have today. A `defaults` size replaces it.
         */
        protected override applyDefaultSize(props?: Record<string, unknown>): void {
            const given = Node2D.flowChildrenProp(props);
            const flow = (props?.flow as FlowMode | undefined) ?? "freeform";
            // A flow container fills where a child fills, as shapes do; anything else hugs or fills, as `Node2D` does.
            const main = flows
                ? { width: flow !== "vertical", height: flow === "vertical" || flow === "freeform" }
                : { width: false, height: false };
            for (const axis of ["width", "height"] as const) {
                if (props?.[axis] !== undefined) continue;
                const declared = defaults[axis];
                const value = declared !== undefined && typeof declared !== "function" ? declared
                    : given.length === 0 || (main[axis] && Node2D.hasFillChild(given, axis)) ? "fill" : "hug";
                this.applyProp(axis, value, { tween: sizeInputOps.lerp });
            }
        }

        override measure(constraints: SizeConstraints, scope: MeasureContext2D) {
            if (!s.measure) return super.measure(constraints, scope);
            this.lastMeasure = { constraints, measurer: scope };
            const m = this._measurer;
            m.max = { width: constraints.maxWidth, height: constraints.maxHeight };
            m.scope = scope;
            const natural = withPass(this, scope, m.max, () => s.measure!(m, this._view as never, this.flowChildren().map(childView) as never));
            // An engine module may have sized the node itself (text reports its own height even when it fills).
            if (takeDecided(this)) return natural;
            // The engine applies width and height: `hug` keeps the natural size, a number or `fill` replaces it.
            return flowOps.size(this, constraints, NO_INSETS, natural);
        }

        protected override layoutChildren(rect: BoxBounds, scope: MeasureContext2D): void {
            if (!s.layout) return super.layoutChildren(rect, scope);
            const children = this.flowChildren();
            const box: LayoutBox = { x: 0, y: 0, width: rect.width, height: rect.height, time: this.time };
            this._box = box;
            // A layout that places children by `Flow` records where a new one would go; any other leaves none.
            this._childSpace = null;
            const placements = withPass(this, scope, { width: rect.width, height: rect.height },
                () => s.layout!(box, this._view as never, children.map(childView) as never));
            let slots: Map<Node2D, ChildPlacement> | null = null;
            let planes: Map<Node2D, ChildPlane> | null = null;
            placements.forEach((p, i) => {
                const child = children[i];
                if (!child) return;
                child.layout({ x: p.x, y: 0 - p.y, width: p.width, height: p.height }, scope);
                const slot = slotOf(p);
                if (slot) (slots ??= new Map()).set(child, slot);
                if (p.plane) (planes ??= new Map()).set(child, p.plane);
            });
            this._slots = slots;
            this._planes = planes;
        }

        override _placementOf(child: Node2D): ChildPlacement | null {
            return this._slots?.get(child) ?? super._placementOf(child);
        }

        override _planeOf(child: Node2D | null): ChildPlane | null {
            if (child) return this._planes?.get(child) ?? null;
            const box = this._box ?? { x: 0, y: 0, width: this.layoutBounds?.width ?? 0, height: this.layoutBounds?.height ?? 0, time: this.time };
            return s.plane ? s.plane(box, this._view as never) : null;
        }

        protected override renderContent(pass: RenderPass2D): void {
            if (!s.render) return super.renderContent(pass);
            this.applyTransform(pass);
            const frame = this._spaceFrame;
            // Edge-on or behind the lens: nothing of its own to draw, but its children have frames of their own.
            if (frame && !frame.paints) {
                this.renderChildren(pass);
                return;
            }
            const ctx = this._ctx;
            ctx.pass = pass;
            ctx.cut = frame?.nearCut ?? null;
            ctx.composite = null;
            try {
                this.renderContentWithEffects(pass, () => s.render!(ctx, this._view as never));
            } finally {
                ctx.pass = null;
                ctx.cut = null;
                // A render that stopped compositing clears the record; one that composites set it as it went.
                this._record = ctx.composite;
            }
        }

        /** The outline `render` paints now, found by running it with nothing drawn: picking and backdrop effects read it. */
        protected override clipSelf(): Clip | null {
            this._probeRender();
            return this._lastShape ? clipOf(this._lastShape) : null;
        }

        // What `render` does with the children, read from its last run: these are asked every frame,
        // so they never re-run it. Before its first frame, one probe answers.

        /** A composite, or a camera, paints its children into its own plane: none of them stands in a space. */
        override _rendersChildrenInSpace(): boolean {
            const r = this._observed();
            return !(r?.bounds || r?.camera) && super._rendersChildrenInSpace();
        }

        override _localBounds(): BoxBounds {
            const bounds = this._observed()?.bounds;
            return (bounds && childInkBounds(this, bounds)) ?? super._localBounds();
        }

        override _cameraScope(): CameraScope | null {
            return this._observed()?.camera ?? super._cameraScope();
        }

        override _spaceCamera(): SpaceCamera | null {
            return this._observed()?.space ?? super._spaceCamera();
        }

        /** A space's root is the space's frame, not a plane tilted in it. */
        protected override _projection(): Projection3D {
            return this._observed()?.space ? NO_PROJECTION_3D : super._projection();
        }

        /** A render that builds a 3D scene views one: picking projects its 3D children through it. */
        _isViewport3D(): boolean {
            return this._observed()?.scene !== undefined;
        }

        /** The scene `render` builds now, built afresh. */
        _scene3D(): Scene3D | null {
            return this._probeRender()?.scene ?? null;
        }

        _observed(): Composite | null {
            if (this._record === undefined) this._probeRender();
            return this._record ?? null;
        }

        /** Run `render` drawing nothing: the outline it paints, and what it does with the children. */
        _probeRender(): Composite | null {
            if (!s.render) return (this._record = null);
            const probe = (this._probe ??= new RenderContextImpl(this, true));
            this._lastShape = null;
            probe.composite = null;
            s.render(probe, this._view as never);
            return (this._record = probe.composite);
        }

        protected override hitTestSelf(local: Vector2, tolerance: number): boolean {
            const clip = this.clipSelf();
            if (!clip || clip.isEmpty()) return super.hitTestSelf(local, tolerance);
            return containsClip(clip, local, tolerance);
        }

        _renderOwnChildren(pass: RenderPass2D): void {
            this.renderChildren(pass);
        }

        override _commandChildren(): readonly ChildView[] {
            return this.flowChildren().map(childView);
        }
    }

    const proto = Generated.prototype as unknown as Record<string, unknown>;
    if (s.handles) {
        const handles = Object.entries(s.handles);
        const sizeOf = (node: Node2D) => ({ width: node.layoutBounds?.width ?? 0, height: node.layoutBounds?.height ?? 0 });
        proto._handles = function (this: Generated): readonly NodeHandle[] {
            const out: NodeHandle[] = [];
            for (const [prop, handle] of handles) {
                const at = handle.at(this._view as never, sizeOf(this));
                if (at) out.push({ prop, at });
            }
            return out;
        };
        proto._handleValue = function (this: Generated, prop: string, at: Vector2): Vector2 | null {
            const handle = s.handles![prop];
            if (!handle) return null;
            return handle.value ? handle.value(at, this._view as never, sizeOf(this)) : { x: at.x, y: at.y };
        };
    }
    if (s.bounds) {
        const bounds = s.bounds;
        proto._localBounds = function (this: Generated): BoxBounds {
            return bounds({ width: this.layoutBounds?.width ?? 0, height: this.layoutBounds?.height ?? 0 }, this._view as never);
        };
    }
    if (s.space) {
        const space = s.space;
        // The coordinates its 3D children stand in: read where each child places itself, and by picking.
        (Generated.prototype as unknown as { _spaceOf: () => ChildSpace3D | null })._spaceOf = function (this: Generated) {
            return space(this._view as never);
        };
    }

    return finishComponent(Generated, l) as unknown as Component<K, Merge<Box2DState, S>, C, A>;
}
