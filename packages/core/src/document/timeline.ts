import { clamp01 } from "@/util/clamp";
import { applySnapshotLayer, captureLayer, type PropLayer, type ReactiveHost } from "@/components/trees/node/node-reactive";
import type { Node, NodeDimension } from "@/components/trees/node/node";
import type { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { _observer, PropSlot, type PropSnapshot } from "@/props/slot";
import { LAYOUT_SLOT, observeSlots, PRESENCE_PREFIX, unobserved, VAR_PREFIX, type SlotObserver } from "@/props/observer";
import { driveCommand, loopCommand, settles, settling, type Command } from "@/tween/command";
import { loopRepeats } from "@/tween/loop";
import type { EasingFunction } from "@/tween/ease/type";
import { easeOfSpec } from "@/tween/ease/spec";
import { commandNodeRefs, commandTraits, hasNodeRef, holdsWhenFinished, isContextProvider, isLayoutNeutralProp, writesPlacementInPlace } from "./command-traits";
import { diffClip, jsonEqual } from "./diff";
import { indexDocument, type DocIndex } from "./doc-index";
import { expressionOps } from "./expression/ops";
import { MISSING_TYPE, missingNode, missingNodeOf, placeholderProps } from "./missing-node";
import { migrateNodeProps } from "./prop-evolution";
import type { VariableResolver } from "./expression/types";
import type { Registry, VariableTarget } from "./registry";
import { SettledIndex } from "./settled-index";
import { commandSoundsOf } from "@/components/factory/timeline";
import type { SoundOptions } from "@/components/factory/api";
import { planTimelinePatch, type PatchEnvironment, type TimelinePatch } from "./timeline-patch";
import type { CommandSpec, EaseSpec, NodeSpec, NodeSpan, VisualDocument, VariableSpec } from "./types";
import { documentDuration, effectiveSpanIn, isStillDocument, nodeSpan, ROOT_NODE_ID } from "./types";

export interface PlacedSound {
    readonly node: Node;
    readonly at: number;
    readonly until: number | undefined;
    readonly src: string;
    readonly options: SoundOptions;
}

export interface TimelineIssue {
    code: "unknown-node-type" | "unknown-command";
    message: string;
    nodeId?: string;
    commandId?: string;
    type: string;
}

export interface PlacedCommandInfo {
    readonly spec: CommandSpec;
    readonly start: number;
    /** Zero is a stamp: it applies in full from `start` onward. */
    readonly duration: number;
    /** `start`, or for an entrance the earlier time its first frame is held from. */
    readonly holdFrom: number;
    readonly writes: ReadonlySet<PropSlot<unknown>>;
    readonly readsLayout: boolean;
}

interface PlacedCommand extends PlacedCommandInfo {
    readonly command: Command<Record<string, unknown>>;
    readonly writes: Set<PropSlot<unknown>>;
    /** What an unmarked one may read while it runs: its owner's slots and what it read while built. Empty for a marked one. */
    readonly reads: ReadonlySet<PropSlot<unknown>>;
    /** Its neighbours decide it, so it is worked out again after every compile and update. */
    holdFrom: number;
    readonly entrance: boolean;
    readonly owner: LiveNode | LiveVariable;
}

/** A plain slot: a prop bound to `() => slot.get()` re-reads it, so nothing in the node layer knows variables exist. */
interface LiveVariable {
    spec: VariableSpec;
    /** Kept across an update: every binding compiled against it captured {@link read}, which reads this. */
    cell: PropSlot<unknown>;
    read: () => unknown;
    target: VariableTarget;
    baseline: unknown;
}

interface LiveNode {
    spec: NodeSpec;
    node: Node;
    /** Every reactive cell as the build left it, before any command or arrival touched it. */
    initial: PropLayer;
    initialStackDepth: number;
    /** What evaluation restores: {@link initial}, or the node as it arrived when it enters later. */
    baseline: PropLayer;
    baseStackDepth: number;
    /** A slot, so a `[key.prop]` read under an observer depends on it: the node answering can come and go. */
    presence: PropSlot<boolean>;
}

interface WalkStep {
    at: number;
    spec?: CommandSpec;
    capture?: string;
}

function resolveEase(ease: EaseSpec | undefined, registry: Registry): EasingFunction | undefined {
    if (!ease) return undefined;
    return easeOfSpec(ease, (key) => registry.ease(key), () => registry.easeKeys());
}

/** By `at`, then document order: commands sharing an `at` run in parallel and the later one wins a shared prop, as in `commandParallel`. */
function inTimelineOrder(commands: readonly CommandSpec[]): CommandSpec[] {
    return commands
        .map((spec, index) => ({ spec, index }))
        .sort((a, b) => (a.spec.at - b.spec.at) || (a.index - b.index))
        .map((e) => e.spec);
}

const NO_SLOTS: ReadonlySet<PropSlot<unknown>> = new Set();

/**
 * Only an unmarked command can read live state while it runs, so only its reads are kept. A slot
 * snapshot (`save`) reads without reporting it, so everything it acts on counts as read.
 */
function readsOf(command: Command<Record<string, unknown>>, recorder: WriteRecorder, owned: Iterable<PropSlot<unknown>>): ReadonlySet<PropSlot<unknown>> {
    if (settles(command)) return NO_SLOTS;
    for (const slot of owned) recorder.reads.add(slot);
    return recorder.reads;
}

/** Marks the command `settling` when `held`; a looped one is wrapped after, and runs. */
function heldIf(held: boolean, made: Command<Record<string, unknown>> | void): Command<Record<string, unknown>> | void {
    return held && made ? settling(made) : made;
}

function defaultRootSpec(): NodeSpec {
    return { id: ROOT_NODE_ID, type: "canvas2d", parentId: null, layerOrder: 0, props: {} };
}

/**
 * Split out the scene root, which is the canvas itself: not something `build` instantiates or `syncPresence`
 * parents. Synthesizes the default when the document left it out.
 */
function splitRoot(specs: NodeSpec[]): { root: NodeSpec; rest: NodeSpec[] } {
    const rest: NodeSpec[] = [];
    let root: NodeSpec | undefined;
    for (const spec of specs) {
        if (spec.id === ROOT_NODE_ID && spec.type === "canvas2d") {
            root = spec;
            continue;
        }
        rest.push(spec);
    }
    return { root: root ?? defaultRootSpec(), rest };
}

/** Read off the document, not accumulated in playback, so a seek lands the same from any direction. A still's nodes carry no span: always present. */
function presenceOf(doc: VisualDocument): Map<string, NodeSpan> {
    const spans = new Map<string, NodeSpan>();
    for (const node of doc.nodes) spans.set(node.id, nodeSpan(node));
    spans.delete(ROOT_NODE_ID);
    return spans;
}

/**
 * A compiled clip document, evaluable at any time in any order. Commands are built in `at` order, each run to
 * `at(1)` before the next is built, because a command reads its start value from the node when constructed;
 * the restored baseline undoes that. Expressions bind props to variable slots and recompute on read, so a
 * node driven only by expressions is never restored.
 */
export class ClipTimeline {
    constructor(doc: VisualDocument, registry: Registry, private readonly canvas: Canvas2D) {
        this._doc = doc;
        this._registry = registry;
        const { root, rest } = splitRoot(doc.nodes);
        this._rootSpec = root;
        this._specs = rest;
        this._varSpecs = doc.variables ?? [];
        // Built from the rows rather than from the tree: an expression resolves its
        // references the moment it compiles, which is before most nodes exist.
        this._keyed = new Map(
            [root, ...rest]
                .filter((spec): spec is NodeSpec & { key: string } => !!spec.key)
                .map((spec) => [spec.key, spec.id]),
        );
        this._spans = presenceOf(doc);
        // Declared, not measured, so it is known before anything is built.
        this._duration = documentDuration(doc);
    }

    get duration(): number {
        return this._duration;
    }

    /** Once per timeline: the nodes it makes belong to that canvas. */
    build(): void {
        // Variables first: an expression resolves its `[id]`s the moment it compiles.
        this._buildVariables();

        this._pristineRoot = captureLayer(this.canvas as unknown as ReactiveHost);
        this._applyRootProps();

        for (const spec of this._specs) {
            this._live.set(spec.id, {
                spec,
                node: this._instantiate(spec),
                initial: NO_LAYER,
                initialStackDepth: 0,
                baseline: NO_LAYER,
                baseStackDepth: 0,
                presence: new PropSlot<boolean>(false, null, PRESENCE_PREFIX + spec.id),
            });
        }

        // Before any document child lands, so a composite's own children keep their indices.
        this._baseChildCount.set(ROOT_NODE_ID, this.canvas._allChildren.length);
        for (const [id, entry] of this._live) {
            this._baseChildCount.set(id, entry.node._allChildren.length);
        }

        this.syncPresence(0);

        // The root's baseline too: `targetId: null` commands animate the camera and scene fill.
        this._root = {
            spec: this._rootSpec,
            node: this.canvas,
            initial: NO_LAYER,
            initialStackDepth: 0,
            baseline: NO_LAYER,
            baseStackDepth: 0,
            presence: new PropSlot<boolean>(true, null, PRESENCE_PREFIX + ROOT_NODE_ID),
        };
        for (const entry of this._live.values()) captureInitial(entry);
        captureInitial(this._root);
        this._baselined = new Set(this._present);
        for (const id of this._present) {
            if (this._live.get(id)?.node.mounted === false) {
                this._baselined.delete(id);
                this._unmounted.add(id);
            }
        }
    }

    /**
     * Build every command against the laid-out tree, then put the tree back. Separate from {@link build} because a
     * command may read post-layout state (an animated `removeChildAt` pins the departing child to its rendered
     * width, zero until layout runs). `settle` re-lays out whenever the walk changes the tree.
     */
    compile(settle: () => void = () => { }): void {
        this._settled = null;
        this._compileCommands(settle);
        this._restoreBaselines();
        const moved = this.syncPresence(0);
        if (this._restoreDisplaced(this._collectDisplaced()) || moved) settle();
        this._holdEntrances();
        this._indexSettled();
    }

    variableValue(id: string): unknown {
        return this._vars.get(id)?.cell.get();
    }

    variables(): readonly VariableSpec[] {
        return this._varSpecs;
    }

    get presenceTime(): number {
        return this._presenceIndex().time;
    }

    commandSounds(): PlacedSound[] {
        const out: PlacedSound[] = [];
        for (const placed of this._placed) {
            const played = commandSoundsOf(placed.command);
            if (!played) continue;
            for (const sound of played.sounds) {
                out.push({
                    node: played.host,
                    at: placed.start + sound.at,
                    until: sound.until === undefined ? undefined : placed.start + sound.until,
                    src: sound.src,
                    options: sound.options,
                });
            }
        }
        return out;
    }

    placedCommands(): readonly PlacedCommandInfo[] {
        return this._placed;
    }

    issues(): TimelineIssue[] {
        const out: TimelineIssue[] = [];
        for (const { spec, node } of this._live.values()) {
            const missing = missingNodeOf(node);
            if (!missing) continue;
            out.push({
                code: "unknown-node-type",
                nodeId: spec.id,
                type: missing.type,
                message: `Unknown node type "${missing.type}" (node ${spec.id}): it builds as an empty placeholder, keeping its children.`,
            });
        }
        out.push(...this._skipped.values());
        return out;
    }

    /**
     * Pure in `seconds`: any order, either direction. Restoring the baseline first is what makes it so, or a prop
     * written by a not-yet-started command would keep the last evaluation's value. `onWrite` reports each
     * command write (not the restore) with its index in {@link placedCommands}.
     */
    evaluateAt(seconds: number, onWrite?: (index: number, slot: PropSlot<unknown>) => void): void {
        if (onWrite) {
            // Unobserved: a baseline holds prop cells, never presence or structure, so
            // an observer watching for those learns nothing from a write per cell.
            unobserved(() => this._restoreBaselines());
            this._evaluateObserved(seconds, onWrite);
            return;
        }

        if (this._settled) {
            this._restoreBaselines(this._wholeRestore);
            for (const { slot, baseline } of this._slotRestore) slot.restoreFrom(baseline);
            this._settled.evaluate(this._placed, seconds);
            return;
        }
        this._restoreBaselines();
        for (const placed of this._placed) {
            if (seconds < placed.holdFrom) continue;
            const local = seconds < placed.start ? 0
                : placed.duration > 0 ? (seconds - placed.start) / placed.duration
                    : 1;
            // Held at `at(1)` once finished, so an early write persists (as in `commandSequence`).
            placed.command.at(clamp01(local));
        }
    }

    /**
     * Add and remove document nodes so the tree matches `seconds`; returns whether anything moved. Structural, so
     * separate from {@link evaluateAt}: it changes what layout walks. Call it ahead of the evaluation.
     */
    syncPresence(seconds: number): boolean {
        const rows = this._presenceIndex().crossed(seconds);
        if (rows.length === 0) return false;

        const arrivals: PresenceRow[] = [];
        const departures: PresenceRow[] = [];
        for (const row of rows) {
            const wanted = within(row, seconds);
            if (wanted !== this._present.has(row.id)) (wanted ? arrivals : departures).push(row);
        }
        this._arrived = arrivals;
        if (arrivals.length === 0 && departures.length === 0) return false;

        // Detach first: `remove` unmounts the whole subtree, so a node moving
        // parents is never briefly in two places.
        departures.sort(byDocumentOrder);
        for (const row of departures) {
            this._present.delete(row.id);
            row.siblings.add(row.slot, -1);
            const entry = this._live.get(row.id);
            if (!entry) continue;
            entry.presence.set(false);
            this._parentNodeOf(entry.spec)?.remove(entry.node);
        }

        // After whatever the parent built for itself, at the row's place among present siblings. Ascending per
        // parent, so every earlier sibling is already in place.
        arrivals.sort(byDocumentOrder);
        const byParent = new Map<SiblingCounts, PresenceRow[]>();
        for (const row of arrivals) {
            const group = byParent.get(row.siblings);
            if (group) group.push(row);
            else byParent.set(row.siblings, [row]);
        }
        for (const [siblings, group] of byParent) {
            group.sort((a, b) => a.slot - b.slot);
            const parent = siblings.parentId === ROOT_NODE_ID ? this.canvas : this._live.get(siblings.parentId)?.node;
            const base = this._baseChildCount.get(siblings.parentId) ?? 0;
            for (const row of group) {
                this._present.add(row.id);
                const index = base + siblings.before(row.slot);
                siblings.add(row.slot, 1);
                const child = this._live.get(row.id);
                if (!child) continue;
                child.presence.set(true);
                parent?.addChildAt({ data: { child: child.node, index } });
            }
        }
        return true;
    }

    liveNode(id: string): Node | undefined {
        return id === ROOT_NODE_ID ? this.canvas : this._live.get(id)?.node;
    }

    /** A row's props before any command acted on it; the same at every time, unlike the live props. A bound prop answers through its binding. */
    baselineProps(id: string): Record<string, unknown> | undefined {
        const entry = id === ROOT_NODE_ID ? this._root : this._live.get(id);
        if (!entry) return undefined;
        const layer = entry.baseline === NO_LAYER ? entry.initial : entry.baseline;
        const props: Record<string, unknown> = {};
        for (const [key, snap] of layer) props[key] = snap.fn ? snap.fn() : snap.value;
        return props;
    }

    presenceSlot(id: string): PropSlot<boolean> | undefined {
        return id === ROOT_NODE_ID ? this._root?.presence : this._live.get(id)?.presence;
    }

    variableSlot(id: string): PropSlot<unknown> | undefined {
        return this._vars.get(id)?.cell;
    }

    /**
     * How to bring this built timeline to `next` in place, or `null` when only a
     * fresh build is sound. An audio document must be lowered by the caller first.
     */
    planUpdate(next: VisualDocument): TimelinePatch | null {
        const prev = this._docIndex ??= indexDocument(this._doc);
        return planTimelinePatch(prev, indexDocument(next), diffClip(this._doc, next), this._patchEnvironment());
    }

    /**
     * Apply a {@link planUpdate} result. The canvas must be attached at time 0
     * first, as for {@link build}; `prepare` samples and lays out like the step
     * between build and compile, `settle` like compile's. A throw leaves the
     * timeline unusable — dispose it and build fresh.
     */
    applyUpdate(patch: TimelinePatch, settle: () => void, prepare: () => void): void {
        if (!this._root) throw new Error("ClipTimeline.applyUpdate needs a built timeline.");
        if (patch.prev !== this._docIndex) {
            throw new Error("This patch was planned against a different version of the document.");
        }

        this._settled = null;
        this._restoreBaselines();
        this.syncPresence(0);

        this._updateVariables(patch);
        this._keyed.clear();
        for (const [key, id] of patch.next.keyed) this._keyed.set(key, id);

        const fresh = this._updateStructure(patch);

        for (const entry of fresh) {
            captureInitial(entry);
            const id = entry.spec.id;
            if (!this._present.has(id)) continue;
            if (entry.node.mounted) this._baselined.add(id);
            else this._unmounted.add(id);
        }
        for (const id of patch.inPlace) {
            const entry = this._live.get(id);
            if (entry) this._writeInPlace(entry, patch.prev.nodes.get(id)!);
        }
        if (patch.diff.rootChanged) {
            const host = this.canvas as unknown as ReactiveHost;
            applySnapshotLayer(host, this._pristineRoot);
            host._stateStack.length = 0;
            this._applyRootProps();
            captureInitial(this._root);
        }
        for (const id of patch.dirtyNodes) {
            const entry = id === ROOT_NODE_ID ? this._root : this._live.get(id);
            if (entry && !fresh.has(entry)) resetToInitial(entry);
        }
        prepare();

        const previous = new Map<string, PlacedCommand>();
        for (const placed of this._placed) previous.set(placed.spec.id, placed);
        const rebuilt = this._walkPatch(patch, previous, settle);

        const dirty = (id: string) => patch.dirtyNodes.has(id) || patch.dirtyVariables.has(id);
        const placed: PlacedCommand[] = [];
        const touched = new Set<TouchedOwner>();
        this._animated = [];
        this._animatedVars = [];
        this._animatedParts = [];
        if (!isStillDocument(this._doc)) {
            for (const spec of patch.next.ordered) {
                let entry = rebuilt.get(spec.id);
                if (!entry && !dirty(patch.next.targetOf(spec))) {
                    const old = previous.get(spec.id);
                    if (old) entry = old.spec === spec ? old : { ...old, spec };
                }
                if (!entry) continue;
                placed.push(entry);
                this._touch(entry, touched);
            }
        }
        this._placed = placed;
        for (const id of this._skipped.keys()) if (!patch.next.commands.has(id)) this._skipped.delete(id);

        this._restoreBaselines();
        const moved = this.syncPresence(0);
        if (this._restoreDisplaced(this._collectDisplaced()) || moved) settle();
        this._holdEntrances();
        this._indexSettled();
    }

    private _doc: VisualDocument;
    private readonly _registry: Registry;
    private _rootSpec: NodeSpec;
    private _specs: NodeSpec[];
    private _varSpecs: readonly VariableSpec[];
    private _spans: Map<string, NodeSpan>;
    private _duration: number;
    private _docIndex: DocIndex | null = null;
    /** The canvas's cells before the root row was applied — what a patched root row resets to. */
    private _pristineRoot: PropLayer = NO_LAYER;

    private readonly _live = new Map<string, LiveNode>();
    private readonly _vars = new Map<string, LiveVariable>();
    /** Node ids by {@link NodeSpec.key}. Read off the document, so it needs no build. */
    private readonly _keyed: Map<string, string>;
    private _placed: PlacedCommand[] = [];
    private readonly _skipped = new Map<string, TimelineIssue>();
    /** Built after every compile and update, when any placed command is marked settling (`tween/command`). */
    private _settled: SettledIndex | null = null;
    /** With {@link _settled}: the animated nodes an unmarked command writes, put back whole… */
    private _wholeRestore: LiveNode[] = [];
    /** …and, on every other animated node, the baseline of each slot a marked command writes. */
    private _slotRestore: SlotBaseline[] = [];
    private _root: LiveNode | null = null;
    /**
     * Only nodes some command writes: restoring static nodes every frame is most of the frame on a large scene. A
     * prop bound to a variable needs no restore (the binding is the recompute), so expression-only nodes never enter.
     */
    private _animated: LiveNode[] = [];
    private _animatedVars: LiveVariable[] = [];
    /** Slots on a part a node built for itself that a command writes. A part is no row; see {@link _notePartWrite}. */
    private _animatedParts: PropSlot<unknown>[] = [];
    private readonly _partBaselines = new WeakMap<PropSlot<unknown>, PropSnapshot<unknown>>();
    /** Children each parent built for itself, which the document must not disturb. */
    private readonly _baseChildCount = new Map<string, number>();
    private readonly _present = new Set<string>();
    private _baselined = new Set<string>();
    /** Rows present at 0 that a lifecycle command (`removeChildAt`, `reparent`) took out of their parent. Presence only moves a row across its own span. */
    private _displaced: LiveNode[] = [];
    /** Rows that arrived, or were built, while an ancestor was out of the tree and wait for it — see {@link _baselineArrival}. */
    private readonly _unmounted = new Set<string>();
    private _presence: PresenceIndex | null = null;
    private _arrived: readonly PresenceRow[] = [];

    /**
     * A reference with a dot (`[card.x]`) reads another node's prop; without one, a variable.
     *
     * A node reference resolves late, on every read: `build` binds in document order and presence changes with
     * time, so the node may not exist yet or be absent at *t*. It answers `undefined` (`NaN` through arithmetic,
     * loud in the first frame) rather than throwing, which would make an `add` at 2s a crash at 0s.
     */
    private readonly _resolveVariable: VariableResolver = (name) => {
        const dot = name.indexOf(".");
        if (dot > 0) {
            const id = this._keyed.get(name.slice(0, dot));
            if (id === undefined) return undefined;
            const prop = name.slice(dot + 1);
            return () => (this._nodeById(id) as unknown as Record<string, unknown> | undefined)?.[prop];
        }
        return this._vars.get(name)?.read;
    };

    /** Gated on `mounted`, not {@link _present}, which only settles at the end of {@link syncPresence}: a read mid-insertion would be stale. */
    private _nodeById(id: string): Node | undefined {
        if (id === ROOT_NODE_ID) return this.canvas;
        const entry = this._live.get(id);
        if (!entry) return undefined;
        if (_observer !== null) this._readPresence(entry);
        return entry.node.mounted ? entry.node : undefined;
    }

    /** The row's presence and every document ancestor's — an ancestor leaving unmounts it too. */
    private _readPresence(entry: LiveNode): void {
        let at: LiveNode | undefined = entry;
        for (let depth = 0; at && depth <= this._live.size; depth++) {
            at.presence.get();
            at = at.spec.parentId === null ? undefined : this._live.get(at.spec.parentId);
        }
    }

    private _applyRootProps(): void {
        const { literal, bindings } = expressionOps.bindProps(this._rootSpec.props, this._resolveVariable);
        this.canvas.set({ ...literal, ...bindings } as never);
    }

    private _instantiate(spec: NodeSpec, rows: readonly NodeSpec[] = this._specs): Node {
        const props = migrateNodeProps(this._registry, spec.type, spec.props).props;
        const { literal, bindings, hasBindings } = expressionOps.bindProps(props, this._resolveVariable);
        if (!this._registry.strict && !this._registry.hasNode(spec.type)) {
            const dimension = this._placeholderDimension(spec, rows);
            const node = missingNode(dimension, spec, literal);
            const bound = placeholderProps(dimension, bindings);
            if (Object.keys(bound).length > 0) node.set(bound as never);
            return node;
        }
        const node = this._registry.instantiate(spec, literal);
        // Applied after construction rather than through it: see `instantiate`.
        if (hasBindings) node.set(bindings as never);
        return node;
    }

    /** One slot per variable for the whole build: a variable has no presence span. */
    private _buildVariables(): void {
        for (const spec of this._varSpecs) {
            if (this._vars.has(spec.id)) {
                throw new Error(
                    `Duplicate variable id "${spec.id}". Ids must be unique — an expression ` +
                    `writing "[${spec.id}]" would otherwise name whichever declaration was read last.`,
                );
            }
            this._vars.set(spec.id, this._liveVariable(spec));
        }
    }

    private _liveVariable(spec: VariableSpec): LiveVariable {
        const cell = new PropSlot<unknown>(spec.value, null, VAR_PREFIX + spec.id);
        return {
            spec,
            cell,
            read: () => cell.get(),
            target: this._variableTarget(spec, cell),
            baseline: spec.value,
        };
    }

    private _variableTarget(spec: VariableSpec, cell: PropSlot<unknown>): VariableTarget {
        const lerp = this._registry.requireLerp(spec.lerp, spec.value, `variable "${spec.id}"`);
        return { id: spec.id, get: () => cell.get(), set: (v) => cell.set(v), lerp };
    }

    /**
     * Put every animated node back to its authored state. The save stack is truncated with the props: `save` and
     * `restore` are commands, so a `save` re-runs on every evaluation and the stack would grow per frame, and a
     * `restore` would pop another seek's layer.
     */
    private _restoreBaselines(nodes: readonly LiveNode[] = this._animated): void {
        // Structure before props: a node put back is attached, and the baseline is
        // what it holds once attached.
        this._restoreDisplaced(this._displaced);

        // Variables first, so a prop bound to one recomputes against the restored
        // value rather than a stale one.
        for (const entry of this._animatedVars) entry.cell.set(entry.baseline);

        for (const entry of nodes) {
            const host = entry.node as unknown as ReactiveHost;
            applySnapshotLayer(host, entry.baseline);
            if (host._stateStack.length > entry.baseStackDepth) {
                host._stateStack.length = entry.baseStackDepth;
            }
        }

        for (const slot of this._animatedParts) slot.restoreFrom(this._partBaselines.get(slot)!);
    }

    /**
     * Build every command, in timeline order, against a node holding what its predecessors left. The tree moves to
     * each command's `at` first: an unmounted node hands back an inert stepper the command caches, so a tween on a
     * node entering at 2s built against the t=0 tree would never move. Arrivals are baselined here, before
     * anything touches them. Re-layout only where something reads it ({@link _settleWindows}).
     */
    private _compileCommands(settle: () => void): void {
        if (isStillDocument(this._doc)) return;

        const touched = new Set<TouchedOwner>();
        const ordered = inTimelineOrder(this._doc.commands);
        const refBound = this._refBound(ordered);
        const settles = this._settleWindows(ordered, (i) => this._readsLayout(ordered[i], refBound));

        for (let i = 0; i < ordered.length; i++) {
            const spec = ordered[i];
            if (this.syncPresence(spec.at)) {
                // Every node present but not yet baselined arrived in this sync:
                // one that left and came back was baselined the first time.
                for (const row of this._arrived) {
                    if (!this._baselined.has(row.id)) this._baselineArrival(row.id);
                }
                this._baselineMounted();
                if (settles[i]) settle();
            }

            const placed = this._buildPlaced(spec);
            if (!placed) continue;
            this._placed.push(placed);
            this._touch(placed, touched);
        }
    }

    /**
     * Building runs every marked command to its end, which the restore then undoes.
     * A node only marked commands write keeps every other slot at its baseline from
     * here on, so an evaluation puts back only the slots they write.
     */
    private _indexSettled(): void {
        const index = (this._settled = SettledIndex.build(this._placed));
        if (!index) return;
        this._restoreBaselines();

        const whole = new Set<LiveNode | LiveVariable>();
        const written = new Map<LiveNode, Set<PropSlot<unknown>>>();
        this._placed.forEach((placed, i) => {
            const held = index.holds(i);
            if (!held) whole.add(placed.owner);
            for (const slot of placed.writes) {
                const host = slot._host;
                const entry = host === null ? undefined : host.id === ROOT_NODE_ID ? this._root! : this._live.get(host.id);
                if (!entry) continue;
                if (!held) whole.add(entry);
                else if (written.has(entry)) written.get(entry)!.add(slot);
                else written.set(entry, new Set([slot]));
            }
        });
        this._wholeRestore = [];
        this._slotRestore = [];
        for (const entry of this._animated) {
            const slots = whole.has(entry) ? null : slotBaselines(entry, written.get(entry));
            if (slots) this._slotRestore.push(...slots);
            else this._wholeRestore.push(entry);
        }
    }

    private _collectDisplaced(): LiveNode[] {
        const out: LiveNode[] = [];
        for (const id of this._present) {
            const entry = this._live.get(id);
            const parent = entry && this._declaredParent(id);
            if (entry && parent && entry.node.parent !== parent) out.push(entry);
        }
        out.sort((a, b) => this._presenceIndex().row(a.spec.id)!.slot - this._presenceIndex().row(b.spec.id)!.slot);
        return (this._displaced = out);
    }

    /** Put displaced rows back where {@link syncPresence} would have inserted them. */
    private _restoreDisplaced(entries: readonly LiveNode[]): boolean {
        let moved = false;
        for (const entry of entries) {
            const id = entry.spec.id;
            const row = this._presenceIndex().row(id);
            const parent = this._declaredParent(id);
            if (!row || !parent || !this._present.has(id) || entry.node.parent === parent) continue;
            entry.node.parent?.remove(entry.node);
            const base = this._baseChildCount.get(row.siblings.parentId) ?? 0;
            parent.addChildAt({ data: { child: entry.node, index: base + row.siblings.before(row.slot) } });
            moved = true;
        }
        return moved;
    }

    private _declaredParent(id: string): Node | undefined {
        const parentId = this._presenceIndex().row(id)?.siblings.parentId;
        if (parentId === undefined) return undefined;
        return parentId === ROOT_NODE_ID ? this.canvas : this._live.get(parentId)?.node;
    }

    /**
     * A baseline is the node as attached: an unmounted node's cells hold pre-attach values, lacking what it inherits.
     * A row arriving while an ancestor is out of the tree (a child entering before its parent) waits in
     * {@link _unmounted} for {@link _baselineMounted}.
     */
    private _baselineArrival(id: string): void {
        const entry = this._live.get(id);
        if (entry && !entry.node.mounted) {
            this._unmounted.add(id);
            return;
        }
        if (entry) captureBaseline(entry);
        this._baselined.add(id);
        this._unmounted.delete(id);
    }

    private _baselineMounted(): void {
        for (const id of this._unmounted) {
            const entry = this._live.get(id);
            if (!entry) {
                this._unmounted.delete(id);
            } else if (entry.node.mounted) {
                captureBaseline(entry);
                this._baselined.add(id);
                this._unmounted.delete(id);
            }
        }
    }

    /**
     * Build one command against the current tree and run it to its end, leaving its target where the next
     * command's `from` must start: `node.to({ x: 100 })` reads `x` at construction, so skipping this would give
     * every chained step the same `from`. Undone by {@link _restoreBaselines}. Throws when the target names no
     * row; a command its target's type lacks, or any aimed at a placeholder, is skipped and recorded (`null`)
     * unless the registry is strict.
     */
    private _buildPlaced(spec: CommandSpec): PlacedCommand | null {
        // The global table is consulted first: it holds only what resolves without a node (variable-scoped
        // commands, generic prop writers), and `scope` decides whether there is a node to look up. Everything
        // else is a method on the target's own type.
        let entry = this._registry.command(spec.type);
        if (entry?.scope !== "variable") {
            const missing = missingNodeOf(this._targetOrThrow(spec).node);
            if (missing) {
                return this._skip(spec, `Command ${spec.id} ("${spec.type}") targets "${spec.targetId}", a placeholder for unknown node type "${missing.type}"; it is skipped.`, spec.type);
            }
        }
        if (!entry) {
            const typeKey = this._targetOrThrow(spec).entry.spec.type;
            const factory = this._registry.nodeCommand(typeKey, spec.type);
            if (!factory) {
                const message = `Node type "${typeKey}" has no command "${spec.type}" ` +
                    `(command ${spec.id}). It publishes: ` +
                    `${this._registry.commandKeys(typeKey).join(", ") || "none"}.` +
                    (LEGACY_COMMAND_HINTS[spec.type] ? ` ${LEGACY_COMMAND_HINTS[spec.type]}` : "");
                if (this._registry.strict) throw new Error(message);
                return this._skip(spec, `${message} It is skipped.`, spec.type);
            }
            entry = { key: spec.type, scope: "node", factory };
        }
        this._skipped.delete(spec.id);

        const duration = spec.duration ?? 0;
        const easing = resolveEase(spec.easing, this._registry);
        const recorder = new WriteRecorder(this._notePartWrite);
        // Applied inside `buildToEnd`, so `at(1)` is the loop's end (back at the start for an odd number of
        // `alternate` passes). A looped command carries every pass's span, so a seek into the fourth repetition lands in it.
        const loop = loopRepeats(spec.loop) ? spec.loop : undefined;
        const repeat = (made: Command<Record<string, unknown>> | void) =>
            (made && loop ? loopCommand(made, loop, this._unlimitedFill(spec.at)) : made);

        if (entry.scope === "variable") {
            const variable = spec.targetId === null ? undefined : this._vars.get(spec.targetId);
            if (!variable) {
                throw new Error(
                    `Command ${spec.id} ("${spec.type}") targets variable "${spec.targetId}", ` +
                    `which this document does not declare.`,
                );
            }
            this._assertNoExpressions(spec);
            const { factory } = entry;
            const held = holdsWhenFinished(commandTraits(this._registry, spec, undefined), spec);
            const command = observeSlots(recorder, () =>
                buildToEnd(() => repeat(heldIf(held, factory(variable.target, spec.args, duration, easing)))));
            return { spec, start: spec.at, holdFrom: spec.at, entrance: false, duration: loop ? command.duration : duration, command, writes: recorder.writes, reads: readsOf(command, recorder, [variable.cell]), readsLayout: recorder.readsLayout, owner: variable };
        }

        const target = this._targetOrThrow(spec);
        // `to` and `set` carry a props diff, so a renamed prop is renamed there too.
        const given = PROP_DIFF_COMMANDS.has(spec.type)
            ? migrateNodeProps(this._registry, target.entry.spec.type, spec.args).props
            : spec.args;
        const args = entry.binds ? this._bindArgs(given) : (this._assertNoExpressions(spec), given);
        const { factory } = entry;
        const held = holdsWhenFinished(commandTraits(this._registry, spec, target.entry.spec), spec);
        const command = observeSlots(recorder, () =>
            buildToEnd(() => repeat(heldIf(held, factory(target.node, args, duration, easing)))));
        const entrance = entry.scope === "node" && this._registry.node(target.entry.spec.type)?.commands.get(spec.type)?.entrance === true;
        return { spec, start: spec.at, holdFrom: spec.at, entrance, duration: loop ? command.duration : duration, command, writes: recorder.writes, reads: readsOf(command, recorder, (target.node as unknown as ReactiveHost).__cells?.slots.values() ?? []), readsLayout: recorder.readsLayout, owner: target.entry };
    }

    /**
     * Hold each entrance's first frame back from its `at` so its node never shows at rest ahead of it: back to the
     * later of the target's arrival and the latest end of an earlier command writing a slot it writes. A command
     * writing other slots on the same node (a `moveTo` while it waits) does not stop it.
     */
    private _holdEntrances(): void {
        const ended = new Map<PropSlot<unknown>, number>();
        let byId: Map<string, NodeSpec> | undefined;
        for (const placed of this._placed) {
            placed.holdFrom = placed.start;
            if (placed.entrance) {
                const id = placed.owner.spec.id;
                byId ??= new Map(this._specs.map((s) => [s.id, s]));
                let from = id === ROOT_NODE_ID ? 0 : effectiveSpanIn(byId, id)?.start ?? placed.start;
                for (const slot of placed.writes) from = Math.max(from, ended.get(slot) ?? -Infinity);
                if (from < placed.start) placed.holdFrom = Math.max(0, from);
            }
            const end = placed.start + placed.duration;
            for (const slot of placed.writes) {
                if (!(end <= (ended.get(slot) ?? -Infinity))) ended.set(slot, end);
            }
        }
    }

    /** `documentDuration` counts one pass of an unlimited loop: a lone spinner is one turn, in a ten-second scene it turns for ten. */
    private _unlimitedFill(at: number): number {
        return Math.max(0, this._duration - at);
    }

    /**
     * Put everything a command writes into the restore lists. A command is not confined to its target
     * (`Cursor.click` throws a control), and an unrestored node would hold the last evaluation's value, making a
     * frame depend on how the playhead got there. A slot on a part a node built has no row, so it is restored on
     * its own to the state {@link _notePartWrite} saw.
     */
    private _touch(placed: PlacedCommand, touched: Set<TouchedOwner>): void {
        this._touchOwner(placed.owner, touched);
        for (const slot of placed.writes) {
            const host = slot._host;
            if (host === null) continue;
            const entry = host.id === ROOT_NODE_ID ? this._root : this._live.get(host.id);
            if (entry) {
                this._touchOwner(entry, touched);
            } else if (this._partBaselines.has(slot) && !touched.has(slot)) {
                touched.add(slot);
                this._animatedParts.push(slot);
            }
        }
    }

    private _touchOwner(owner: LiveNode | LiveVariable, touched: Set<TouchedOwner>): void {
        if (touched.has(owner)) return;
        touched.add(owner);
        if ("cell" in owner) this._animatedVars.push(owner);
        else this._animated.push(owner);
    }

    /**
     * Save a part's slot the first time a command is about to write it. Called before the write lands, while a
     * command is built: earlier commands have run to their end but none wrote this slot, so it holds what the
     * part was built with.
     */
    private readonly _notePartWrite = (slot: PropSlot<unknown>): void => {
        const host = slot._host;
        if (host === null || this._partBaselines.has(slot)) return;
        if (host.id === ROOT_NODE_ID || this._live.has(host.id)) return;
        this._partBaselines.set(slot, slot.snapshot());
    };

    /** A command declaring `binds` has args that are a props diff reaching `node.set()`, where a function is a binding. */
    private _bindArgs(args: Record<string, unknown>): Record<string, unknown> {
        const { literal, bindings } = expressionOps.bindProps(args, this._resolveVariable, "args");
        return { ...literal, ...bindings };
    }

    /**
     * A tween's destination is a value read once at compile, so an expression there could only mean its build-time
     * value. Fail rather than coerce, as `NodeSpec.type` does.
     */
    private _assertNoExpressions(spec: CommandSpec): void {
        const found = expressionOps.collect(spec.args, "args");
        if (found.length === 0) return;
        const { path, source } = found[0];
        throw new Error(
            `Command ${spec.id} ("${spec.type}") carries an expression at ${path}: ${JSON.stringify(source)}. ` +
            `Expressions bind a prop to a variable; they are not tween destinations. ` +
            `Bind the prop where the node is authored (or with a "set" command) and animate the variable ` +
            `with "variableTo" instead.`,
        );
    }

    private _skip(spec: CommandSpec, message: string, type: string): null {
        this._skipped.set(spec.id, {
            code: "unknown-command",
            commandId: spec.id,
            ...(spec.targetId !== null && { nodeId: spec.targetId }),
            type,
            message,
        });
        return null;
    }

    /**
     * The tree a placeholder for `spec` belongs to: its children's, else the one
     * its parent holds — a viewport holding two trees gives the one it adds.
     */
    private _placeholderDimension(spec: NodeSpec, rows: readonly NodeSpec[]): NodeDimension {
        const byId = new Map(rows.map((row) => [row.id, row]));
        const seen = new Set<string>();
        const of = (row: NodeSpec): NodeDimension => {
            seen.add(row.id);
            for (const child of rows) {
                if (child.parentId !== row.id) continue;
                const dimension = this._registry.describe(child.type)?.dimension;
                if (dimension) return dimension;
            }
            const parent = row.parentId === null ? undefined : byId.get(row.parentId);
            if (!parent) return "2d";
            const described = this._registry.describe(parent.type);
            if (!described) return seen.has(parent.id) ? "2d" : of(parent);
            const holds = (described.holds ?? []).filter((d) => d !== "audio");
            if (holds.length === 0) return described.holds?.includes("audio") ? "audio" : described.dimension ?? "2d";
            return holds.find((d) => d !== described.dimension) ?? holds[0];
        };
        return of(spec);
    }

    /** The live node a node-scoped command targets; one error, naming the `targetId`, when no row has it. */
    private _targetOrThrow(spec: CommandSpec): { id: string; node: Node; entry: LiveNode } {
        const target = this._targetOf(spec);
        if (!target) {
            throw new Error(
                `Command ${spec.id} ("${spec.type}") targets node "${spec.targetId}", ` +
                `which this document does not declare.`,
            );
        }
        return target;
    }

    private _targetOf(spec: CommandSpec): { id: string; node: Node; entry: LiveNode } | null {
        if (spec.targetId === null) {
            return this._root ? { id: ROOT_NODE_ID, node: this._root.node, entry: this._root } : null;
        }
        const entry = this._live.get(spec.targetId);
        return entry ? { id: spec.targetId, node: entry.node, entry } : null;
    }

    private _evaluateObserved(seconds: number, onWrite: (index: number, slot: PropSlot<unknown>) => void): void {
        let index = 0;
        const observer: SlotObserver = { read: () => { }, write: (slot) => onWrite(index, slot) };
        observeSlots(observer, () => {
            for (; index < this._placed.length; index++) {
                const placed = this._placed[index];
                if (seconds < placed.holdFrom) continue;
                const local = seconds < placed.start ? 0 : placed.duration > 0 ? (seconds - placed.start) / placed.duration : 1;
                placed.command.at(clamp01(local));
            }
        });
    }

    /**
     * Mark the steps that open a presence window needing a settle: a window is
     * the run of steps between two changes to the tree, and it needs one only
     * when a step in it reads layout.
     *
     * At the window's start rather than just before its first reader, because a
     * reader must see the boxes as they stood when the window opened — a size tween
     * built earlier in the same window has already run to its end by then, and a
     * settle after it would hand the reader that end state instead.
     */
    private _settleWindows(steps: readonly { at: number }[], reads: (index: number) => boolean): Uint8Array {
        const index = this._presenceIndex();
        const settles = new Uint8Array(steps.length);
        // -1 is the window the tree was already laid out for.
        let opener = -1;
        let previous = index.time;
        for (let i = 0; i < steps.length; i++) {
            const { at } = steps[i];
            if (index.differs(previous, at)) opener = i;
            previous = at;
            if (opener < 0 || settles[opener]) continue;
            if (reads(i)) settles[opener] = 1;
        }
        return settles;
    }

    private _readsLayout(spec: CommandSpec, refBound: ReadonlySet<string>): boolean {
        const id = spec.targetId ?? ROOT_NODE_ID;
        const target = spec.targetId === null ? this._rootSpec : this._live.get(spec.targetId)?.spec;
        const traits = commandTraits(this._registry, spec, target);
        return traits === null || traits.readsLayout || refBound.has(id);
    }

    /**
     * Targets of a binding command carrying a node reference: a binding a `set`
     * installs mid-scene can read another node's box, and a `from` taken over it
     * later evaluates it.
     */
    private _refBound(commands: readonly CommandSpec[]): Set<string> {
        const out = new Set<string>();
        for (const spec of commands) {
            const entry = this._registry.command(spec.type);
            if (entry?.scope === "node" && entry.binds && hasNodeRef(spec.args)) out.add(spec.targetId ?? ROOT_NODE_ID);
        }
        return out;
    }

    private _presenceIndex(): PresenceIndex {
        return this._presence ??= new PresenceIndex(this._specs, this._spans);
    }

    private _parentNodeOf(spec: NodeSpec): Node | undefined {
        if (spec.parentId === null) return this.canvas;
        return this._live.get(spec.parentId)?.node;
    }

    private _patchEnvironment(): PatchEnvironment {
        const registry = this._registry;
        return {
            traits: (spec, target) => commandTraits(registry, spec, target),
            nodeRefs: (spec, target) => commandNodeRefs(registry, spec, target),
            isContextProvider: (type) => isContextProvider(registry, type),
            isLayoutNeutralProp: (type, key) => isLayoutNeutralProp(registry, type, key),
            writesInPlace: (row, key) => writesPlacementInPlace(registry, row, key),
            ctorOf: (id) => {
                const node = this._live.get(id)?.node;
                return node && missingNodeOf(node) ? MISSING_TYPE : node?.constructor;
            },
            registeredCtor: (type) => registry.node(type)?.ctor ?? (registry.strict ? undefined : MISSING_TYPE),
            dimensionOf: (type) => registry.node(type)?.descriptor.dimension,
        };
    }

    private _writeInPlace(entry: LiveNode, was: NodeSpec): void {
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(entry.spec.props)) {
            if (!jsonEqual(was.props[key], value)) changed[key] = value;
        }
        resetToInitial(entry);
        const { literal, bindings } = expressionOps.bindProps(changed, this._resolveVariable);
        entry.node.set({ ...literal, ...bindings } as never);
        captureInitial(entry);
    }

    private _updateVariables(patch: TimelinePatch): void {
        const { added, removed, changed } = patch.diff.variables;
        for (const id of removed) this._vars.delete(id);
        for (const id of added) this._vars.set(id, this._liveVariable(patch.next.variables.get(id)!));
        for (const id of changed) {
            const spec = patch.next.variables.get(id)!;
            const entry = this._vars.get(id);
            if (!entry) {
                this._vars.set(id, this._liveVariable(spec));
                continue;
            }
            entry.baseline = spec.value;
            entry.target = this._variableTarget(spec, entry.cell);
        }
        for (const spec of patch.next.variables.values()) {
            const entry = this._vars.get(spec.id);
            if (entry) entry.spec = spec;
        }
        // Restoring only resets animated variables, so a changed value nothing animates would never land.
        for (const id of patch.dirtyVariables) {
            const entry = this._vars.get(id);
            if (entry) entry.cell.set(entry.baseline);
        }
    }

    /**
     * Take detached rows out of the tree, replace and add instances, swap in the
     * next document's rows, and re-insert whatever is present at 0. Returns the
     * entries holding a new instance.
     */
    private _updateStructure(patch: TimelinePatch): Set<LiveNode> {
        const { next } = patch;

        for (const id of patch.detach) {
            const entry = this._live.get(id);
            if (!entry) continue;
            entry.node.parent?.remove(entry.node);
            entry.presence.set(false);
            this._present.delete(id);
        }

        const isDocumentNode = (node: Node) => this._live.get(node.id)?.node === node;
        for (const id of patch.removed) {
            const entry = this._live.get(id);
            if (!entry) continue;
            disposeBuilt(entry.node, isDocumentNode);
            this._live.delete(id);
            this._baseChildCount.delete(id);
            this._baselined.delete(id);
            this._unmounted.delete(id);
        }
        for (const id of patch.reinstantiate) {
            const entry = this._live.get(id);
            if (entry) disposeBuilt(entry.node, isDocumentNode);
        }

        const { root, rest } = splitRoot(next.doc.nodes);
        const fresh = new Set<LiveNode>();
        for (const spec of rest) {
            let entry = this._live.get(spec.id);
            if (entry && !patch.reinstantiate.has(spec.id)) {
                entry.spec = spec;
                continue;
            }
            const node = this._instantiate(spec, rest);
            if (entry) {
                entry.spec = spec;
                entry.node = node;
                this._baselined.delete(spec.id);
                this._unmounted.delete(spec.id);
            } else {
                entry = {
                    spec,
                    node,
                    initial: NO_LAYER,
                    initialStackDepth: 0,
                    baseline: NO_LAYER,
                    baseStackDepth: 0,
                    presence: new PropSlot<boolean>(false, null, PRESENCE_PREFIX + spec.id),
                };
                this._live.set(spec.id, entry);
            }
            this._baseChildCount.set(spec.id, node._allChildren.length);
            fresh.add(entry);
        }

        this._doc = next.doc;
        this._docIndex = next;
        this._rootSpec = root;
        this._root!.spec = root;
        this._specs = rest;
        this._varSpecs = next.doc.variables ?? [];
        this._spans = presenceOf(next.doc);
        this._duration = documentDuration(next.doc);

        // A fresh index knows nothing is in the tree, so seed it with what still is.
        const index = this._presence = new PresenceIndex(this._specs, this._spans);
        for (const id of [...this._present]) {
            const row = index.row(id);
            if (row && within(row, 0)) {
                row.siblings.add(row.slot, 1);
                continue;
            }
            this._present.delete(id);
            const entry = this._live.get(id);
            if (!entry) continue;
            entry.presence.set(false);
            entry.node.parent?.remove(entry.node);
        }
        this.syncPresence(0);
        return fresh;
    }

    /**
     * Rebuild the dirty chains in the next document's timeline order, replaying the
     * clean chains they build against and taking arrival baselines where compile
     * would have. Returns the rebuilt commands by id.
     */
    private _walkPatch(
        patch: TimelinePatch,
        previous: ReadonlyMap<string, PlacedCommand>,
        settle: () => void,
    ): Map<string, PlacedCommand> {
        const rebuilt = new Map<string, PlacedCommand>();
        if (isStillDocument(this._doc)) return rebuilt;

        const { next } = patch;
        const dirty = (id: string) => patch.dirtyNodes.has(id) || patch.dirtyVariables.has(id);
        const refBound = this._refBound(next.ordered);
        let replay = patch.replay;
        // A settle for a binding over another node's box has to see every chain at its `at`.
        if (replay !== "all" && [...refBound].some(dirty)) replay = "all";

        const steps: WalkStep[] = [];
        const { captures } = patch;
        let c = 0;
        for (const spec of next.ordered) {
            while (c < captures.length && captures[c].at <= spec.at) steps.push({ at: captures[c].at, capture: captures[c++].id });
            const id = next.targetOf(spec);
            if (replay === "all" || dirty(id) || replay.has(id)) steps.push({ at: spec.at, spec });
        }
        for (; c < captures.length; c++) steps.push({ at: captures[c].at, capture: captures[c].id });

        const settles = this._settleWindows(steps, (i) => {
            const spec = steps[i].spec;
            return spec !== undefined && dirty(next.targetOf(spec)) && this._readsLayout(spec, refBound);
        });

        let pending = false;
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (settles[i]) pending = true;
            if (this.syncPresence(step.at)) this._baselineMounted();
            if (step.capture !== undefined) {
                this._baselined.delete(step.capture);
                this._baselineArrival(step.capture);
                continue;
            }
            // After this `at`'s captures, as compile baselines arrivals before it settles.
            if (pending) {
                settle();
                pending = false;
            }
            const spec = step.spec!;
            const old = previous.get(spec.id);
            if (old && !dirty(next.targetOf(spec))) {
                old.command.at(1);
                continue;
            }
            const placed = this._buildPlaced(spec);
            if (placed) rebuilt.set(spec.id, placed);
        }
        return rebuilt;
    }
}

