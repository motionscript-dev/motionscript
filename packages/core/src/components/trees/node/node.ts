import { _observer, PropSlot } from "@/props/slot";
import { STRUCTURE_SLOT } from "@/props/observer";
import { PropHost, type PropCells } from "@/props/host";
import { EasingFunction } from "@/tween/ease/type";
import { toCommand } from "@/tween/to-command";
import { makeCommand, type Command, type CommandArgs, type CommandTarget } from "@/tween/command";
import { prepareNumericCellTween } from "@/tween/prepare";
import { inertCommand, inertStepper } from "@/tween/inert";
import { TweenStepper } from "@/tween/stepper";
import { RefTarget } from "@/util/reference";
import { Context, ContextMap } from "@/util/context";
import { AssetCatalog } from "@/assets/catalog";
import type { AssetScope } from "@/assets/scope";
import { declareMembers, getPropertyMeta, PropOptions } from "@/attributes/properties/decorator";
import {
    applyProp,
    applySnapshotLayer,
    collectProperties,
    popState,
    restoreAnimated,
    saveState,
} from "./node-reactive";
import type { PropLayer } from "./node-reactive";
import { advanceNodeTime, createNodeTime, type MutableNodeTime, type NodeTime } from "@/components/trees/node/node-time";
import type { PropInputs } from "@/attributes/properties/inputs";
import { command } from "@/tween/command-decorator";

export type { NodeTime } from "@/components/trees/node/node-time";
export type { PropInput, PropInputs } from "@/attributes/properties/inputs";

export type NodeDimension = "2d" | "3d" | "audio";

/** Where a node of each dimension is allowed to live, for the mismatch error. */
const HOSTS_OF: Record<NodeDimension, string> = {
    "2d": "2D nodes go in the 2D tree, or inside a Canvas3D as a HUD over its scene.",
    "3d": "Put 3D nodes inside a Canvas3D, which is the one node that holds both.",
    audio: "Put audio nodes under an AudioBus, or directly on the scene root.",
};

export interface NodeMetadata<T extends Node> {
    /** Written with this node at construction. Typed {@link RefTarget} rather than `Reference<T>` so a ref declared as one of `T`'s supertypes is accepted (`createRef<Node2D>()` on a `<Rect>`). */
    ref?: RefTarget<T>;
}

export type NodeConfig<T extends Node, P> = PropInputs<P> & NodeMetadata<T>;

/** What {@link Node.attach} needs to put a subtree into a live scene: available assets, ancestor-provided context, and the playhead. */
export interface AttachScope {
    assets: AssetCatalog;
    context: ContextMap;
    /** Clip-relative time, in seconds. */
    time: number;
}

/** A `children` child: a Node, nested arrays of them, or falsy (so `.map()` results and `cond && Rect(...)` work); the constructor flattens and drops all but `Node` instances. */
export type NodeChildren = Node | false | null | undefined | NodeChildren[];

/** The props every node has, in either dimension. Deliberately tiny: box-on-a-page props live on {@link Node2DProps}, thing-in-space props on `Node3DProps`; a prop meaningless for half the tree is worse than none. */
export interface NodeProps {
    children: NodeChildren;
    /** Seeds {@link Node.id}; a document's `NodeSpec.id` supplies it (see `Registry.instantiate`). Defaults to a UUID. */
    id?: string;
    /** The handle a node is referenced by (`"=[card.x]"` reads `x` of the node keyed `card`), as against {@link NodeProps.id}, which addresses it. Never generated, and unique per document (`document/validate.ts`). */
    key?: string;
}

/**
 * The dimension-agnostic base of the scene graph; where a node is and how it draws belong to {@link Node2D} /
 * `Node3D`, which meet only at `Canvas3D` (mixing elsewhere throws, see {@link acceptsChild}). Subclasses call
 * {@link initProps} from their own constructor: field initializers run after `super()`, so applying defaults here would write into cells that don't exist yet.
 */
export abstract class Node<P extends NodeProps = NodeProps> implements PropHost {
    /** A getter so it is answerable from the prototype during construction, before subclass field initializers run. */
    abstract get dimension(): NodeDimension;

