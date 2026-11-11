import type { AssetSegment } from "@/assets/asset-index";
import type { AssetCatalog } from "@/assets/catalog";
import { AssetDeclaration, type AssetDecl } from "@/assets/scope";
import type { NodeSpan } from "@/document/types";
import type { Node } from "@/components/trees/node/node";
import { bindDetached, declareNode } from "@/components/trees/node/node-walk";
import {
    LAYOUT_SLOT,
    observeSlots,
    PRESENCE_PREFIX,
    slotLabel,
    STRUCTURE_SLOT,
    unobserved,
    type SlotObserver,
} from "@/props/observer";
import type { PropSlot } from "@/props/slot";
import type { ClipInstance } from "./clip-instance";
import { frameTime, spanFrames } from "./placement";

export interface RefineOptions {
    fps: number;
    frameCount: number;
    catalog: AssetCatalog;
    /** A limited owner's segments start no earlier than its frame: the caller keeps what it had before. */
    owners?: ReadonlyMap<string, number>;
    /**
     * Like {@link owners}, for every owner a composite built below each row (keys a caller cannot know ahead).
     */
    below?: ReadonlyMap<string, number>;
    /** False only watches owners arrive, for a caller that wants `onArrive` alone. */
    declare?: boolean;
    /** Binds a `Tex.surface` source before it declares. Defaults to the declaring node's scope. */
    bindSubtree?: (node: Node) => void;
    onArrive?: (node: Node, ownerKey: string, span: NodeSpan, frame: number) => void;
    onPhase?: (phase: "evaluate" | "declare") => void;
}

export interface OwnerResult {
    ownerKey: string;
    nodeId: string | undefined;
    segments: AssetSegment[];
    deps: ReadonlySet<PropSlot<unknown>>;
    /** A throwing declaration: the owner keeps no segments, and `prop` names the last slot it read. */
    error?: { message: string; stack?: string; prop?: string };
}

export interface RefineResult {
    owners: Map<string, OwnerResult>;
    readers: Map<PropSlot<unknown>, Set<string>>;
}

/**
 * A declaration is a pure function of the slots it reads, so an owner is declared at arrival and again only on
 * frames where something could have changed one of those slots: every frame a command writing one is active
 * (which catches a swap part-way through a command, and overlapping writers), the first frame after it ends,
 * and any frame the tree's presence or structure changed under a read. A redeclaration whose dependencies hold
 * the values they held reuses its result.
 *
 * Yields after each frame it evaluates. The instance must be built; the sweep leaves it at an arbitrary time.
 */
export function* refineAssets(instance: ClipInstance, options: RefineOptions): Generator<void, RefineResult, void> {
    const sweep = new Sweep(instance, options);
    while (sweep.step()) yield;
    return sweep.result();
}

interface Placed {
    id: string;
    /** `to < from` when it lands between frames. */
    from: number;
    to: number;
    writes: Set<PropSlot<unknown>>;
}

interface Declared {
    frame: number;
    decls: ReadonlyMap<string, AssetDecl>;
}

interface OwnerState {
    key: string;
    node: Node;
    span: NodeSpan;
    /** The first frame this sweep may declare the owner on. */
    from: number;
    present: boolean;
    arrivedAt: number;
    arrived: boolean;
    intervals: [number, number][];
    history: Declared[];
    deps: PropSlot<unknown>[] | null;
    values: unknown[];
    /** A presence or structure slot it read was written: the values cannot tell. */
    stale: boolean;
    allDeps: Set<PropSlot<unknown>>;
    scheduled: Set<number>;
    rounds: number;
    error?: OwnerResult["error"];
}

const MAX_REQUEUES = 3;

class Sweep {
    constructor(private readonly _instance: ClipInstance, private readonly _options: RefineOptions) {
        this._last = _options.frameCount - 1;

        const { owners, below } = _options;
        const limited = owners !== undefined || below !== undefined;
        if (this._last < 0 || (limited && (owners?.size ?? 0) + (below?.size ?? 0) === 0)) return;
        if (limited) {
            this._start = Infinity;
            for (const from of [...owners?.values() ?? [], ...below?.values() ?? []]) {
                this._start = Math.min(this._start, Math.max(0, from));
            }
        }
        if (this._start > this._last) return;
        this._walked = this._start - 1;

        this._placed = _instance.placedCommands().map((p) => ({
            id: p.spec.id,
            ...this._activeFrames(p.holdFrom, p.start - p.holdFrom + p.duration),
            writes: new Set(p.writes),
        }));
        for (let i = 0; i < this._placed.length; i++) {
            for (const slot of this._placed[i].writes) this._addWriter(slot, i);
        }

        this._enqueue(this._start);
        for (const span of this._structureSpans()) {
            const frames = spanFrames(span, _options.fps, _options.frameCount);
            if (!frames) continue;
            this._structureFrame(frames.startFrame);
            this._structureFrame(frames.endFrame + 1);
        }
        for (const placed of this._placed) {
            if (![...placed.writes].some(isPseudo)) continue;
            this._forEachDueFrame(placed, this._start, (frame) => this._structureFrame(frame));
        }
    }