/** A document written before nodes carried spans would otherwise get a "no command" error naming nothing fixable. */
const LEGACY_COMMAND_HINTS: Readonly<Record<string, string>> = {
    add: "A node is a row in `nodes`, entering at its `startAt`.",
    remove: "A node leaves at its `endAt`.",
    variable: "A variable is declared in `variables`.",
};

const NO_LAYER: PropLayer = new Map();

const PROP_DIFF_COMMANDS: ReadonlySet<string> = new Set(["to", "set"]);

type TouchedOwner = LiveNode | LiveVariable | PropSlot<unknown>;

class WriteRecorder implements SlotObserver {
    readonly writes = new Set<PropSlot<unknown>>();
    readonly reads = new Set<PropSlot<unknown>>();
    readsLayout = false;

    /** `firstWrite` runs the first time a slot is written, before the write lands. */
    constructor(private readonly firstWrite: (slot: PropSlot<unknown>) => void) { }

    read(slot: PropSlot<unknown>): void {
        if (slot._name === LAYOUT_SLOT) this.readsLayout = true;
        this.reads.add(slot);
    }

    write(slot: PropSlot<unknown>): void {
        if (this.writes.has(slot)) return;
        this.firstWrite(slot);
        this.writes.add(slot);
    }
}

/**
 * Build a command and run it to its end. A factory that acts at once and returns
 * nothing (`restore` with no duration) has already done this build's `at(1)`, so
 * it becomes a stamp that acts again on every later evaluation.
 */
