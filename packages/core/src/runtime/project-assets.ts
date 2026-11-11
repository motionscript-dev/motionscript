import type { AssetCatalog } from "@/assets/catalog";
import type { AssetRecord, ImageRecord, VideoRecord } from "@/assets/record";

/** With the load/evict windows the asset manager uses to keep memory bounded. */
export interface AssetTrack {
    record: AssetRecord;
    /** Larger decodes get more lead time. Always <= startFrame. */
    cacheAt: number;
    /** `null` keeps it (fonts). Always >= endFrame when set. */
    discardAt: number | null;
}

export interface TrackRecords {
    id: string;
    startFrame: number;
    records: ReadonlyMap<string, AssetRecord>;
}

/**
 * Kept up to date key by key: an edit to one track touches only the keys its records changed, so the cost of
 * republishing follows the edit. The map handed out is replaced, never mutated, so a result already published
 * stays as it was.
 */
export class ProjectAssets {
    constructor(private readonly _fps: number, private readonly _catalog: AssetCatalog) { }

    update(tracks: readonly TrackRecords[]): ReadonlyMap<string, AssetTrack> {
        const touched = new Set<string>();
        const live = new Set<string>();
        for (const track of tracks) {
            live.add(track.id);
            const prior = this._tracks.get(track.id);
            if (prior && prior.records === track.records && prior.startFrame === track.startFrame) continue;
            const moved = !prior || prior.startFrame !== track.startFrame;
            for (const [key, record] of track.records) {
                const before = prior?.records.get(key);
                if (moved || !before || !sameRecord(before, record)) touched.add(key);
                this._holders(key).add(track.id);
            }
            if (prior) {
                for (const key of prior.records.keys()) {
                    if (track.records.has(key)) continue;
                    touched.add(key);
                    this._release(key, track.id);
                }
            }
            this._tracks.set(track.id, { id: track.id, startFrame: track.startFrame, records: track.records });
        }
        for (const [id, prior] of this._tracks) {
            if (live.has(id)) continue;
            this._tracks.delete(id);
            for (const key of prior.records.keys()) {
                touched.add(key);
                this._release(key, id);
            }
        }

        let next: Map<string, AssetTrack> | undefined;
        for (const key of touched) {
            const entry = this._entryOf(key);
            const current = this._map.get(key);
            if (entry === undefined) {
                if (current === undefined) continue;
                next ??= new Map(this._map);
                next.delete(key);
            } else if (current === undefined || !sameTrack(current, entry)) {
                next ??= new Map(this._map);
                next.set(key, entry);
            }
        }
        if (next) this._map = next;
        return this._map;
    }

    private readonly _tracks = new Map<string, TrackRecords>();
    private readonly _byKey = new Map<string, Set<string>>();
    private _map: ReadonlyMap<string, AssetTrack> = new Map();

    private _holders(key: string): Set<string> {
        let holders = this._byKey.get(key);
        if (!holders) this._byKey.set(key, (holders = new Set()));
        return holders;
    }

    private _release(key: string, trackId: string): void {
        const holders = this._byKey.get(key);
        if (!holders) return;
        holders.delete(trackId);
        if (holders.size === 0) this._byKey.delete(key);
    }

    private _entryOf(key: string): AssetTrack | undefined {
        const holders = this._byKey.get(key);
        if (!holders) return undefined;
        let merged: AssetRecord | undefined;
        for (const id of holders) {
            const track = this._tracks.get(id)!;
            const record = track.records.get(key);
            if (record) merged = mergeRecord(merged, shiftRecord(record, track.startFrame));
        }
        return merged && assetTrackOf(merged, this._fps, this._catalog);
    }
}

function shiftRecord(record: AssetRecord, offset: number): AssetRecord {
    if (offset === 0) return record;
    return { ...record, startFrame: record.startFrame + offset, endFrame: record.endFrame + offset };
}

/** An asset several tracks use resolves to one window over all of it. */
function mergeRecord(existing: AssetRecord | undefined, record: AssetRecord): AssetRecord {
    if (!existing) return record;
    return {
        ...existing,
        startFrame: Math.min(existing.startFrame, record.startFrame),
        endFrame: Math.max(existing.endFrame, record.endFrame),
    } as AssetRecord;
}

/** What a full decode costs, which lead time scales with. Nothing for a source the catalog cannot size. */
function intrinsicMB(record: ImageRecord | VideoRecord, catalog: AssetCatalog): number {
    let size: { width: number; height: number };
    try {
        size = record.type === "image" ? catalog.getImageMeta(record.src) : catalog.getVideoMeta(record.src);
    } catch {
        return 0;
    }
    if (!(size.width > 0) && !(size.height > 0)) return 0;
    return decodedMB(size.width, size.height);
}

/** Clamped: a 4K image gets about 64, a thumbnail the minimum. */
const LEADS_PER_MB = 2;
const MIN_LEAD = 2;
const MAX_LEAD = 120;
const TAIL_FRAMES = 30;

function decodedMB(width: number, height: number): number {
    return (width * height * 4) / (1024 * 1024);
}

function leadFrames(mb: number): number {
    return Math.min(MAX_LEAD, Math.max(MIN_LEAD, Math.round(mb * LEADS_PER_MB)));
}

/** Fonts are pinned from frame 0 and never evicted. */
function assetTrackOf(entry: AssetRecord, fps: number, catalog: AssetCatalog): AssetTrack | undefined {
    switch (entry.type) {
        case "image": {
            const lead = leadFrames(intrinsicMB(entry, catalog));
            return { record: entry, cacheAt: Math.max(0, entry.startFrame - lead), discardAt: entry.endFrame + TAIL_FRAMES };
        }
        case "video": {
            // Heavier to decode than an image: double the lead, plus a second
            // so a short clip still gets real headroom.
            const lead = Math.min(MAX_LEAD, leadFrames(intrinsicMB(entry, catalog)) * 2 + Math.round(fps));
            return { record: entry, cacheAt: Math.max(0, entry.startFrame - lead), discardAt: entry.endFrame + TAIL_FRAMES };
        }
        case "font":
            return { record: entry, cacheAt: 0, discardAt: null };
        case "loader":
            // Cheap and needed for the whole span it is requested over.
            return { record: entry, cacheAt: Math.max(0, entry.startFrame - MAX_LEAD), discardAt: entry.endFrame + TAIL_FRAMES };
        default:
            return undefined;
    }
}

function sameTrack(a: AssetTrack, b: AssetTrack): boolean {
    return a.cacheAt === b.cacheAt && a.discardAt === b.discardAt && sameRecord(a.record, b.record);
}

export function sameRecord(a: AssetRecord, b: AssetRecord): boolean {
    if (a === b) return true;
    if (a.type !== b.type || a.src !== b.src || a.startFrame !== b.startFrame || a.endFrame !== b.endFrame) return false;
    switch (a.type) {
        case "video": {
            const v = b as typeof a;
            return a.trimStart === v.trimStart && a.trimEnd === v.trimEnd;
        }
        case "font": {
            const v = b as typeof a;
            return a.fontWeight === v.fontWeight && a.fontFamily === v.fontFamily;
        }
        case "loader":
            return a.load === (b as typeof a).load;
        default:
            return true;
    }
}