    step(): boolean {
        const frame = heapPop(this._heap);
        if (frame === undefined) return false;
        this._queued.delete(frame);
        this._frame = frame;
        this._dueTaken = false;
        this._evaluate(frame);
        this._declareDue(frame);
        return this._heap.length > 0;
    }

    result(): RefineResult {
        const owners = new Map<string, OwnerResult>();
        const readers = new Map<PropSlot<unknown>, Set<string>>();
        for (const owner of this._owners.values()) {
            const intervals = owner.present
                ? [...owner.intervals, [owner.arrivedAt, Infinity] as [number, number]]
                : owner.intervals;
            owners.set(owner.key, {
                ownerKey: owner.key,
                nodeId: owner.node.id,
                segments: owner.error ? [] : segmentsOf(owner.history, intervals),
                deps: owner.allDeps,
                ...(owner.error && { error: owner.error }),
            });
            for (const slot of owner.allDeps) {
                let keys = readers.get(slot);
                if (!keys) readers.set(slot, (keys = new Set()));
                keys.add(owner.key);
            }
        }
        for (const key of this._options.owners?.keys() ?? []) {
            if (!owners.has(key)) owners.set(key, { ownerKey: key, nodeId: undefined, segments: [], deps: new Set() });
        }
        return { owners, readers };
    }

    private readonly _last: number;
    private _start = 0;
    private _walked = -1;
    private _placed: Placed[] = [];
    private readonly _writers = new Map<PropSlot<unknown>, number[]>();
    private readonly _heap: number[] = [];
    private readonly _queued = new Set<number>();
    private readonly _due = new Map<number, Set<OwnerState>>();
    private readonly _structureFrames = new Set<number>();
    private readonly _owners = new Map<string, OwnerState>();
    private readonly _readers = new Map<PropSlot<unknown>, Set<OwnerState>>();
    private readonly _pseudo = new Set<PropSlot<unknown>>();
    /** Owners re-queued from before the frame being processed. */
    private readonly _rewound = new Set<OwnerState>();
    private _frame = -1;
    private _dueTaken = false;
    /** Read once: in Node, `process.env` is a lookup per access, and it sat on every declaration. */
    private readonly _dev = isDev();

    private readonly _presenceObserver: SlotObserver = {
        read: () => { },
        write: (slot) => { if (isPseudo(slot)) this._pseudo.add(slot); },
    };

    /**
     * Limited to named owners, only their rows' spans: an effective span already folds in every ancestor's, and
     * visiting every row's edges would make one edited node cost a walk of the clip.
     */
    private _structureSpans(): NodeSpan[] {
        const { owners, below } = this._options;
        if (owners === undefined && below === undefined) return this._instance.rowSpans();
        const rows = new Set<string>(below?.keys());
        for (const key of owners?.keys() ?? []) {
            const slash = key.indexOf("/");
            rows.add(slash < 0 ? key : key.slice(0, slash));
        }
        const spans: NodeSpan[] = [];
        for (const row of rows) {
            const span = this._instance.rowSpan(row);
            if (span) spans.push(span);
        }
        return spans;
    }

    private _activeFrames(start: number, duration: number): { from: number; to: number } {
        const { fps } = this._options;
        const end = start + Math.max(0, duration);
        let from = Math.max(0, Math.ceil(start * fps));
        while (from > 0 && frameTime(from - 1, fps, Infinity) >= start) from--;
        while (frameTime(from, fps, Infinity) < start) from++;
        let to = Math.max(-1, Math.floor(end * fps));
        while (frameTime(to + 1, fps, Infinity) <= end) to++;
        while (to >= 0 && frameTime(to, fps, Infinity) > end) to--;
        return { from, to };
    }

