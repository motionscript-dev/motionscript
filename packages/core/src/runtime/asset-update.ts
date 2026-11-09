import { jsonEqual } from "@/document/diff";
import type { DocIndex } from "@/document/doc-index";
import type { TimelinePatch } from "@/document/timeline-patch";
import { ROOT_NODE_ID, type NodeSpec } from "@/document/types";
import { Node } from "@/components/trees/node/node";
import { LAYOUT_SLOT, PRESENCE_PREFIX, STRUCTURE_SLOT, VAR_PREFIX } from "@/props/observer";
import type { PropSlot } from "@/props/slot";
import type { ClipInstance } from "./clip-instance";
import { frameTime } from "./placement";

/**
 * A slot named by what a rebuild of the clip reproduces — the owner key of the
 * node holding it and the prop's name — so what a declaration read survives the
 * instance it was read on.
 */
export type SlotId = string;

const HOSTED = "\u001f";
const HOSTLESS = "\u001e";
/** A host no document row built: a detached `Tex.surface` source, say. */
const DETACHED = "\u001d";

export function hostSlotId(ownerKey: string, name: string): SlotId {
    return ownerKey + HOSTED + name;
}

export function hostlessSlotId(name: string): SlotId {
    return HOSTLESS + name;
}

function hostOf(id: SlotId): string | undefined {
    if (id.startsWith(HOSTLESS) || id.startsWith(DETACHED)) return undefined;
    return id.slice(0, id.lastIndexOf(HOSTED));
}

function nameOf(id: SlotId): string {
    if (id.startsWith(HOSTLESS) || id.startsWith(DETACHED)) return id.slice(1);
    return id.slice(id.lastIndexOf(HOSTED) + 1);
}

/** Names slots against one instance. */
export class SlotNamer {
    constructor(private readonly _instance: ClipInstance) { }

    idOf(slot: PropSlot<unknown>): SlotId {
        const host = slot._host;
        if (host === null) return HOSTLESS + slot._name;
        let key = this._keys.get(host);
        if (key === undefined) {
            key = host instanceof Node ? this._instance.ownerKeyOf(host) ?? null : null;
            this._keys.set(host, key);
        }
        return key === null ? DETACHED + slot._name : hostSlotId(key, slot._name);
    }

    idsOf(slots: Iterable<PropSlot<unknown>>): SlotId[] {
        const out: SlotId[] = [];
        for (const slot of slots) out.push(this.idOf(slot));
        return out;
    }

    private readonly _keys = new Map<object, string | null>();
}

/** Every row prefix of an owner key: `a/0.1` is below `a`. A row id may itself hold a slash. */
function rowsAbove(key: string): string[] {
    const out: string[] = [];
    for (let slash = key.indexOf("/"); slash >= 0; slash = key.indexOf("/", slash + 1)) out.push(key.slice(0, slash));
    return out;
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(value);
}

function removeFrom<K, V>(map: Map<K, Set<V>>, key: K, value: V): boolean {
    const set = map.get(key);
    if (!set) return false;
    set.delete(value);
    if (set.size > 0) return false;
    map.delete(key);
    return true;
}

const NONE: ReadonlySet<never> = new Set();

/** What each owner's declarations read, and the reverse: who reads each slot. */
export class OwnerDependencies {
    set(ownerKey: string, slots: Iterable<SlotId>): void {
        this.remove(ownerKey);
        const own = new Set(slots);
        this._deps.set(ownerKey, own);
        for (const row of rowsAbove(ownerKey)) addTo(this._ownersBelow, row, ownerKey);
        for (const id of own) {
            if (!this._readers.has(id)) this._index(id);
            addTo(this._readers, id, ownerKey);
        }
    }

    remove(ownerKey: string): void {
        const own = this._deps.get(ownerKey);
        if (!own) return;
        this._deps.delete(ownerKey);
        for (const row of rowsAbove(ownerKey)) removeFrom(this._ownersBelow, row, ownerKey);
        for (const id of own) {
            if (removeFrom(this._readers, id, ownerKey)) this._unindex(id);
        }
    }

    has(ownerKey: string): boolean {
        return this._deps.has(ownerKey);
    }

    depsOf(ownerKey: string): ReadonlySet<SlotId> {
        return this._deps.get(ownerKey) ?? NONE;
    }

    readersOf(id: SlotId): ReadonlySet<string> {
        return this._readers.get(id) ?? NONE;
    }

    /** Owners a composite built below `row`. */
    ownersBelow(row: string): ReadonlySet<string> {
        return this._ownersBelow.get(row) ?? NONE;
    }

    /** Read slots `ownerKey`'s node holds. */
    slotsHostedBy(ownerKey: string): ReadonlySet<SlotId> {
        return this._byHost.get(ownerKey) ?? NONE;
    }

    /** Read slots held by anything a composite built below `row`. */
    *slotsHostedBelow(row: string): Generator<SlotId> {
        for (const host of this._hostsBelow.get(row) ?? NONE) yield* this.slotsHostedBy(host);
    }

