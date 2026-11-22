import type { Size2D } from "@/attributes/layout/size";
import type { SizeConstraints } from "@/layout/constraints";
import type { Node2D, CameraScope } from "@/components/trees/2d/node2d";
import type { Node } from "@/components/trees/node/node";
import type { Graphics2D } from "@/render/graphics2d";
import type { MeasureContext2D } from "@/render/measure-context";
import type { RenderPass2D, TileRect } from "@/render/render-context2d";
import type { Clip } from "@/render/clip";
import { NullRenderContext } from "@/render/null-render-context";
import { Graphics2D as GraphicsClass } from "@/render/graphics2d";
import { frameIn, Node2D as Node2DClass } from "@/components/trees/2d/node2d";
import { Node3D } from "@/components/trees/three/node3d";
import { Scene3D } from "@/render3d/scene3d";
import type { BooleanOperation } from "@/attributes/mask/boolean";
import type { MaskOptions } from "@/attributes/mask/mask";
import type { ChildBoundsMode } from "@/components/trees/2d/group-bounds";
import type { SpaceCamera } from "@/attributes/layout/space3d";
import type { TextStyle } from "@/attributes/text/types";
import { translation, type Matrix2D } from "@/attributes/layout/matrix2d";
import { worldAnchors } from "@/components/trees/2d/node-transform";
import type { MergePaint, RepeatCopy, ChildView, Clock, Component, Element, FontSpec, Max, Measurer, NodeFrame, NodeView, Piece, RenderContext2D, TileAxis } from "@/components/factory/api";
import { clipOf } from "@/components/factory/clip-of";
import type { PropHost } from "@/props/host";
import type { PropLayout } from "@/props/layout";

/**
 * What a render did with its children beyond drawing them: composited them
 * (the ink bounds that leaves), looked at them through a camera, or stood them
 * in a 2.5D space. Picking and the space machinery read it between frames.
 */
export interface Composite {
    readonly bounds?: ChildBoundsMode;
    /** The transforms `repeat` drew the children through: their ink under each is the node's. */
    readonly copies?: readonly Matrix2D[];
    /** `tile` drew the children into this node's plane to cover its box, which stays its extent: the copies only fill it. */
    readonly tiled?: true;
    readonly camera?: CameraScope;
    readonly space?: SpaceCamera;
    /** The scene its 3D children were rendered into: what picking projects through. */
    readonly scene?: Scene3D;
}

/** The node a view stands for: how the engine's own modules (`Paint`, `Flow`) reach past the public surface. */
export const NODE = Symbol("componentNode");

/** What a generated node exposes to its views and modules. Never part of the authoring surface. */
export interface ComponentHost extends Node2D {
    _renderOwnChildren(pass: RenderPass2D): void;
    _animate(frame: (t: number) => Record<string, unknown>, duration: number, easing: unknown): unknown;
    _lastShape: Graphics2D | null;
    /** The composite its last render or probe declared; `undefined` before either. */
    _record: Composite | null | undefined;
}

/**
 * Measure and layout run synchronously, one node at a time, so the node being
 * laid out and its measurer are a single slot rather than state on every view.
 */
interface Pass {
    readonly node: Node2D;
    readonly scope: MeasureContext2D;
    readonly room: Max;
    readonly sizes: Map<Node2D, Size2D>;
}

let pass: Pass | null = null;

export function withPass<T>(node: Node2D, scope: MeasureContext2D, room: Max, run: () => T): T {
    const outer = pass;
    pass = { node, scope, room, sizes: new Map() };
    try {
        return run();
    } finally {
        pass = outer;
    }
}

const decided = new WeakSet<Node2D>();

/** An engine module sized this node itself in this measure: its factory reports the size as it stands. */
export function markDecided(node: Node2D): void {
    decided.add(node);
}

export function takeDecided(node: Node2D): boolean {
    return decided.delete(node);
}

export function currentPass(): Pass {
    if (!pass) throw new Error("A component's measure or layout helper ran outside a measure or layout pass.");
    return pass;
}

