import type { AssetRecord } from "./record";
import { assetKey, type AssetDecl } from "./scope";

export interface AssetSegment {
    key: string;
    decl: AssetDecl;
    startFrame: number;
    /** Inclusive. `Infinity` runs to the clip's end. */
    endFrame: number;
}

export interface AssetDelta {
    /** Keys whose record appeared, disappeared, or changed window or content. */
    readonly keys: ReadonlySet<string>;
}

interface OwnerSegments {
    declared: Map<string, AssetSegment[]>;
    /** Found missing at draw time rather than declared; cleared by the owner's next `setOwner`. */
    learned: Map<string, AssetSegment[]>;
}

interface KeyEntry {
    record: AssetRecord;
    layout: boolean;
}

const NO_OWNERS: ReadonlySet<string> = new Set();

/** One clip's asset windows, per owner, in clip-local frames. Owners replace their segments wholesale, and a key's record (the union window over every owner that needs it) is recomputed only for keys an update touched. Records keep the {@link AssetRecord} shape so the manager, exporter and mixer read them unchanged. */
export class AssetIndex {
    constructor(frameCount: number) {
        this._frameCount = Math.max(0, frameCount);
    }

    setOwner(ownerKey: string, segments: readonly AssetSegment[]): AssetDelta {
        const touched = new Set<string>();
        const previous = this._owners.get(ownerKey);
        if (previous) this._unlink(ownerKey, previous, touched);

        const next: OwnerSegments = { declared: new Map(), learned: new Map() };
        for (const segment of segments) {
            if (!(segment.endFrame >= segment.startFrame)) continue;
            appendSegment(next.declared, { ...segment });
        }
        if (next.declared.size > 0) {
            this._owners.set(ownerKey, next);
            this._link(ownerKey, next, touched);
        } else {
            this._owners.delete(ownerKey);
        }
        return this._refresh(touched);
    }

    removeOwner(ownerKey: string): AssetDelta {
        const previous = this._owners.get(ownerKey);
        if (!previous) return { keys: new Set() };
        const touched = new Set<string>();
        this._unlink(ownerKey, previous, touched);
        this._owners.delete(ownerKey);
        return this._refresh(touched);
    }

    learn(ownerKey: string, decl: AssetDecl, frame: number): AssetDelta {
        const key = assetKey(decl);
        let owner = this._owners.get(ownerKey);
        if (!owner) {
            owner = { declared: new Map(), learned: new Map() };
            this._owners.set(ownerKey, owner);
        }
        const list = owner.learned.get(key) ?? [];
        const at = list.findIndex((s) => frame >= s.startFrame - 1 && frame <= s.endFrame + 1);
        if (at < 0) {
            list.push({ key, decl, startFrame: frame, endFrame: frame });
        } else {
            // Replaced rather than widened in place: `segmentsOf` hands these out.
            const hit = list[at];
            list[at] = {
                ...hit,
                startFrame: Math.min(hit.startFrame, frame),
                endFrame: Math.max(hit.endFrame, frame),
            };
        }
        owner.learned.set(key, list);
        let owners = this._byKey.get(key);
        if (!owners) this._byKey.set(key, (owners = new Set()));
        owners.add(ownerKey);
        return this._refresh(new Set([key]));
    }

    setFrameCount(frameCount: number): AssetDelta {
        const next = Math.max(0, frameCount);
        if (next === this._frameCount) return { keys: new Set() };
        this._frameCount = next;
        return this._refresh(new Set(this._byKey.keys()));
    }

    owners(key: string): ReadonlySet<string> {
        return this._byKey.get(key) ?? NO_OWNERS;
    }

    /** Declared segments, then learned ones. */
    segmentsOf(ownerKey: string): readonly AssetSegment[] {
        const owner = this._owners.get(ownerKey);
        if (!owner) return [];
        const out: AssetSegment[] = [];
        for (const list of owner.declared.values()) out.push(...list);
        for (const list of owner.learned.values()) out.push(...list);
        return out;
    }

    /** Declared segments only — what a partial re-declaration keeps the front of. */
    declaredSegmentsOf(ownerKey: string): readonly AssetSegment[] {
        const owner = this._owners.get(ownerKey);
        if (!owner) return [];
        const out: AssetSegment[] = [];
        for (const list of owner.declared.values()) out.push(...list);
        return out;
    }

    ownerKeys(): IterableIterator<string> {
        return this._owners.keys();
    }

    records(): ReadonlyMap<string, AssetRecord> {
        return this._records;
    }