function buildToEnd(make: () => Command<Record<string, unknown>> | void): Command<Record<string, unknown>> {
    const made = make();
    if (made) {
        made.at(1);
        return made;
    }
    return driveCommand(0, () => {
        make();
    }) as unknown as Command<Record<string, unknown>>;
}

/**
 * Snapshot a node's prop slots at its authored state. Taken while it is mounted:
 * an unmounted node's cells hold pre-attach values.
 */
function captureBaseline(entry: LiveNode): void {
    const host = entry.node as unknown as ReactiveHost;
    entry.baseline = captureLayer(host);
    entry.baseStackDepth = host._stateStack.length;
}

interface SlotBaseline {
    slot: PropSlot<unknown>;
    baseline: PropSnapshot<unknown>;
}

function slotBaselines(entry: LiveNode, slots: ReadonlySet<PropSlot<unknown>> | undefined): SlotBaseline[] | null {
    if (!slots) return [];
    const cells = (entry.node as unknown as ReactiveHost).__cells?.slots;
    if (!cells) return null;
    const out: SlotBaseline[] = [];
    for (const [key, slot] of cells) {
        const baseline = slots.has(slot) ? entry.baseline.get(key) : undefined;
        if (baseline) out.push({ slot, baseline });
    }
    return out.length === slots.size ? out : null;
}