    /** The trees this type takes children from, answerable from the prototype as {@link dimension} is. */
    get _childTrees(): readonly NodeDimension[] {
        return [this.dimension];
    }

    constructor(props?: NodeConfig<any, P>) {
        // Retained by reference before any default application, so a provider's provideContext sees exactly what the
        // author passed and a subclass expanding sugar in place (`size`, `transform3D`) is reflected.
        this._props = props;
        // Neither is a property: identity doesn't tween, so it stays out of the table set(), to() and the baseline restore iterate.
        const identity = props as { id?: string; key?: string } | undefined;
        this.key = identity?.key;
        // Nullish, never falsy: `""` is the scene root's real id (`checkRootShape` in document/validate.ts), and a UUID
        // in its place would give the host a root no document row mentions.
        this.id = identity?.id ?? crypto.randomUUID();
    }

    /** See {@link NodeProps.key}. */
    key?: string;

    private _hidden = false;
    private _locked = false;

    /** Hidden by the editor: no paint, no pick, no layout slot. See {@link NodeEditorState.hidden}. */
    get hidden(): boolean {
        return this._hidden;
    }

    /** Locked by the editor — unpickable, but drawn. See {@link NodeEditorState.locked}. */
    get locked(): boolean {
        return this._locked;
    }

    /** @internal Written only by `applyEditorStates`, which owns both flags for the whole tree; not a setter pair, so one can't be set leaving the other stale. */
    _setEditorState(hidden: boolean, locked: boolean): void {
        this._hidden = hidden;
        this._locked = locked;
    }

    /** Fires the `ref` and applies every declared property from `props`. Called by the concrete constructor, not this one: field initializers run after `super()`, so doing it here would write into cells that are still `undefined`. */
    protected initProps(props?: NodeConfig<any, P>): void {
        if (props?.ref) {
            props.ref(this as any);
        }

        for (const meta of getPropertyMeta(this)) {
            const propsVal = props ? (props as any)[meta.key] : undefined;
            const initial = propsVal !== undefined ? propsVal : meta.default;
            this.applyProp(meta.key, initial, meta.options);
        }
    }

    /** Adopts the `children` prop, after the concrete constructor's defaults are in place so a child never lands in a parent that hasn't sized itself. */
    protected adoptChildrenProp(props?: NodeConfig<any, P>): void {
        if (props && (props as any).children) {
            const raw = Array.isArray((props as any).children) ? (props as any).children : [(props as any).children];
            const flat = (raw as unknown[]).flat(Infinity)
                .filter((c: unknown): c is Node => c instanceof Node);
            if (flat.length > 0) this._addChildren(flat);
        }
    }

    /** Whether `child` may be adopted. A node takes children of its own dimension; `Canvas3D` takes 2D and 3D, `Canvas2D` takes 2D and audio. Mixing elsewhere is rejected because a `Box3D` under a `Rect` would be skipped by both walks and silently never appear. */
    protected acceptsChild(child: Node): boolean {
        return child.dimension === this.dimension;
    }

    /** Throw if `child` cannot go here: by its tree, by what this node takes, or by where the child says it goes. */
    protected assertAcceptsChild(child: Node): void {
        if (!this.acceptsChild(child)) {
            const why = child.dimension === this.dimension ? this._childRule() : HOSTS_OF[child.dimension];
            throw new TypeError(`${this.className} (${this.dimension}) cannot hold ${child.className} (${child.dimension}).${why ? ` ${why}` : ""}`);
        }
        const refusal = child._parentRefusal(this);
        if (refusal) throw new TypeError(refusal);
    }

    /** What this node takes, for the error when it refuses a child of its own tree. */
    protected _childRule(): string {
        return "";
    }

    /** Why this node cannot go inside `parent`, or `null`: only a node that names its parents refuses one. */
    _parentRefusal(_parent: Node): string | null {
        return null;
    }

    private _assets: AssetCatalog | null = null;
    protected _parent: Node | null = null;

    /** Whether this node is in a live scene tree; gates measure/layout/render, asset declaration and every command (checked where the framework dispatches, not per method). */
    private _mounted = false;

    get mounted(): boolean {
        return this._mounted;
    }

    get parent(): Node | null {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this._parent;
    }