function measureChild(node: Node2D, max: Max): Size2D {
    const p = currentPass();
    const constraints: SizeConstraints = { maxWidth: max.width, maxHeight: max.height };
    const measured = node.measure(constraints, p.scope);
    const size = { width: measured.width ?? 0, height: measured.height ?? 0 };
    p.sizes.set(node, size);
    return size;
}

const childViews = new WeakMap<Node2D, ChildViewImpl>();

/** A child as its parent's fields see it. One per child node, reused every frame. */
class ChildViewImpl implements ChildView {
    readonly [NODE]: Node2D;
    readonly state: never;

    constructor(node: Node2D) {
        this[NODE] = node;
        // The node's own accessors are its resolved values; a proxy keeps a parent from writing through them.
        // Its props live on the prototype, so the proxy lists them as its own, as a spread or `Object.keys` expects.
        this.state = new Proxy(node, {
            set: () => { throw new TypeError("A child's state is read-only to its parent; animate it with a command."); },
            ownKeys: (target) => {
                const keys = Reflect.ownKeys(target);
                const own = new Set(keys);
                for (const key of propsOf(target)) if (!own.has(key)) keys.push(key);
                return keys;
            },
            getOwnPropertyDescriptor: (target, key) => {
                const own = Reflect.getOwnPropertyDescriptor(target, key);
                if (own || typeof key !== "string" || !propsOf(target).has(key)) return own;
                return { value: Reflect.get(target, key), writable: false, enumerable: true, configurable: true };
            },
        }) as never;
    }

    get id(): string { return this[NODE].id; }
    get key(): never { return (keyOf(this[NODE]) ?? this[NODE].className) as never; }

    get size(): Size2D {
        // Outside a pass (a command being built), the size it was last laid out at, as a command's own node reports.
        if (!pass) {
            const box = this[NODE].layoutBounds;
            return { width: box?.width ?? 0, height: box?.height ?? 0 };
        }
        return pass.sizes.get(this[NODE]) ?? measureChild(this[NODE], pass.room);
    }

    get children(): readonly ChildView[] {
        const node = this[NODE] as Node2D & { _commandChildren?(): readonly ChildView[] };
        return node._commandChildren ? node._commandChildren() : node.children.map(childView);
    }

    measure(max: Max): Size2D {
        return measureChild(this[NODE], max);
    }

    to(targets: object): Piece {
        return { _piece: { kind: "child", node: this[NODE], targets: targets as Record<string, unknown> } };
    }

    run(name: string, args?: object): Piece {
        return { _piece: { kind: "run", node: this[NODE], name, args } };
    }
}

const NO_PROPS: ReadonlySet<string> = new Set();

function propsOf(node: object): ReadonlySet<string> {
    const slots = (node as PropHost).__cells?.slots;
    return slots ? new Set(slots.keys()) : NO_PROPS;
}

export function childView(node: Node2D | Node): ChildView {
    let view = childViews.get(node as Node2D);
    if (!view) childViews.set(node as Node2D, view = new ChildViewImpl(node as Node2D));
    return view as unknown as ChildView;
}

export function nodeOfView(view: ChildView<any>): Node2D {
    return (view as unknown as ChildViewImpl)[NODE];
}

const nodeViews = new WeakMap<Node, WeakMap<Node, NodeViewImpl>>();

const NO_FRAME: NodeFrame = { x: 0, y: 0, rotation: 0, scale: 1 };

/** A node outside a component's own children (an ancestor, a referenced node), as one reader's fields read it. */
class NodeViewImpl implements NodeView {
    readonly [NODE]: Node;
    readonly state: never;

