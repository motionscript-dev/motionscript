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

/** Which scene graph a node belongs to. See {@link Node.dimension}. */
export type NodeDimension = "2d" | "3d" | "audio";

/** Where a node of each dimension is allowed to live, for the mismatch error. */
const HOSTS_OF: Record<NodeDimension, string> = {
    "2d": "2D nodes go in the 2D tree, or inside a Canvas3D as a HUD over its scene.",
    "3d": "Put 3D nodes inside a Canvas3D, which is the one node that holds both.",
    audio: "Put audio nodes under an AudioBus, or directly on the scene root.",
};

export interface NodeMetadata<T extends Node> {
    /**
     * Handle written with this node at construction. Typed as {@link RefTarget}
     * rather than `Reference<T>` so a ref declared as one of `T`'s *supertypes*
     * is accepted (`createRef<Node2D>()` on a `<Rect>`) — see the note there
     * for why that direction is the sound one.
     */
    ref?: RefTarget<T>;
}

export type NodeConfig<T extends Node, P> = PropInputs<P> & NodeMetadata<T>;

/**
 * Everything {@link Node.attach} needs to put a subtree into a live scene.
 *
 * The three things tree membership supplies, and the only three: what assets are
 * available, what context the ancestors provide, and where the playhead is.
 */
export interface AttachScope {
    /** Metadata for the assets this scene may declare. */
    assets: AssetCatalog;
    /** The token map the parent provides to this node. */
    context: ContextMap;
    /** Clip-relative time, in seconds. */
    time: number;
}

/**
 * A `children` child: a single {@link Node}, an arbitrarily-nested array of
 * children, or a falsy value. Nesting is allowed so `.map()` results can be
 * dropped straight in as a child, and falsy values are allowed so
 * `condition && Rect({ … })` works — the constructor flattens
 * (`.flat(Infinity)`) and filters out everything but `Node` instances.
 */
export type NodeChildren = Node | false | null | undefined | NodeChildren[];

/**
 * The props every node has, in either dimension.
 *
 * Deliberately tiny. Everything that reads as "a box on a page" — `x`/`y`,
 * `width`/`height`, `padding`, `flex`, anchors, `opacity` — lives on
 * {@link Node2DProps}, and everything that reads as "a thing in space" —
 * `position`, `quaternion`, `castShadow` — lives on `Node3DProps`, because a
 * prop that means nothing for half the tree is worse than no prop at all.
 */
export interface NodeProps {
    children: NodeChildren;
    /**
     * Seeds {@link Node.id}. A document's `NodeSpec.id` supplies it — see
     * `Registry.instantiate` — so an instantiated node answers to the identity
     * its row was authored under. Left out, the node falls back to a UUID, which
     * is what every hand-written `new Rect({…})` and component call gets.
     */
    id?: string;
    /**
     * The handle a node is *referenced by*, as against {@link NodeProps.id},
     * which addresses it. `"=[card.x]"` in any prop reads the `x` of the node
     * keyed `card` — see `NodeSpec.key`.
     *
     * Optional and never generated — a node has one only because an author wrote
     * one, which is what makes it safe to point a formula at — and unique per
     * document, which `document/validate.ts` enforces.
     */
    key?: string;
}

/**
 * The dimension-agnostic base of the scene graph: tree, identity, reactive
 * properties, commands, context, clock, asset declaration, teardown. Nothing
 * about *where* a node is or *how* it draws — that's {@link Node2D} / `Node3D`.
 * They meet only at `Canvas3D`; mixing them anywhere else throws (see
 * {@link acceptsChild}).
 *
 * Subclasses call {@link initProps} from their own constructor rather than the
 * base doing it: a subclass's field initializers only run *after* `super()`
 * returns, so applying `property` defaults any earlier would write into cells
 * that don't exist yet.
 */
export abstract class Node<P extends NodeProps = NodeProps> implements PropHost {
    /**
     * Which scene graph this node belongs to.
     *
     * A getter rather than a field so it is answerable from the prototype during
     * construction, before any subclass field initializer has run.
     */
    abstract get dimension(): NodeDimension;