    get assets(): AssetCatalog {
        if (!this._assets) throw new Error("Assets not bound — this node is not attached to a scene. See Node.attach().");
        return this._assets;
    }

    private _context: ContextMap = ContextMap.EMPTY;
    /** True once {@link attach} has reached this node. */
    private _contextBound = false;

    /** Raw constructor props, retained so {@link provideContext} can see which keys were explicitly passed. Kept through {@link dispose} so a reused instance re-derives context on the next attach. */
    protected _props?: NodeConfig<any, P>;

    /** Read the nearest ancestor provider's value for `ctx` (or its default). */
    useContext<T>(ctx: Context<T>): T {
        return this._context.get(ctx);
    }

    readonly id: string;

    /**
     * The slots behind this node's `property` fields; the authoring surface is the props and `set()`/`to()`/`captureProps()`.
     *
     * @internal
     */
    __cells?: PropCells;

    protected _children: Node[] = [];

    /** Flattens a constructor's raw `children` prop into its `Node`s without mutating or adding them, so {@link applyDefaultSize} overrides can inspect children's resolved `width`/`height` before attachment. */
    protected static flattenChildrenProp(props: { children?: unknown } | undefined): Node[] {
        const childProp = props ? props.children : undefined;
        if (!childProp) return [];
        const raw = Array.isArray(childProp) ? childProp : [childProp];
        return (raw as unknown[]).flat(Infinity).filter((c: unknown): c is Node => c instanceof Node);
    }

    /** Declares a prop: creates a {@link PropSlot}-backed accessor for `field`, applies the initial value (a callback binds, otherwise constant) and registers tween/mapper metadata. A repeat call for the same field is a value assignment, so a subclass can override a parent's default without losing the slot or its bindings. */
    protected applyProp<Ext, Int = Ext>(
        field: string,
        initial: Ext | (() => Ext) | undefined,
        options?: PropOptions<Ext, Int>,
    ): void {
        applyProp(this, field, initial, options);
    }

    /** @internal Hot-path prop write (mapper- and binding-aware). Public-but-underscored like `_prepareStep` so reactive companions in this directory can call it; not part of the authoring surface. */
    _writeProp(field: string, value: unknown): void {
        if (value === undefined) return;
        const slot = this.__cells?.slots.get(field);
        if (!slot) return;
        const mapper = this.__cells?.mappers?.get(field);
        if (typeof value === "function") {
            const extFn = value as () => any;
            if (mapper) {
                // A binding reading `undefined` (a node reference to an absent node) leaves the prop as a node built without
                // it and skips the mapper, which holds the shape the prop's readers go through.
                let unset: { value: unknown } | undefined;
                slot.bind(() => {
                    const read = extFn();
                    return read === undefined
                        ? (unset ??= { value: this._unsetValue(field, mapper) }).value
                        : mapper(read, slot.get());
                });
            } else {
                slot.bind(extFn);
            }
        } else {
            slot.set(mapper ? mapper(value, slot.get()) : value);
        }
    }

    get properties(): P {
        return collectProperties(this) as P;
    }

    /** This node's class name, for messages and a host's type column. Not an authored identity ({@link id}, {@link key}) nor the registry key in `NodeSpec.type`: a minifier may rename a class. */
    get className(): string {
        return this.constructor.name;
    }

    set(props: { [K in keyof P]?: P[K] | (() => P[K]) }): void {
        const slots = this.__cells?.slots;
        if (!slots) return;
        // Iterate the caller's keys (usually 1-3), not every registered prop (15+): set() runs in the per-frame hot path.
        // Unknown keys are ignored, which lets a subclass distribute its sugar (2D's `size`, `transform3D`) into real keys and delegate here.
        for (const key in props) {
            const val = (props as any)[key];
            if (val !== undefined && slots.has(key)) this._writeProp(key, val);
        }
    }

    to<D extends Partial<P> = Partial<P>>(args: CommandArgs<D> & { duration: number }): Command<P> {
        return toCommand<P>(this, args.data ?? {}, args.duration, args.easing);
    }