    private _evaluate(frame: number): void {
        this._options.onPhase?.("evaluate");
        const seconds = frameTime(frame, this._options.fps, this._instance.duration);
        /**
         * Clocks move only where the tree can change, and before it does, so a node is attached in the state it
         * arrives in. Declarations must not read them.
         */
        if (frame > this._walked && (frame === this._start || this._structureFrames.has(frame))) {
            this._instance.attach(seconds);
        }
        this._pseudo.clear();
        // Presence moves before the commands run, outside the observer `onWrite` reports through.
        observeSlots(this._presenceObserver, () => this._instance.evaluateAt(seconds, (index, slot) => {
            if (isPseudo(slot)) this._pseudo.add(slot);
            this._commandWrote(index, slot);
        }));

        /**
         * Presence only moves forward: a frame revisited for a re-queued owner reads what it recorded the first time.
         */
        if (frame <= this._walked) return;
        if (frame === this._start || this._pseudo.size > 0) this._reconcile(frame);
        for (const slot of this._pseudo) {
            for (const owner of this._readers.get(slot) ?? []) {
                owner.stale = true;
                this._queueOwner(owner, frame);
            }
        }
        this._walked = frame;
    }

    private _reconcile(frame: number): void {
        const seen = new Set<OwnerState>();
        this._instance.forEachOwner((node, key, span) => {
            const from = this._limitOf(key);
            if (from === undefined) return;
            let owner = this._owners.get(key);
            if (!owner) {
                owner = {
                    key, node, span, from,
                    present: false, arrivedAt: -1, arrived: false,
                    intervals: [], history: [], deps: null, values: [], stale: true,
                    allDeps: new Set(), scheduled: new Set(), rounds: 0,
                };
                this._owners.set(key, owner);
            }
            seen.add(owner);
            if (owner.node !== node) {
                owner.node = node;
                owner.stale = true;
                if (owner.present) this._queueOwner(owner, Math.max(frame, owner.from));
            }
            if (owner.present) return;
            owner.present = true;
            owner.arrivedAt = Math.max(frame, owner.from);
            owner.stale = true;
            this._queueOwner(owner, owner.arrivedAt);
            if (!owner.arrived) {
                owner.arrived = true;
                this._options.onArrive?.(node, key, span, frame);
            }
        });
        for (const owner of this._owners.values()) {
            if (!owner.present || seen.has(owner)) continue;
            if (frame - 1 >= owner.arrivedAt) owner.intervals.push([owner.arrivedAt, frame - 1]);
            owner.present = false;
        }
    }

    /** The first frame `key` may be declared on, or `undefined` when the sweep is limited to others. */
    private _limitOf(key: string): number | undefined {
        const { owners, below } = this._options;
        if (owners === undefined && below === undefined) return this._start;
        let from = owners?.get(key);
        if (below) {
            for (let slash = key.indexOf("/"); slash >= 0; slash = key.indexOf("/", slash + 1)) {
                const row = below.get(key.slice(0, slash));
                if (row !== undefined && (from === undefined || row < from)) from = row;
            }
        }
        return from;
    }

    private _declareDue(frame: number): void {
        this._dueTaken = true;
        const owners = this._due.get(frame);
        this._due.delete(frame);
        if (this._options.declare === false) return;
        for (const owner of owners ?? []) {
            if (owner.error || this._rewound.has(owner) || !presentAt(owner, frame)) continue;
            if (!owner.stale && unchanged(owner)) continue;
            this._declare(owner, frame);
        }
        // A rewound owner comes back to this frame after the ones it missed, so its history stays in frame order.
        for (const owner of this._rewound) this._queueOwner(owner, frame);
        this._rewound.clear();
    }

    private _declare(owner: OwnerState, frame: number): void {
        this._options.onPhase?.("declare");
        const node = owner.node;
        const reads = new Set<PropSlot<unknown>>();
        const writes: PropSlot<unknown>[] = [];
        let lastRead: PropSlot<unknown> | undefined;
        let readLayout = false;
        let readClock = false;
        const bind = this._options.bindSubtree ?? ((sub: Node) => bindDetached(node, sub));
        const declaration = new AssetDeclaration(this._options.catalog, {
            bindSubtree: (sub) => unobserved(() => bind(sub)),
        });

        try {
            observeSlots({
                read: (slot) => {
                    reads.add(slot);
                    lastRead = slot;
                    if (slot._name === LAYOUT_SLOT) readLayout = true;
                },
                write: (slot) => { writes.push(slot); },
                clock: () => { readClock = true; },
            }, () => declareNode(node, declaration));
        } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            owner.error = { message: e.message, stack: e.stack, ...(lastRead && { prop: slotLabel(lastRead) }) };
            return;
        }