    /** The trees this type takes children from, answerable from the prototype as {@link dimension} is. */
    get _childTrees(): readonly NodeDimension[] {
        return [this.dimension];
    }

    constructor(props?: NodeConfig<any, P>) {
        // Retain the raw props (see _props doc) so a provider's provideContext can
        // read which keys the author passed. Captured before any default
        // application so it reflects exactly what the author passed. The object is
        // retained by reference, so a subclass expanding prop sugar in place
        // afterwards (`size`, `transform3D`) is reflected here too.
        this._props = props;
        // Neither is a property: identity does not tween, so neither has any
        // business in the table `set()`, `to()` and the baseline restore walk
        // iterate.
        const identity = props as { id?: string; key?: string } | undefined;
        this.key = identity?.key;
        // Nullish, never falsy: `""` is the scene root's real id, not a missing
        // one (`checkRootShape` in document/validate.ts defines the root as the
        // row holding it), and a UUID in its place would have the host's tree
        // report a root no document row mentions.
        this.id = identity?.id ?? crypto.randomUUID();
    }

    /** See {@link NodeProps.key}. */
    key?: string;

    private _hidden = false;
    private _locked = false;

    /**
     * Hidden by the editor — no paint, no pick, no layout slot. See
     * {@link NodeEditorState.hidden}.
     */
    get hidden(): boolean {
        return this._hidden;
    }

    /** Locked by the editor — unpickable, but drawn. See {@link NodeEditorState.locked}. */
    get locked(): boolean {
        return this._locked;
    }

    /**
     * @internal — written only by `applyEditorStates`, which owns both flags for
     * the whole tree. Not a setter pair, so a caller cannot set one and leave the
     * other holding a previous frame's answer.
     */
    _setEditorState(hidden: boolean, locked: boolean): void {
        this._hidden = hidden;
        this._locked = locked;
    }

    /**
     * Fire the `ref` and apply every declared property, reading
     * initial values from `props`.
     *
     * Called by the concrete constructor ({@link Node2D}'s, `Node3D`'s) rather
     * than by this one, because a subclass's field initializers run *after*
     * `super()` returns: doing this here would apply props while the cells those
     * props write into are still `undefined`.
     */
    protected initProps(props?: NodeConfig<any, P>): void {
        if (props?.ref) {
            props.ref(this as any);
        }

        // Apply every declared property, reading initial values from props.
        for (const meta of getPropertyMeta(this)) {
            const propsVal = props ? (props as any)[meta.key] : undefined;
            const initial = propsVal !== undefined ? propsVal : meta.default;
            this.applyProp(meta.key, initial, meta.options);
        }
    }

    /**
     * Adopt the `children` prop. Called by the concrete constructor after its own
     * defaults are in place, so a child never lands in a tree whose parent has not
     * finished sizing itself.
     */
    protected adoptChildrenProp(props?: NodeConfig<any, P>): void {
        if (props && (props as any).children) {
            const raw = Array.isArray((props as any).children) ? (props as any).children : [(props as any).children];
            const flat = (raw as unknown[]).flat(Infinity)
                .filter((c: unknown): c is Node => c instanceof Node);
            if (flat.length > 0) this._addChildren(flat);
        }
    }

    /**
     * Whether `child` may be adopted by this node.
     *
     * A node holds children of its own dimension; the places the trees meet are
     * `Canvas3D`, which takes 2D and 3D, and `Canvas2D`, which takes 2D and
     * audio. Both partition what they accept. Rejecting the mix here rather than
     * letting it through is deliberate: a `Box3D` parented to a `Rect` would be
     * silently skipped by both the layout walk and the 3D walk, and would simply
     * never appear.
     */
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

    /**
     * Whether this node is in a live scene tree. Gates measure/layout/render,
     * asset declaration and every command — checked at the handful of places
     * the framework dispatches from, not per method.
     */
    private _mounted = false;

    /** See {@link _mounted}. */
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