    constructor(node: Node, readonly reader: Node) {
        this[NODE] = node;
        // A component's state as its own fields read it: a reference of its own is a view from where it stands.
        // Anything else it has (a 2D node's cardinal points) reads off the node.
        const fields = (node as { _view?: object })._view ?? node;
        this.state = new Proxy(fields, {
            get: (target, key) => {
                // Its constructor is the node's: what a host asks to tell what kind of node it reads.
                if (key === "constructor") return node.constructor;
                if (key in target) return Reflect.get(target, key);
                const value = Reflect.get(node, key) as unknown;
                // A method of the node runs on the node, not on this read-only view.
                return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(node) : value;
            },
            set: () => { throw new TypeError("Another node's state is read-only to a component; animate it with a command."); },
        }) as never;
    }

    get id(): string { return this[NODE].id; }
    get key(): never { return (keyOf(this[NODE] as Node2D) ?? this[NODE].className) as never; }

    get size(): Size2D {
        const node = this[NODE];
        const box = node instanceof Node2DClass ? node.layoutBounds : undefined;
        return { width: box?.width ?? 0, height: box?.height ?? 0 };
    }

    get frame(): NodeFrame {
        const node = this[NODE];
        return node instanceof Node2DClass && this.reader instanceof Node2DClass ? frameIn(this.reader, node) : NO_FRAME;
    }
}

/** `node` as `reader` sees it. One view per pair. */
export function nodeView(node: Node, reader: Node): NodeView {
    let byReader = nodeViews.get(node);
    if (!byReader) nodeViews.set(node, byReader = new WeakMap());
    let view = byReader.get(reader);
    if (!view) byReader.set(reader, view = new NodeViewImpl(node, reader));
    return view;
}

export function nodeOfNodeView(view: NodeView): Node {
    return (view as unknown as NodeViewImpl)[NODE];
}

const found = new WeakMap<Node, Map<string, Node>>();

/** The node with `id` in `reader`'s scene, as `reader` sees it, or `null`. Remembered per reader while it stays in the scene. */
export function referenced(reader: Node, id: unknown): NodeView | null {
    if (typeof id !== "string" || id === "") return null;
    let known = found.get(reader);
    let node = known?.get(id);
    if (!node || node.id !== id || rootOf(node) !== rootOf(reader)) {
        node = findIn(rootOf(reader), id) ?? undefined;
        if (!node) {
            known?.delete(id);
            return null;
        }
        if (!known) found.set(reader, known = new Map());
        known.set(id, node);
    }
    return nodeView(node, reader);
}

function rootOf(node: Node): Node {
    let at = node;
    while (at.parent) at = at.parent;
    return at;
}

function findIn(at: Node, id: string): Node | null {
    if (at.id === id) return at;
    for (const child of at._allChildren) {
        const hit = findIn(child, id);
        if (hit) return hit;
    }
    return null;
}

let keyOf: (node: Node2D) => string | undefined = () => undefined;
/** Set by the factory module, which owns the node descriptors. */
export function setKeyLookup(lookup: (node: Node2D) => string | undefined): void {
    keyOf = lookup;
}

/**
 * One prototype of getters per component, so a node's `state` is a single
 * object made once: every read goes straight to the node's own slot, and a
 * frame allocates nothing to hand its fields their values.
 */
export interface ViewShape {
    readonly proto: object;
    /** Own, so `{ ...state }` copies every entry; the getters themselves are shared. */
    readonly entries: PropertyDescriptorMap;
}

export function stateViewPrototype(keys: readonly string[], references: ReadonlySet<string> = new Set()): ViewShape {
    const entries: PropertyDescriptorMap = {};
    for (const key of keys) {
        entries[key] = references.has(key)
            ? { get(this: { [NODE]: Node }) { return referenced(this[NODE], (this[NODE] as unknown as Record<string, unknown>)[key]); }, enumerable: true }
            : { get: entryGetter(key), enumerable: true };
    }
    const proto = {};
    // The children of the node's own tree, as its commands see them too.
    Object.defineProperty(proto, "children", {
        get(this: { [NODE]: { _commandChildren(): readonly ChildView[] } }) { return this[NODE]._commandChildren(); },
        enumerable: false,
    });
    return { proto, entries };
}