function captureInitial(entry: LiveNode): void {
    captureBaseline(entry);
    entry.initial = entry.baseline;
    entry.initialStackDepth = entry.baseStackDepth;
}

function resetToInitial(entry: LiveNode): void {
    const host = entry.node as unknown as ReactiveHost;
    applySnapshotLayer(host, entry.initial);
    if (host._stateStack.length > entry.initialStackDepth) host._stateStack.length = entry.initialStackDepth;
    entry.baseline = entry.initial;
    entry.baseStackDepth = entry.initialStackDepth;
}

/** Dispose `node` and whatever it built for itself; a document child it still holds is left alone. */
function disposeBuilt(node: Node, isDocumentNode: (node: Node) => boolean): void {
    for (const child of node._allChildren) {
        if (!isDocumentNode(child)) disposeBuilt(child, isDocumentNode);
    }
    node.dispose();
}

interface PresenceRow {
    id: string;
    start: number;
    end: number;
    order: number;
    slot: number;
    siblings: SiblingCounts;
    pass: number;
}

function within(row: PresenceRow, seconds: number): boolean {
    return seconds >= row.start && seconds < row.end;
}

function byDocumentOrder(a: PresenceRow, b: PresenceRow): number {
    return a.order - b.order;
}

/**
 * How many of one parent's document children are present before a given slot — a
 * Fenwick tree, so an insert index costs O(log siblings) rather than a walk over
 * every sibling.
 */