    /** Builds a {@link Command} from a pure function of normalized time: an animation this node can be evaluated at, not only run. The pair to {@link to}, for commands whose values at `t` aren't a prop list. Snapshot the starting state outside `at`: reading a prop inside it would re-read what the command is writing. */
    protected command<Props = P>(
        at: (t: number) => Partial<Props>,
        duration: number = 1,
        easing?: EasingFunction,
    ): Command<Props> {
        if (!this._mounted) return inertCommand<Props>(this, duration);
        return makeCommand<Props>(
            this as unknown as CommandTarget<Props>,
            at,
            duration,
            easing,
        );
    }

    /** Resolves one `to()` step into a flat {@link TweenStepper}: per-key setup (mapper, numeric-vs-custom routing) happens once here, so `advance(dt)` is allocation-free. Used by a chain's iterator path and the batched `parallel` path. A subclass with positional sugar expands `to` in place, then delegates here. */
    _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        if (!this._mounted) return inertStepper(duration);
        // A tween runs in stored space: the destination is mapped once here and every step writes a stored value as is.
        // Writing through the setter would map twice, which only an idempotent mapper survives.
        const numCells: PropSlot<number>[] = [];
        const numFrom: number[] = [];
        const numEnd: number[] = [];
        const customLerps: Array<(t: number) => void> = [];
        const stringSnaps: Array<[PropSlot<string>, string]> = [];

        for (const key of Object.keys(to)) {
            const slot = this.__cells?.slots.get(key);
            if (!slot) continue;
            const extVal = (to as any)[key];
            const mapper = this.__cells?.mappers?.get(key);
            const targetVal = mapper ? mapper(extVal, (this as any)[key]) : extVal;
            const tweenFn = this.__cells?.tweens?.get(key);
            if (tweenFn) {
                const from = (this as any)[key];
                customLerps.push((t) => {
                    slot.set(tweenFn(from, targetVal, t));
                });
            } else if (typeof targetVal === 'number') {
                numCells.push(slot as PropSlot<number>);
                numFrom.push((this as any)[key] as number);
                numEnd.push(targetVal as number);
            } else if (typeof targetVal === 'string') {
                stringSnaps.push([slot as PropSlot<string>, targetVal]);
            }
        }

        const lerp = prepareNumericCellTween(numCells, numFrom, numEnd);
        const hasCustom = customLerps.length > 0;
        const hasSnaps = stringSnaps.length > 0;

        const apply = (t: number): void => {
            const easedT = easing ? easing(t) : t;
            lerp(easedT);
            if (hasCustom) for (const fn of customLerps) fn(easedT);
            // A discrete prop snaps at the end. Applied here, not only in `advance`, because a `seek` past the end has
            // reached that end; otherwise `seek(duration)` and running to `duration` would differ.
            if (hasSnaps && t >= 1) for (const [slot, val] of stringSnaps) slot.set(val);
        };