/** Reads the entry's slot by its index in the node's layout, found once per layout: no lookup by name per read. */
function entryGetter(key: string): (this: { [NODE]: object }) => unknown {
    let layout: PropLayout | undefined;
    let i = -1;
    return function () {
        const node = this[NODE];
        const cells = (node as PropHost).__cells;
        if (cells !== undefined) {
            if (cells.layout !== layout) {
                i = cells.layout.indexOf(key);
                // An entry not registered yet is looked for again next time.
                layout = i < 0 ? undefined : cells.layout;
            }
            const slot = i < 0 ? undefined : cells.list[i];
            if (slot !== undefined) return slot.get();
        }
        return (node as Record<string, unknown>)[key];
    };
}

export function stateView(shape: ViewShape, node: object): object {
    const view = Object.create(shape.proto) as { [NODE]: object };
    Object.defineProperties(view, shape.entries);
    view[NODE] = node;
    return view;
}

/** A command's `state`: where it starts, so a frame function reading it never sees its own writes. */
export function snapshot(view: object): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key in view) out[key] = (view as Record<string, unknown>)[key];
    return out;
}

export class MeasurerImpl implements Measurer {
    max: Max = {};
    scope: MeasureContext2D | null = null;

    constructor(readonly host: Node) { }

    get time(): Clock {
        return this.host.time;
    }

    text(text: string, font: FontSpec): Size2D {
        if (!this.scope) throw new Error("measurer.text was called outside measure.");
        return this.scope.measureText(text, font.fontSize, font.fontFamily, font.fontWeight, font.letterSpacing);
    }
}

/** Reused every frame: `pass` and `cut` are rewritten before each render. */
export class RenderContextImpl implements RenderContext2D {
    pass: RenderPass2D | null = null;
    /** The near-plane cut a 2.5D space puts in front of this node's own paint. */
    cut: Clip | null = null;

    /**
     * `probing`: `render` runs only to find the shape it paints (for clip and
     * picking outside a frame), so nothing is drawn and no child is visited.
     */
    constructor(readonly host: ComponentHost, readonly probing = false) { }

    get size(): Size2D {
        const box = this.host.layoutBounds;
        return { width: box?.width ?? 0, height: box?.height ?? 0 };
    }

    get time(): Clock {
        return this.host.time;
    }

    draw(graphics: Graphics2D | readonly Graphics2D[] | null | undefined): void {
        if (!graphics || this.probing) return;
        const out = this.target();
        if (Array.isArray(graphics)) for (const g of graphics) out.draw(g);
        else out.draw(graphics as Graphics2D);
    }

    children(): void {
        if (this.probing) return;
        // Drawn plainly, so a space or composite the last frame declared no longer holds for them.
        if (!this.composite) this.host._record = null;
        this.host._renderOwnChildren(this.target());
    }

    repeat(copies: readonly RepeatCopy[]): void {
        this._declare({ bounds: "union", copies: copies.map((c) => c.matrix) });
        if (this.probing) return;
        const out = this.target();
        for (const copy of copies) {
            if (out.drawsVisibleOnly && copy.opacity <= 0) continue;
            out.begin(this.host._scopeState(out));
            try {
                // Isolated only when faded, so a copy fades as one layer, never part over part.
                out.transform({ matrix: copy.matrix, opacity: copy.opacity, blend: copy.opacity < 1 ? "normal" : "pass-through" });
                this.host._renderOwnChildren(out);
            } finally {
                out.end();
            }
        }
    }

    tile(axis: TileAxis): void {
        const children = this.host.children.filter((child): child is Node2D => child instanceof Node2DClass);
        const { width, height } = this.size;
        this._declare({ tiled: true });
        if (this.probing) return;
        const out = this.target();
        const cover: TileRect = { x: -width / 2, y: -height / 2, width, height };
        for (const child of children) {
            // A walk that only discovers assets needs each child once.
            if (!out.drawsVisibleOnly) {
                child.render(out);
                continue;
            }
            const tile = tileRect(child, axis, width / 2, height / 2);
            if (tile && out.paintTiled(tile, cover, () => child.render(out))) continue;
            for (const matrix of tileCopies(child, axis, width / 2, height / 2)) {
                if (matrix === HOME) {
                    child.render(out);
                    continue;
                }
                out.begin(this.host._scopeState(out));
                try {
                    out.transform({ matrix, opacity: 1, blend: "pass-through" });
                    child.render(out);
                } finally {
                    out.end();
                }
            }
        }
    }