class SiblingCounts {
    constructor(readonly parentId: string, size: number) {
        this._tree = new Int32Array(size + 1);
    }

    add(slot: number, delta: number): void {
        for (let i = slot + 1; i < this._tree.length; i += i & -i) this._tree[i] += delta;
    }

    before(slot: number): number {
        let count = 0;
        for (let i = slot; i > 0; i -= i & -i) count += this._tree[i];
        return count;
    }

    private readonly _tree: Int32Array;
}

/** Every span boundary sorted by time, with a cursor at the last time synced: a move visits only rows with a boundary between, however far. */
class PresenceIndex {
    time = -Infinity;

    constructor(specs: readonly NodeSpec[], spans: ReadonlyMap<string, NodeSpan>) {
        const byParent = new Map<string, { spec: NodeSpec; order: number }[]>();
        specs.forEach((spec, order) => {
            if (!spans.has(spec.id)) return;
            const parentId = spec.parentId ?? ROOT_NODE_ID;
            const group = byParent.get(parentId);
            if (group) group.push({ spec, order });
            else byParent.set(parentId, [{ spec, order }]);
        });
        for (const [parentId, group] of byParent) {
            // Stable, so a `layerOrder` tie keeps document order.
            group.sort((a, b) => a.spec.layerOrder - b.spec.layerOrder);
            const siblings = new SiblingCounts(parentId, group.length);
            group.forEach(({ spec, order }, slot) => {
                const { start, end } = spans.get(spec.id)!;
                const row: PresenceRow = { id: spec.id, start, end, order, slot, siblings, pass: 0 };
                this._rows.set(spec.id, row);
                this._events.push({ time: start, row });
                if (Number.isFinite(end)) this._events.push({ time: end, row });
            });
        }
        this._events.sort((a, b) => a.time - b.time);
    }