    /** Fonts, and loaders any owner declared with `gate: "layout"`. */
    layoutGates(): readonly AssetRecord[] {
        if (this._layoutGates === null) {
            const gates: AssetRecord[] = [];
            for (const entry of this._entries.values()) {
                if (entry.layout) gates.push(entry.record);
            }
            this._layoutGates = gates;
        }
        return this._layoutGates;
    }

    private _frameCount: number;
    private readonly _owners = new Map<string, OwnerSegments>();
    private readonly _byKey = new Map<string, Set<string>>();
    private readonly _entries = new Map<string, KeyEntry>();
    private readonly _records = new Map<string, AssetRecord>();
    private _layoutGates: AssetRecord[] | null = null;

    private _link(ownerKey: string, owner: OwnerSegments, touched: Set<string>): void {
        for (const key of owner.declared.keys()) {
            let owners = this._byKey.get(key);
            if (!owners) this._byKey.set(key, (owners = new Set()));
            owners.add(ownerKey);
            touched.add(key);
        }
    }

    private _unlink(ownerKey: string, owner: OwnerSegments, touched: Set<string>): void {
        for (const map of [owner.declared, owner.learned]) {
            for (const key of map.keys()) {
                const owners = this._byKey.get(key);
                if (owners) {
                    owners.delete(ownerKey);
                    if (owners.size === 0) this._byKey.delete(key);
                }
                touched.add(key);
            }
        }
    }

    private _refresh(keys: ReadonlySet<string>): AssetDelta {
        const changed = new Set<string>();
        for (const key of keys) {
            const previous = this._entries.get(key);
            const next = this._compute(key);
            if (next === undefined) {
                if (previous === undefined) continue;
                this._entries.delete(key);
                this._records.delete(key);
            } else if (previous !== undefined && previous.layout === next.layout && sameRecord(previous.record, next.record)) {
                continue;
            } else {
                this._entries.set(key, next);
                this._records.set(key, next.record);
            }
            changed.add(key);
        }
        if (changed.size > 0) this._layoutGates = null;
        return { keys: changed };
    }

    private _compute(key: string): KeyEntry | undefined {
        const owners = this._byKey.get(key);
        if (!owners) return undefined;
        const last = this._frameCount - 1;
        let first: AssetSegment | undefined;
        let start = Infinity;
        let end = -Infinity;
        let layoutLoader = false;

        const visit = (list: AssetSegment[] | undefined): void => {
            if (!list) return;
            for (const segment of list) {
                const from = Math.max(0, segment.startFrame);
                const to = Math.min(last, segment.endFrame);
                if (to < from) continue;
                // The earliest segment speaks for the key.
                if (from < start) {
                    start = from;
                    first = segment;
                }
                if (to > end) end = to;
                if (segment.decl.type === "loader" && segment.decl.gate === "layout") layoutLoader = true;
            }
        };
        for (const ownerKey of owners) {
            const owner = this._owners.get(ownerKey);
            if (!owner) continue;
            visit(owner.declared.get(key));
            visit(owner.learned.get(key));
        }

        if (first === undefined) return undefined;
        return {
            record: recordOf(first.decl, start, end),
            layout: first.decl.type === "font" || layoutLoader,
        };
    }
}

function appendSegment(map: Map<string, AssetSegment[]>, segment: AssetSegment): void {
    const list = map.get(segment.key);
    if (list) list.push(segment);
    else map.set(segment.key, [segment]);
}

function recordOf(decl: AssetDecl, startFrame: number, endFrame: number): AssetRecord {
    switch (decl.type) {
        case "image":
            return { type: "image", startFrame, endFrame, src: decl.src };
        case "video":
            return {
                type: "video", startFrame, endFrame, src: decl.src,
                trimStart: decl.trimStart, trimEnd: decl.trimEnd,
            };
        case "font":
            return { type: "font", startFrame, endFrame, fontWeight: decl.weight, fontFamily: decl.family, src: decl.family };
        case "loader":
            return { type: "loader", src: decl.key, startFrame, endFrame, load: decl.load };
    }
}

function sameRecord(a: AssetRecord, b: AssetRecord): boolean {
    if (a.type !== b.type || a.src !== b.src || a.startFrame !== b.startFrame || a.endFrame !== b.endFrame) return false;
    switch (a.type) {
        case "video": {
            const v = b as typeof a;
            return a.trimStart === v.trimStart && a.trimEnd === v.trimEnd;
        }
        case "font":
            return a.fontWeight === (b as typeof a).fontWeight;
        case "loader":
            return a.load === (b as typeof a).load;
        default:
            return true;
    }
}