    /** What this render has declared so far. Its host's record follows at once, so the children it draws see it. */
    composite: Composite | null = null;

    private _declare(composite: Composite): void {
        this.composite = { ...this.composite, ...composite };
        if (!this.probing) this.host._record = this.composite;
    }

    mask(options: MaskOptions): void {
        this._declare({ bounds: "first" });
        if (this.probing) return;
        const out = this.target();
        const [stencil, ...content] = this.host.children;
        if (!stencil) return;
        if (content.length === 0) {
            stencil.render(out);
            return;
        }
        out.beginMask({ mode: options.mode, inverted: options.inverted });
        stencil.render(out);
        out.applyMask();
        for (const child of content) child.render(out);
        out.endMask();
    }

    merge(op: BooleanOperation, paint: MergePaint): void {
        this._declare({ bounds: op === "subtract" ? "first" : op === "intersect" ? "intersect" : "union" });
        if (this.probing) return;
        const out = this.target();
        out.beginBoolean(op);
        for (const child of this.host._allChildren) if (child instanceof Node2DClass) child.render(out);
        out.endBoolean();
        // A drawing with no shape of its own paints the merged outline.
        out.draw(new GraphicsClass().shadow(paint.shadow).fill(paint.fill));
        if (paint.overlay && (paint.overlay as unknown[]).length > 0) out.draw(new GraphicsClass().fill(paint.overlay));
        out.draw(new GraphicsClass().stroke(paint.stroke));
    }

    /** Your children, through a camera viewing your box: aimed at `lookAt`, zoomed, turned by `heading`. */
    camera(scope: CameraScope): void {
        this._declare({ camera: scope });
        if (this.probing) return;
        const out = this.target();
        const rect = this.host.layoutBounds;
        out.beginCamera({ x: rect?.x ?? 0, y: -(rect?.y ?? 0), width: rect?.width ?? 0, height: rect?.height ?? 0 }, scope.lookAt, scope.zoom, scope.heading);
        for (const child of this.host._allChildren) if (child instanceof Node2DClass) child.render(out);
        out.endCamera();
    }

    /** Your 3D children, rendered in order into a new scene. */
    scene3D(): Scene3D {
        const scene = new Scene3D();
        for (const child of this.host._allChildren) if (child instanceof Node3D) child.render(scene);
        this._declare({ scene });
        return scene;
    }

    /** Your children, standing in one 2.5D space seen by `camera`, drawn far to near. */
    space(camera: SpaceCamera): void {
        this._declare({ space: camera });
        if (!this.probing) this.host._renderOwnChildren(this.target());
    }

    textStyle(style: TextStyle | null, body: () => void): void {
        if (this.probing) return body();
        const out = this.target();
        out.pushTextStyle(style);
        try {
            body();
        } finally {
            out.popTextStyle();
        }
    }

    clip(shape: Graphics2D, body: () => void): void {
        if (this.probing) return body();
        const outline = clipOf(shape);
        // No outline is no clip, as a node with no `clipSelf` confines nothing.
        if (outline.isEmpty()) return body();
        const out = this.target();
        out.beginClip(outline);
        try {
            body();
        } finally {
            out.endClip();
        }
    }

    /** An ancestor stands this node in a space: one opens it, and nothing between them flattens. */
    get inSpace(): boolean {
        for (let at = this.host.parent; at; at = at.parent) {
            if (!(at instanceof Node2DClass)) return false;
            if (at._spaceCamera()) return true;
            if (!at._rendersChildrenInSpace()) return false;
        }
        return false;
    }