    /** Each row with a boundary between the last time synced and `seconds`, once. Moves the cursor. */
    crossed(seconds: number): readonly PresenceRow[] {
        this.time = seconds;
        const target = this._upperBound(seconds);
        if (target === this._cursor) return NO_ROWS;
        const from = Math.min(target, this._cursor);
        const to = Math.max(target, this._cursor);
        this._cursor = target;
        const pass = ++this._pass;
        const rows: PresenceRow[] = [];
        for (let k = from; k < to; k++) {
            const { row } = this._events[k];
            if (row.pass === pass) continue;
            row.pass = pass;
            rows.push(row);
        }
        return rows;
    }

    /** Whether any row is present at one of `a`, `b` and not the other. Moves nothing. */
    differs(a: number, b: number): boolean {
        const from = this._upperBound(Math.min(a, b));
        const to = this._upperBound(Math.max(a, b));
        for (let k = from; k < to; k++) {
            const { row } = this._events[k];
            if (within(row, a) !== within(row, b)) return true;
        }
        return false;
    }

    row(id: string): PresenceRow | undefined {
        return this._rows.get(id);
    }

    private readonly _events: { time: number; row: PresenceRow }[] = [];
    private readonly _rows = new Map<string, PresenceRow>();
    private _cursor = 0;
    private _pass = 0;

    private _upperBound(seconds: number): number {
        let lo = 0;
        let hi = this._events.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._events[mid].time <= seconds) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
}

const NO_ROWS: readonly PresenceRow[] = [];