    slotsNamed(name: string): ReadonlySet<SlotId> {
        return this._byName.get(name) ?? NONE;
    }

    private readonly _deps = new Map<string, Set<SlotId>>();
    private readonly _readers = new Map<SlotId, Set<string>>();
    private readonly _ownersBelow = new Map<string, Set<string>>();
    private readonly _byHost = new Map<string, Set<SlotId>>();
    private readonly _hostsBelow = new Map<string, Set<string>>();
    private readonly _byName = new Map<string, Set<SlotId>>();

    private _index(id: SlotId): void {
        addTo(this._byName, nameOf(id), id);
        const host = hostOf(id);
        if (host === undefined) return;
        addTo(this._byHost, host, id);
        for (const row of rowsAbove(host)) addTo(this._hostsBelow, row, host);
    }

    private _unindex(id: SlotId): void {
        removeFrom(this._byName, nameOf(id), id);
        const host = hostOf(id);
        if (host === undefined) return;
        if (removeFrom(this._byHost, host, id)) {
            for (const row of rowsAbove(host)) removeFrom(this._hostsBelow, row, host);
        }
    }
}

/** A placed command's start and what it writes, by slot id. */
export interface PlacedWrites {
    start: number;
    writes: readonly SlotId[];
}

export interface DirtyInput {
    patch: TimelinePatch;
    deps: OwnerDependencies;
    /**
     * Placed commands before the patch and after it, keyed by their recorded write
     * set — a set on both sides belongs to a command the patch did not rebuild.
     */
    before: ReadonlyMap<object, PlacedWrites>;
    after: ReadonlyMap<object, PlacedWrites>;
    fps: number;
    /** The prop names the row's node registers, after the patch. */
    propsOf(rowId: string): ReadonlySet<string> | undefined;
    /** Whether the row's node, after the patch, holds children it built for itself. */
    buildsChildren(rowId: string): boolean;
    isContextProvider(type: string): boolean;
}

export interface DirtyOwners {
    /** Owners to declare again, each from its frame. */
    owners: Map<string, number>;
    /** Rows whose composite-built owners are all declared again, from the frame. */
    below: Map<string, number>;
    /** Rows gone from the clip; they and everything below them leave the index. */
    removed: Set<string>;
    /** Of the above, owners and rows declared from no later than they arrive — their audio is redone too. */
    arrivalOwners: Set<string>;
    arrivalBelow: Set<string>;
}

/**
 * The owners an applied patch can have changed the declarations of, each from
 * the first frame it can differ on.
 *
 * Every rule reads the recorded dependencies, so an edit no declaration read —
 * a position, a size, a tween of either — names nobody. Rules err towards naming
 * an owner: one named needlessly costs its declarations over its frames, one
 * missed keeps a window a fresh build would not have.
 */