    ancestor<K extends string, S, C>(component: Component<K, S, C, any, any, any>): NodeView<Element<K, S, C>> | null {
        for (let at = this.host.parent; at; at = at.parent) {
            if (at instanceof component.node) return nodeView(at, this.host) as unknown as NodeView<Element<K, S, C>>;
        }
        return null;
    }

    /** Paint `body` in front of the space's near plane, as `Node2D` does for its own paint. */
    inFront(body: () => void): void {
        if (this.probing) return;
        const out = this.target();
        if (!this.cut) {
            body();
            return;
        }
        out.beginClip(this.cut);
        try {
            body();
        } finally {
            out.endClip();
        }
    }

    target(): RenderPass2D {
        if (this.probing) return PROBE_PASS;
        if (!this.pass) throw new Error("A component's render context was used outside render.");
        return this.pass;
    }
}

/** Where a probe's scoped calls (a clip, a camera) land: a pass that draws nothing. */
const PROBE_PASS: RenderPass2D = new NullRenderContext();

/** A child drawn where it was laid out, among its `tile` copies. */
const HOME: Matrix2D = translation(0, 0);
/** Copies each side of a child per axis, so a hair-thin child cannot flood a frame. */
const MOST_STEPS = 32;

interface Span {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
}

/** `child`'s laid-out box across the host's frame, y up from its centre: the extent a copy of it repeats by. */
function tileSpan(child: Node2D): Span | null {
    const box = child.layoutBounds;
    if (!box) return null;
    const a = worldAnchors(child._localMatrix(), box.width / 2, box.height / 2);
    const corners = [a.topLeft, a.topRight, a.bottomLeft, a.bottomRight];
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** One tile of `child` (y down, from the host's centre): its own span along each repeated axis, the host's box along the other; `null` under a pixel. */
function tileRect(child: Node2D, axis: TileAxis, halfWidth: number, halfHeight: number): TileRect | null {
    const s = tileSpan(child);
    const across = axis !== "vertical", down = axis !== "horizontal";
    if (!s || (across && !(s.maxX - s.minX >= 1)) || (down && !(s.maxY - s.minY >= 1))) return null;
    return {
        x: across ? s.minX : -halfWidth,
        y: down ? -s.maxY : -halfHeight,
        width: across ? s.maxX - s.minX : 2 * halfWidth,
        height: down ? s.maxY - s.minY : 2 * halfHeight,
    };
}

/** `child`'s copies (y down, from the host's centre) whose laid-out box overlaps the host's half extents; `HOME` always among them. */
function tileCopies(child: Node2D, axis: TileAxis, halfWidth: number, halfHeight: number): Matrix2D[] {
    const s = tileSpan(child);
    if (!s) return [HOME];
    const across = axis === "vertical" ? [0] : tileSteps(s.minX, s.maxX, halfWidth);
    const down = axis === "horizontal" ? [0] : tileSteps(s.minY, s.maxY, halfHeight);
    const out: Matrix2D[] = [];
    for (const dx of across) for (const dy of down) out.push(dx === 0 && dy === 0 ? HOME : translation(dx, -dy));
    return out;
}

/** The whole multiples of `[min, max]`'s own length that bring it over `(-half, half)`, and 0. */
function tileSteps(min: number, max: number, half: number): number[] {
    const period = max - min;
    if (!(period >= 1)) return [0];
    const first = Math.max(-MOST_STEPS, Math.floor((-half - max) / period) + 1);
    const last = Math.min(MOST_STEPS, Math.ceil((half - min) / period) - 1);
    const steps: number[] = [];
    for (let k = first; k <= last; k++) steps.push(k * period);
    if (first > 0 || last < 0) steps.push(0);
    return steps;
}

export function internalsOf(ctx: RenderContext2D): RenderContextImpl {
    if (!(ctx instanceof RenderContextImpl)) throw new TypeError("Paint.draw takes the render context its render field was given.");
    return ctx;
}