    /** Token→value map pushed down from ancestor providers, bound by {@link attach}. */
    private _context: ContextMap = ContextMap.EMPTY;
    /** True once {@link attach} has reached this node. */
    private _contextBound = false;

    /** Raw constructor props, retained so {@link provideContext} can see which keys were explicitly passed. Kept through {@link dispose} so a reused instance re-derives context on the next attach. */
    protected _props?: NodeConfig<any, P>;

    /** Read the nearest ancestor provider's value for `ctx` (or its default). */
    useContext<T>(ctx: Context<T>): T {
        return this._context.get(ctx);
    }

    /** Assigned in the constructor — see {@link NodeProps.id}. */
    readonly id: string;

    /**
     * The slots behind this node's `property` fields. See {@link PropCells}.
     *
     * @internal — the authoring surface is the declared props themselves, plus
     * `set()`/`to()`/`captureProps()`.
     */
    __cells?: PropCells;

    protected _children: Node[] = [];

    /**
     * Flatten a constructor's raw `children` prop into the `Node` instances it
     * contains, without mutating or adding them — the same normalisation the
     * constructor applies before adding them, exposed standalone so
     * {@link applyDefaultSize} overrides can inspect children's own resolved
     * `width`/`height` *before* they're attached (children are constructed,
     * defaults and all, before being passed in as props).
     */
    protected static flattenChildrenProp(props: { children?: unknown } | undefined): Node[] {
        const childProp = props ? props.children : undefined;
        if (!childProp) return [];
        const raw = Array.isArray(childProp) ? childProp : [childProp];
        return (raw as unknown[]).flat(Infinity).filter((c: unknown): c is Node => c instanceof Node);
    }

    // ---- Reactive properties ----------------------------------------------

    /**
     * Declare a prop on this node. Creates a {@link PropSlot}-backed accessor
     * for `field`, applies an initial value (callback → binding; otherwise
     * constant), and registers optional tween/mapper metadata used by `set()`
     * and `to()`.
     *
     * Subsequent calls for the same field reuse the existing slot and act as
     * a value assignment, so subclasses can override a parent's default by
     * calling applyProp again without losing the slot or its bindings.
     */
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
                // A binding that reads `undefined` — a node reference to a node that is
                // not there — leaves the prop as a node built without it, and never
                // reaches the mapper, which holds the shape the prop's readers go through.
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

    /**
     * This node's **class** name, for a message or a host's type column. Not an
     * authored identity — those are {@link id} and {@link key}, and nothing in
     * the document model is called a name any more. Nor is it the registry key a
     * document writes in `NodeSpec.type`: a minifier is free to rename a class.
     */
    get className(): string {
        return this.constructor.name;
    }

    set(props: { [K in keyof P]?: P[K] | (() => P[K]) }): void {
        const slots = this.__cells?.slots;
        if (!slots) return;
        // Iterate the caller's keys (usually 1–3) rather than every registered
        // prop (15+): set() runs in the per-frame hot path. Only keys backed by
        // a slot are written; unknown keys are ignored — which is also what
        // lets a subclass distribute its own sugar (2D's `size`, `transform3D`)
        // into real keys and then delegate here.
        for (const key in props) {
            const val = (props as any)[key];
            if (val !== undefined && slots.has(key)) this._writeProp(key, val);
        }
    }

    to<D extends Partial<P> = Partial<P>>(args: CommandArgs<D> & { duration: number }): Command<P> {
        return toCommand<P>(this, args.data ?? {}, args.duration, args.easing);
    }

    /**
     * Build a {@link Command} from a pure function of normalized time — an
     * animation this node can be *evaluated* at, not only run through. The pair
     * to {@link to}, for the built-in commands whose values at `t` are not a prop
     * list, and what a component command's timeline lowers to.
     *
     * Snapshot whatever the animation starts from *outside* `at`: reading a prop
     * inside it would re-read the value the command is itself writing.
     */
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