export function dirtyOwners(input: DirtyInput): DirtyOwners {
    const { patch, deps, fps } = input;
    const { prev, next, diff } = patch;
    const out: DirtyOwners = {
        owners: new Map(),
        below: new Map(),
        removed: new Set(),
        arrivalOwners: new Set(),
        arrivalBelow: new Set(),
    };

    const lower = (map: Map<string, number>, key: string, frame: number) => {
        const at = map.get(key);
        if (at === undefined || frame < at) map.set(key, frame);
    };
    const owner = (key: string, frame: number, arrival: boolean) => {
        lower(out.owners, key, frame);
        if (arrival) out.arrivalOwners.add(key);
    };
    const readers = (id: SlotId, frame: number, arrival: boolean) => {
        for (const key of deps.readersOf(id)) owner(key, frame, arrival);
    };
    const below = (row: string, frame: number) => {
        if (!input.buildsChildren(row) && deps.ownersBelow(row).size === 0) return;
        lower(out.below, row, frame);
        out.arrivalBelow.add(row);
    };
    const startOf = (index: DocIndex, id: string): number => {
        const span = index.effSpan(id);
        return span ? firstFrameAt(span.start, fps) : Infinity;
    };
    const placement = (id: string, frame: number) => {
        readers(hostlessSlotId(PRESENCE_PREFIX + id), frame, true);
        readers(hostSlotId(id, STRUCTURE_SLOT), frame, true);
        for (const index of [prev, next]) {
            const spec = index.nodes.get(id);
            if (spec) readers(hostSlotId(spec.parentId ?? ROOT_NODE_ID, STRUCTURE_SLOT), frame, true);
        }
    };
    const hosted = (row: string, frame: number, names: ReadonlySet<string> | null) => {
        for (const id of deps.slotsHostedBy(row)) {
            const name = nameOf(id);
            if (names === null || names.has(name) || name === STRUCTURE_SLOT) readers(id, frame, true);
        }
        for (const id of deps.slotsHostedBelow(row)) readers(id, frame, true);
    };

    for (const [writes, placed] of input.before) {
        if (input.after.has(writes)) continue;
        const frame = firstFrameAt(placed.start, fps);
        for (const id of placed.writes) readers(id, frame, false);
    }
    for (const [writes, placed] of input.after) {
        if (input.before.has(writes)) continue;
        const frame = firstFrameAt(placed.start, fps);
        for (const id of placed.writes) readers(id, frame, false);
    }

    for (const id of diff.variables.changed) readers(hostlessSlotId(VAR_PREFIX + id), 0, true);
    if (patch.layoutChanged) {
        for (const id of deps.slotsNamed(LAYOUT_SLOT)) readers(id, 0, true);
    }
    for (const parent of diff.nodes.reorderedParents) readers(hostSlotId(parent, STRUCTURE_SLOT), 0, true);

    for (const id of diff.nodes.removed) {
        const from = startOf(prev, id);
        out.removed.add(id);
        placement(id, from);
        hosted(id, from, null);
    }
    for (const id of diff.nodes.added) {
        const from = startOf(next, id);
        if (from === Infinity) continue;
        owner(id, from, true);
        below(id, from);
        placement(id, from);
    }
    for (const id of next.nodes.keys()) {
        if (id === ROOT_NODE_ID || !prev.nodes.has(id)) continue;
        const a = prev.effSpan(id);
        const b = next.effSpan(id);
        if (a?.start === b?.start && a?.end === b?.end) continue;
        const from = Math.min(startOf(prev, id), startOf(next, id));
        if (from === Infinity) continue;
        owner(id, from, true);
        below(id, from);
        placement(id, from);
    }

    const changedRows = new Set([...patch.reinstantiate, ...diff.nodes.added, ...diff.nodes.removed]);
    for (const id of patch.reinstantiate) {
        const names = changedProps(id, input, changedRows);
        hosted(id, 0, names);
        below(id, 0);
        for (const key of [id, ...deps.ownersBelow(id)]) {
            for (const dep of deps.depsOf(key)) {
                if (!dep.startsWith(DETACHED)) continue;
                owner(key, 0, true);
                break;
            }
        }
        if (diff.nodes.moved.has(id)) placement(id, 0);
    }
    for (const id of patch.inPlace) {
        const names = changedSlots(prev.nodes.get(id)!, next.nodes.get(id)!, input.propsOf(id) ?? new Set());
        for (const slot of deps.slotsHostedBy(id)) {
            if (names === null || names.has(nameOf(slot))) readers(slot, 0, true);
        }
    }
    if (diff.rootChanged) {
        const props = input.propsOf(ROOT_NODE_ID);
        hosted(ROOT_NODE_ID, 0, props ? changedSlots(prev.nodes.get(ROOT_NODE_ID)!, next.nodes.get(ROOT_NODE_ID)!, props) : null);
    }
    return out;
}

/**
 * The props a re-instantiated row's edit changed, or `null` when every slot it
 * holds must be taken as changed: a new type, a new place, a new context above
 * it, or a prop that is not a slot of its own and so reaches its state some
 * other way.
 */
function changedProps(id: string, input: DirtyInput, changedRows: ReadonlySet<string>): ReadonlySet<string> | null {
    const { prev, next, diff } = input.patch;
    const a = prev.nodes.get(id);
    const b = next.nodes.get(id);
    if (!a || !b || !diff.nodes.respec.has(id) || diff.nodes.moved.has(id) || a.type !== b.type || a.key !== b.key) return null;
    for (const index of [prev, next]) {
        if (providerChangedAbove(index, id, changedRows, input)) return null;
    }
    const props = input.propsOf(id);
    return props ? changedSlots(a, b, props) : null;
}

/** The props that differ between two rows, or `null` when one of them is not a slot of `slots`. */
function changedSlots(a: NodeSpec, b: NodeSpec, slots: ReadonlySet<string>): ReadonlySet<string> | null {
    const names = new Set<string>();
    for (const key of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
        if (jsonEqual(a.props[key], b.props[key])) continue;
        if (!slots.has(key)) return null;
        names.add(key);
    }
    return names;
}

function providerChangedAbove(index: DocIndex, id: string, changed: ReadonlySet<string>, input: DirtyInput): boolean {
    const seen = new Set<string>([id]);
    let parentId = index.nodes.get(id)?.parentId ?? null;
    while (parentId !== null && parentId !== ROOT_NODE_ID && !seen.has(parentId)) {
        seen.add(parentId);
        const spec = index.nodes.get(parentId);
        if (!spec) return false;
        if (changed.has(parentId) && input.isContextProvider(spec.type)) return true;
        parentId = spec.parentId;
    }
    return false;
}

/** The first frame whose time reaches `seconds`. */
export function firstFrameAt(seconds: number, fps: number): number {
    if (!(seconds > 0)) return 0;
    if (!Number.isFinite(seconds)) return Infinity;
    let frame = Math.max(0, Math.ceil(seconds * fps));
    while (frame > 0 && frameTime(frame - 1, fps, Infinity) >= seconds) frame--;
    while (frameTime(frame, fps, Infinity) < seconds) frame++;
    return frame;
}