        if (this._dev) {
            const type = node.constructor.name;
            if (writes.length > 0) {
                const labels = [...new Set(writes.map(slotLabel))].join(", ");
                warnOnce(`${type}:write:${labels}`,
                    `[assets] ${type} wrote ${labels} while declaring its assets. A declaration is re-run only ` +
                    `when something it read changes, so a write there is a frame-order dependency.`);
            }
            if (readLayout) {
                warnOnce(`${type}:layout`,
                    `[assets] ${type}.declareAssets read layoutBounds. Declarations run without layout; ` +
                    `decode size follows the draw, so declare the asset without a size.`);
            }
            if (readClock) {
                warnOnce(`${type}:clock`,
                    `[assets] ${type}.declareAssets read time. Declarations are re-run only when a prop ` +
                    `they read changes, so anything following the clock is missed between those frames.`);
            }
        }

        owner.stale = false;
        owner.deps = [...reads];
        owner.values = owner.deps.map((slot) => slot.get());
        for (const slot of reads) {
            if (owner.allDeps.has(slot)) continue;
            owner.allDeps.add(slot);
            let set = this._readers.get(slot);
            if (!set) this._readers.set(slot, (set = new Set()));
            set.add(owner);
        }

        const decls = declaration.declarations;
        const previous = owner.history[owner.history.length - 1];
        if (!previous || previous.frame < owner.arrivedAt || !sameDecls(previous.decls, decls)) {
            owner.history.push({ frame, decls });
        }
        this._scheduleWriters(owner, frame + 1);
    }

    private _scheduleWriters(owner: OwnerState, from: number): void {
        for (const slot of owner.deps ?? []) {
            const writers = this._writers.get(slot);
            if (!writers) continue;
            for (const index of writers) {
                if (owner.scheduled.has(index)) continue;
                owner.scheduled.add(index);
                this._forEachDueFrame(this._placed[index], from, (frame) => this._queueOwner(owner, frame));
            }
        }
    }

    private _forEachDueFrame(placed: Placed, from: number, visit: (frame: number) => void): void {
        const first = Math.max(from, placed.from);
        const last = Math.min(this._last, placed.to);
        for (let frame = first; frame <= last; frame++) visit(frame);
        const after = Math.max(placed.to + 1, placed.from);
        if (after >= from && after <= this._last) visit(after);
    }

    /**
     * A command wrote a slot compile did not see it write. Its readers may have missed every frame of it, so each
     * is re-queued from where the command starts.
     */
    private _commandWrote(index: number, slot: PropSlot<unknown>): void {
        const placed = this._placed[index];
        if (!placed || placed.writes.has(slot)) return;
        placed.writes.add(slot);
        this._addWriter(slot, index);

        if (this._dev) {
            warnOnce(`command:${placed.id}:${slotLabel(slot)}`,
                `[assets] Command ${placed.id} wrote ${slotLabel(slot)} at frame ${this._frame}, which compile did not ` +
                `record it writing. Owners reading it are re-declared over the command's span.`);
        }
        for (const owner of this._readers.get(slot) ?? []) this._requeue(owner, Math.max(placed.from, owner.from), placed.id);
    }

    private _requeue(owner: OwnerState, from: number, commandId: string): void {
        if (owner.error) return;
        if (from > this._frame) {
            this._scheduleWriters(owner, from);
            return;
        }
        if (from === this._frame) {
            this._queueOwner(owner, from);
            return;
        }
        if (owner.rounds >= MAX_REQUEUES) {
            if (this._dev) {
                warnOnce(`requeue:${owner.key}`,
                    `[assets] ${owner.key} was re-queued ${MAX_REQUEUES} times (last by command ${commandId}); ` +
                    `its asset windows may be incomplete.`);
            }
            return;
        }
        owner.rounds++;
        owner.history = owner.history.filter((entry) => entry.frame < from);
        owner.stale = true;
        owner.scheduled.clear();
        // Every presence interval that starts in reach lost its arrival declaration too.
        this._queueOwner(owner, from);
        for (const [start] of owner.intervals) if (start > from) this._queueOwner(owner, start);
        if (owner.present && owner.arrivedAt > from) this._queueOwner(owner, owner.arrivedAt);
        // Presence and structure were only watched going forward; revisit their frames in reach.
        if (owner.deps?.some(isPseudo)) {
            for (const frame of this._structureFrames) {
                if (frame >= from && frame <= this._walked) this._queueOwner(owner, frame);
            }
        }
        this._rewound.add(owner);
    }

    private _addWriter(slot: PropSlot<unknown>, index: number): void {
        const list = this._writers.get(slot);
        if (list) list.push(index);
        else this._writers.set(slot, [index]);
    }

    private _structureFrame(frame: number): void {
        if (frame <= this._start || frame > this._last) return;
        this._structureFrames.add(frame);
        this._enqueue(frame);
    }

    private _queueOwner(owner: OwnerState, frame: number): void {
        if (frame > this._last) return;
        let set = this._due.get(frame);
        if (!set) this._due.set(frame, (set = new Set()));
        set.add(owner);
        this._enqueue(frame);
    }

    private _enqueue(frame: number): void {
        if (this._queued.has(frame) || (frame === this._frame && !this._dueTaken)) return;
        this._queued.add(frame);
        heapPush(this._heap, frame);
    }
}