        let elapsed = 0;
        return {
            // Tracks `elapsed` so a seek and a subsequent advance agree on where the tween is.
            seek: (e: number) => {
                elapsed = e;
                apply(duration > 0 ? Math.min(e / duration, 1) : 1);
            },
            advance: (dt: number): boolean => {
                elapsed += dt;
                if (elapsed < duration) {
                    apply(elapsed / duration);
                    return false;
                }
                apply(1);
                return true;
            },
        };
    }

    /** What a node constructed without `field` holds: its declared default, through the mapper. */
    private _unsetValue(field: string, mapper: (ext: any, prev?: any) => any): unknown {
        const declared = getPropertyMeta(this).find((meta) => meta.key === field)?.default;
        const initial = typeof declared === "function" ? declared() : declared;
        return initial === undefined ? undefined : mapper(initial, undefined);
    }

    // State stack (save / restore): a per-node LIFO of property snapshots, as Motion Canvas's save()/restore().

    /** @internal LIFO stack of save() snapshot layers. Underscore-internal so the prop companion can read it; not authoring surface. */
    _stateStack: PropLayer[] = [];

    /** Pushes a snapshot of every reactive prop onto the save stack. Bindings are saved as bindings (not resolved values), so {@link restore} re-binds them. Calls stack. */
    save(): void {
        saveState(this);
    }

    /** Pops the latest {@link save} snapshot and rolls back to it. With no (or zero) `duration` every prop is reapplied instantly; with one, numeric and custom-tween props animate back, then the full snapshot is reapplied to re-bind reactive props and snap non-tweenable ones. No-op on an empty stack. */
    restore(): void;
    restore(args: CommandArgs<Record<string, never>> & { duration: number }): Command<Record<string, never>>;
    restore(args?: CommandArgs<Record<string, never>>): void | Command<Record<string, never>> {
        const layer = popState(this);
        const duration = args?.duration;
        if (duration === undefined || duration <= 0) {
            if (layer) applySnapshotLayer(this, layer);
            return;
        }
        return restoreAnimated(this, layer, duration, args?.easing);
    }

    protected _time: MutableNodeTime = createNodeTime();

    /** This node's place on the scene clock. See {@link NodeTime}. */
    public get time(): NodeTime {
        if (_observer !== null) _observer.clock?.(this);
        return this._time;
    }

    /**
     * Advances this node's clock (not its subtree: {@link attach} already recurses) and samples its derived render
     * state. Sampling happens here, not at render: this runs on every advanced frame in every playback path while
     * `render` runs only for displayed ones, so velocity is right on the first frame after a scrub. It runs before
     * `generator.next()` (so audio scheduling in generator bodies reads the right time), so x/y still hold the
     * previous frame's value and velocity trails the rendered position by one constant frame.
     */
    private _advanceOwnTime(total: number): void {
        advanceNodeTime(this._time, total);
        this._sample();
    }

    /** @internal Per-node half of `sampleTree`; nothing to derive here, {@link Node2D} samples its motion. */
    _sample(): void { }

    /** @internal Per-node half of `primeMotionTree`: records the current position as the motion history's previous frame at `at`, deriving no velocity. */
    _primeMotion(at: number): void { }

    /**
     * Puts this subtree into the scene: marks it mounted, binds the asset catalog and inherited context, advances its
     * clock to `scope.time`. Cheap to call every frame: an unchanged catalog/context short-circuits and
     * {@link resolveContext} fires only on first attach.
     *
     * @internal Driven by `ClipInstance` per frame, and by {@link add} for a mid-frame subtree.
     */
    attach(scope: AttachScope): void {
        const first = !this._mounted;
        this._mounted = true;

        if (this._assets !== scope.assets) this._assets = scope.assets;

        const next = this.provideContext(scope.context);
        // Unchanged map, already bound, and not the first attach: the subtree already holds `next`, so only the time half runs.
        const contextChanged = !this._contextBound || this._context !== next;
        if (contextChanged) {
            this._context = next;
            this._contextBound = true;
        }
        if (first) this.resolveContext(next);

        this._advanceOwnTime(scope.time);

        if (this._children.length === 0) return;
        const childScope = next === scope.context ? scope : { ...scope, context: next };
        for (const child of this._children) child.attach(childScope);
    }

    /**
     * Takes this subtree out of the scene without tearing it down, so it can be attached elsewhere (`reparent`); {@link dispose} tears down.
     *
     * @internal Driven by {@link remove}/{@link clear}.
     */
    detach(): void {
        if (!this._mounted) return;
        this._mounted = false;
        for (const child of this._children) child.detach();
    }

    /** The scope this node was last attached with, for handing to a late child. */
    private _currentScope(): AttachScope | null {
        return this._assets && this._contextBound
            ? { assets: this._assets, context: this._context, time: this._time.total }
            : null;
    }

    /** Attach `child` if this node is itself attached; otherwise leave it for the walk. */
    /** @internal Shared with `Node2D.addChildAt`, which splices rather than pushes. */
    protected _attachChild(child: Node): void {
        if (!this._mounted) return;
        const scope = this._currentScope();
        if (scope) child.attach(scope);
    }

    /** Applies inherited context values once, after linking into the tree and ancestor providers resolve (a component's `inherit` entries). */
    protected resolveContext(ctx: ContextMap): void { }

    /** The {@link ContextMap} for descendants; a component's `provide` adds tokens, the base passes the parent's through. */
    protected provideContext(parent: ContextMap): ContextMap {
        return parent;
    }

    /** Binds `node`'s asset catalog, context and clock without making it a child, for a node used as a pixel source (`Tex.surface`) and laid out on demand. */
    protected attachDetached(node: Node): void {
        const scope = this._currentScope();
        if (scope) node.attach(scope);
    }

    /** Declares what this node draws from its props and inherited context alone, never `layoutBounds` or the clock: the runtime records what this reads and re-runs it only when those props are written, so any other dependency is a change nobody will ask about. */
    declareAssets(assets: AssetScope): void { }

    get children(): Node[] {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this._children;
    }

    /** Every child, both dimensions, unfiltered (unlike {@link children}, which {@link Node2D} filters): for index-matching the authored tree, as picking does. */
    get _allChildren(): readonly Node[] {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this._children;
    }

    /** Adds children (a node, array, or nested mix; falsy entries dropped). A child of the other dimension throws, see {@link acceptsChild}. */
    add(child: NodeChildren): void {
        if (child instanceof Node) {
            this._addChild(child);
            return;
        }
        const flat = Node.flattenChildrenProp({ children: child });
        if (flat.length > 0) this._addChildren(flat);
    }

    /** Remove children — same shapes as {@link add}. Not a child of this one is a no-op. */
    remove(child: NodeChildren): void {
        if (child instanceof Node) {
            this._removeChild(child);
            return;
        }
        for (const node of Node.flattenChildrenProp({ children: child })) {
            this._removeChild(node);
        }
    }

    clear(): void {
        for (const child of this._children) {
            if (_observer !== null) this._structureChanged(child);
            child._parent = null;
            child.detach();
        }
        this._children.length = 0;
    }

    /** Inserts `child` at `index`. On {@link Node} because it's tree machinery (`ClipTimeline.syncPresence` calls it on whatever a spec's `parentId` names, not always 2D); `Node2D` overrides it for the animated insert, which measures the child off-tree. */
    addChildAt(args: CommandArgs<{ child: Node; index: number }>): void | Command<Record<string, never>> {
        const { child, index } = args.data as { child: Node; index: number };
        this.assertAcceptsChild(child);
        this._insertChildAt(child, index);
    }

    /** @internal Shared with `Node2D.addChildAt`'s instant branch. */
    protected _insertChildAt(child: Node, index: number): void {
        if (_observer !== null) this._structureChanged(child);
        this._children.splice(index, 0, child);
        child._parent = this;
        this._attachChild(child);
    }

    /**
     * @internal The pseudo-slot {@link children} and {@link parent} report to an
     * observer. Allocated on first observation, so a tree nobody observes carries none.
     */
    _structureSlot(): PropSlot<null> {
        return this._structure ??= new PropSlot<null>(null, this, STRUCTURE_SLOT);
    }

    /** @internal Report a child entering or leaving this node — its parent link changes with it. Call only while observed. */
    _structureChanged(child: Node | null): void {
        _observer!.write(this._structureSlot());
        if (child) _observer!.write(child._structureSlot());
    }

    private _structure: PropSlot<null> | null = null;

    private _addChild(child: Node): void {
        this.assertAcceptsChild(child);
        if (_observer !== null) this._structureChanged(child);
        this._children.push(child);
        child._parent = this;
        this._attachChild(child);
    }

    private _addChildren(children: Node[]): void {
        for (const child of children) this.assertAcceptsChild(child);
        if (_observer !== null) for (const child of children) this._structureChanged(child);
        this._children.push(...children);
        for (const child of children) child._parent = this;
        for (const child of children) this._attachChild(child);
    }

    private _removeChild(child: Node): void {
        const i = this._children.indexOf(child);
        if (i < 0) return;
        if (_observer !== null) this._structureChanged(child);
        const [removed] = this._children.splice(i, 1);
        if (removed) {
            removed._parent = null;
            removed.detach();
        }
    }

    dispose(): void {
        if (this.__cells) {
            for (const slot of this.__cells.slots.values()) {
                slot.dispose();
            }
        }
        this.__cells = undefined;
        this._assets = null;
        this._mounted = false;
        // _props is retained (authored identity) so provideContext still works after reuse.
        this._context = ContextMap.EMPTY;
        this._contextBound = false;
    }
}

declareMembers(Node, {
    to: command(),
    restore: command(),
    addChildAt: command({ args: ["child", "index"] }),
});