    /**
     * Resolve a single `to()` step into a flat {@link TweenStepper} — all the
     * per-key setup (mapper, numeric-vs-custom routing) happens once here, then
     * `advance(dt)` is allocation-free. Used by both a chain's iterator path and
     * the batched `parallel` path.
     *
     * A subclass with positional sugar of its own (2D's `size` and anchors)
     * expands `to` in place and then delegates here.
     */
    _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        if (!this._mounted) return inertStepper(duration);
        // A tween runs in stored space, so the destination is mapped once, here,
        // and every step after it is a stored value written to the slot as it is.
        // Writing a step through the setter would map it a second time, which only
        // an idempotent mapper survives.
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
            // A discrete prop has nothing between its endpoints, so it snaps at
            // the end rather than interpolating. Applied here rather than only in
            // `advance` because a `seek` past the end has, by definition, reached
            // that end — leaving it out meant `seek(duration)` and running to
            // `duration` produced different nodes, and only the second was right.
            if (hasSnaps && t >= 1) for (const [slot, val] of stringSnaps) slot.set(val);
        };

        let elapsed = 0;
        return {
            // Tracks `elapsed`, so a seek and a subsequent advance agree about
            // where the tween is. Without it, seeking forward then advancing
            // rewound to `dt`.
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

    // ---- State stack (save / restore) -------------------------------------
    // A per-node LIFO stack of property snapshots, mirroring Motion Canvas's
    // node.save()/restore(). `save()` pushes a snapshot of every declared prop;
    // `restore()` pops the most recent one and either snaps to it (no duration)
    // or tweens the numeric props back to it over `duration`.

    /** @internal LIFO stack of save() snapshot layers. Underscore-internal so the prop companion can read it; not authoring surface. */
    _stateStack: PropLayer[] = [];

    /**
     * Push a snapshot of this node's current state onto its save stack.
     *
     * Every reactive prop (`x`, `y`, `scale`, `opacity`, `fill`, …) is captured,
     * preserving reactive bindings — a prop bound to `() => other().x` is saved
     * as the binding, not just its resolved value, so {@link restore} re-binds
     * it rather than freezing the value. Calls stack: each `save()` pushes a new
     * layer, and each {@link restore} pops the most recent one.
     *
     * @example
     * node.save();
     * node.moveTo({ data: { x: 200, y: 0 }, duration: 1 });
     * node.restore({ duration: 1 });   // animate back to where it was saved
     */
    save(): void {
        saveState(this);
    }

    /**
     * Pop the most recent {@link save} snapshot and roll this node back to it.
     *
     * Called with no `duration` (or `0`), every prop is reapplied instantly —
     * plain values are set, reactive bindings are re-bound. Called with a
     * positive `duration`, the numeric props (and any with a custom `tween`)
     * animate toward their saved values over that many seconds; once the tween
     * finishes the full snapshot is reapplied, which re-binds any reactive props
     * and snaps non-tweenable props (e.g. strings) to their saved values.
     *
     * A no-op (returns immediately) if there is nothing on the stack.
     */
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

    // ---- Clock ------------------------------------------------------------

    protected _time: MutableNodeTime = createNodeTime();

    /** This node's place on the scene clock. See {@link NodeTime}. */
    public get time(): NodeTime {
        if (_observer !== null) _observer.clock?.(this);
        return this._time;
    }

    /**
     * Advance **this node's** clock to `total` clip-seconds and sample its
     * derived render state.
     *
     * Per-node, not per-subtree: {@link attach} already recurses, so a recursive
     * advance here would re-advance every descendant once per ancestor.
     *
     * Sampling happens here, not at render: this runs on every advanced frame in
     * every playback path (forward, scrub, precomp), whereas `render` runs only
     * for displayed frames. Sampling per-frame is what makes velocity correct on
     * the first frame after a scrub/rewind, where sampling only at render time
     * read zero. The advance loop runs before `generator.next()` (so audio
     * scheduling in generator bodies reads the right time), which means x/y here
     * still hold the previous frame's value — velocity therefore trails the
     * rendered position by one frame. That lag is constant and identical forward
     * vs. scrub, and imperceptible for motion blur.
     */
    private _advanceOwnTime(total: number): void {
        advanceNodeTime(this._time, total);
        this._sample();
    }

    /**
     * Sample this node's own derived render state for the current frame. Nothing
     * to derive in the general case; {@link Node2D} samples its motion here.
     *
     * @internal The per-node half of `sampleTree` — a walk, not a node method.
     */
    _sample(): void { }

    /**
     * Record this node's current position as the motion history's previous
     * frame, stamped `at`, deriving no velocity.
     *
     * @internal The per-node half of `primeMotionTree`.
     */
    _primeMotion(at: number): void { }

    // ---- Attachment -------------------------------------------------------

    /**
     * Put this subtree into the scene: mark it mounted, bind the asset catalog
     * and inherited context, advance its clock to `scope.time`.
     *
     * Safe and cheap to call every frame — an unchanged catalog/context
     * short-circuits, and {@link resolveContext} fires only on first attach.
     *
     * @internal Driven by `ClipInstance` per frame, and by {@link add} for a mid-frame subtree.
     */
    attach(scope: AttachScope): void {
        const first = !this._mounted;
        this._mounted = true;

        if (this._assets !== scope.assets) this._assets = scope.assets;

        const next = this.provideContext(scope.context);
        // Unchanged map, already bound, and not this instance's first attach ⇒
        // the whole subtree already holds `next` and the walk below would be pure
        // repetition of the context half. The time half still has to run.
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
     * Take this subtree out of the scene. Not a teardown — props/children/bindings
     * stay, so it can be attached elsewhere (`reparent`). {@link dispose} tears down.
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

    // ---- Context lifecycle ------------------------------------------------

    /**
     * Apply inherited context **values** to this node, once, after it's linked
     * into the tree and ancestor providers have resolved: a component's
     * `inherit` entries. Runs exactly once per instance.
     */
    protected resolveContext(ctx: ContextMap): void { }

    /**
     * The {@link ContextMap} handed to descendants: a component's `provide`
     * adds its tokens. The base passes the parent's map through unchanged.
     */
    protected provideContext(parent: ContextMap): ContextMap {
        return parent;
    }

    /**
     * Bind `node`'s asset catalog, context and clock without making it a child —
     * for a node used purely as a pixel source (`Tex.surface`), laid out on
     * demand rather than sitting in the tree.
     */
    protected attachDetached(node: Node): void {
        const scope = this._currentScope();
        if (scope) node.attach(scope);
    }

    /**
     * Declare what this node draws from its props and inherited context alone —
     * never `layoutBounds` or the clock. The runtime records what this reads and
     * calls it again only when one of those props is written, so anything else it
     * depends on is a change nobody will ask about.
     */
    declareAssets(assets: AssetScope): void { }

    get children(): Node[] {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this._children;
    }

    /**
     * Every child, both dimensions, unfiltered — unlike {@link children}, which
     * a {@link Node2D} filters to its own kind. Used where index has to match
     * the authored tree (picking), since filtering would renumber it.
     */
    get _allChildren(): readonly Node[] {
        if (_observer !== null) _observer.read(this._structureSlot());
        return this._children;
    }

    /**
     * Add children — a node, an array, or a nested mix; falsy entries
     * (`cond && node`) are dropped. A child of the other dimension throws —
     * see {@link acceptsChild}.
     */
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

    /** Remove every child, detaching each (see {@link remove}). */
    clear(): void {
        for (const child of this._children) {
            if (_observer !== null) this._structureChanged(child);
            child._parent = null;
            child.detach();
        }
        this._children.length = 0;
    }

    /**
     * Insert `child` at `index` among this node's children.
     *
     * On {@link Node} rather than {@link Node2D} because it is tree machinery —
     * `ClipTimeline.syncPresence` reaches for it on whatever a spec's
     * `parentId` names, which since audio joined the graph is not always a 2D
     * node. `Node2D` overrides it for the animated insert, which measures the
     * child off-tree and so needs a laid-out one.
     */
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