function isPseudo(slot: PropSlot<unknown>): boolean {
    return slot._name === STRUCTURE_SLOT || slot._name.startsWith(PRESENCE_PREFIX);
}

function presentAt(owner: OwnerState, frame: number): boolean {
    if (owner.present && frame >= owner.arrivedAt) return true;
    for (const [start, end] of owner.intervals) if (frame >= start && frame <= end) return true;
    return false;
}

function unchanged(owner: OwnerState): boolean {
    const deps = owner.deps;
    if (deps === null) return false;
    for (let i = 0; i < deps.length; i++) {
        if (!Object.is(deps[i].get(), owner.values[i])) return false;
    }
    return true;
}

function sameDecls(a: ReadonlyMap<string, AssetDecl>, b: ReadonlyMap<string, AssetDecl>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, decl] of a) {
        const other = b.get(key);
        if (!other || !sameDecl(decl, other)) return false;
    }
    return true;
}

/** A font is its family: the record keeps the first weight, so a weight tween is one segment. */
function sameDecl(a: AssetDecl, b: AssetDecl): boolean {
    switch (a.type) {
        case "image": return b.type === "image" && a.src === b.src;
        case "video": return b.type === "video" && a.src === b.src && a.trimStart === b.trimStart && a.trimEnd === b.trimEnd;
        case "font": return b.type === "font" && a.family === b.family;
        case "loader": return b.type === "loader" && a.key === b.key && a.load === b.load && a.gate === b.gate;
    }
}

/** An owner's declarations laid over its presence: each key open from the entry that declares it to the one that drops it. */
function segmentsOf(history: readonly Declared[], intervals: readonly [number, number][]): AssetSegment[] {
    const out: AssetSegment[] = [];
    for (const [start, end] of intervals) {
        const open = new Map<string, AssetSegment>();
        for (const entry of history) {
            if (entry.frame < start || entry.frame > end) continue;
            for (const [key, segment] of open) {
                const next = entry.decls.get(key);
                if (next && sameDecl(segment.decl, next)) continue;
                out.push({ ...segment, endFrame: entry.frame - 1 });
                open.delete(key);
            }
            for (const [key, decl] of entry.decls) {
                if (!open.has(key)) open.set(key, { key, decl, startFrame: entry.frame, endFrame: end });
            }
        }
        for (const segment of open.values()) out.push({ ...segment, endFrame: end });
    }
    return out;
}

function isDev(): boolean {
    return process.env.NODE_ENV !== "production";
}

const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(message);
}

function heapPush(heap: number[], value: number): void {
    let i = heap.length;
    heap.push(value);
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent] <= value) break;
        heap[i] = heap[parent];
        i = parent;
    }
    heap[i] = value;
}

function heapPop(heap: number[]): number | undefined {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const tail = heap.pop()!;
    if (heap.length === 0) return top;
    let i = 0;
    for (;;) {
        const left = 2 * i + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        const child = right < heap.length && heap[right] < heap[left] ? right : left;
        if (heap[child] >= tail) break;
        heap[i] = heap[child];
        i = child;
    }
    heap[i] = tail;
    return top;
}
