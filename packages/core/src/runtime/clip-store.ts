import { AssetIndex, type AssetSegment } from "@/assets/asset-index";
import type { AssetRecord } from "@/assets/record";
import type { AssetDecl } from "@/assets/scope";
import type { AudioBusStop, AudioRequest } from "@/attributes/audio/request";
import { isContextProvider } from "@/document/command-traits";
import { diffClip, jsonEqual } from "@/document/diff";
import type { ProjectDocument, Track } from "@/document/project";
import type { TimelinePatch } from "@/document/timeline-patch";
import type { ClipDocument, NodeSpan } from "@/document/types";
import type { Node } from "@/components/trees/node/node";
import type { PropHost } from "@/props/host";
import type { PropSlot } from "@/props/slot";
import type { MeasureContext2D } from "@/render/measure-context";
import { now, yieldToScheduler } from "@/util/scheduler";
import { DeclarationMemo, refineAssets, type OwnerResult, type RefineResult } from "./asset-refine";
import { dirtyOwners, OwnerDependencies, SlotNamer, type DirtyOwners, type PlacedWrites, type SlotId } from "./asset-update";
import { AudioIndex } from "./audio-index";
import { requestOf } from "@/attributes/audio/schedule";
import { busPathOf, busPathTo, findBusById, NodeAudio } from "@/components/trees/audio/node-audio";

const COMMAND_AUDIO = "@commands";
import { ClipInstance, type RuntimeScope } from "./clip-instance";
import type { PlacedSound } from "@/document/timeline";
import { placeTracks, spanFrames, trackFrameCount, type TrackSpan } from "./placement";
import type { BuildError, AssetTimelineProfile, TrackAssets, TrackAssetsProfile } from "./asset-timeline";

/** Half a 60 Hz frame, leaving the other half for input and paint. */
export const DEFAULT_PRECOMP_BUDGET_MS = 8;

export interface ClipStoreOptions {
    profile?: AssetTimelineProfile;
    /** False declares no assets: owners are only watched arriving, for their audio. */
    assets?: boolean;
    /** False, with `assets` false too, refines nothing — the store only builds. */
    audio?: boolean;
    /** False disposes an instance as soon as its refinement lands, for a caller that never draws. */
    keepInstances?: boolean;
    /** Absent takes every gate as resident. */
    isReady?: (key: string) => boolean;
}

export interface StoreRunOptions {
    /** Wall-clock ms before yielding; `0` yields between every frame evaluated. */
    budgetMs?: number;
    /** Polled after every yield; true leaves the build parked where it is. */
    isCancelled?: () => boolean;
    onProgress?: () => void;
}

export interface StoreUpdate {
    /** Asset keys whose clip-local record changed, per track refined in place. */
    deltas: Map<string, ReadonlySet<string>>;
    /** Tracks whose built state was thrown away and starts again. */
    rebuilt: string[];
}

type Refinement = "assets" | "audio" | "none";

interface Entry {
    track: Track;
    frameCount: number;
    instance: ClipInstance | null;
    steps: Generator<void, void, void> | null;
    running: boolean;
    /** Replaced or disposed while it was running; torn down once it returns. */
    discarded: boolean;
    profile: TrackAssetsProfile | undefined;
    discovered: TrackAssets | null;
    errors: BuildError[];
    index: AssetIndex;
    audio: AudioIndex;
    commandAudio: Set<string>;
    /** By owner, for one refinement; dropped when the track's audio is published. */
    commandSounds: Map<string, PlacedSound[]> | null;
    deps: OwnerDependencies;
    assetDeps: Map<string, readonly SlotId[]>;
    audioDeps: Map<string, readonly SlotId[]>;
    ownerErrors: Map<string, BuildError>;
    audioErrors: Map<string, BuildError>;
    issues: BuildError[];
    /** Nothing draws until the clip changes or the track is rebuilt. */
    failure: BuildError | null;
    refineError: BuildError | null;
    /** Bumped whenever something other than an evaluator moved the instance. */
    generation: number;
    writes: WeakMap<ReadonlySet<PropSlot<unknown>>, PlacedWrites>;
    /** Gate keys compile measured, or refinement found, before they were resident. */
    unready: Set<string>;
    /** Outlives a rebuild of the track; a catalog or theme change starts a new one. */
    memo: DeclarationMemo;
}

/**
 * One build per track, shared by whoever needs it, so the evaluator draws the tree discovery refined rather
 * than building its own. A build runs as a generator so a background driver can park it between slices;
 * whoever needs the track sooner drains the parked build. Dependencies are kept by {@link SlotId}, which a
 * rebuild reproduces, so an instance can be rebuilt without refining.
 */
export class ClipStore {
    constructor(project: ProjectDocument, private readonly _scope: RuntimeScope, options: ClipStoreOptions = {}) {
        this._options = options;
        this._refine = options.assets !== false ? "assets" : options.audio !== false ? "audio" : "none";
        this._project = project;
        for (const track of project.tracks) this._entries.set(track.id, this._fresh(track));
        this._spans = placeTracks(project.tracks, _scope.fps);
    }

    get project(): ProjectDocument {
        return this._project;
    }

    get tracks(): readonly Track[] {
        return this._project.tracks;
    }

    get spans(): readonly TrackSpan[] {
        return this._spans;
    }

    get version(): number {
        return this._version;
    }

    get profile(): AssetTimelineProfile | undefined {
        return this._options.profile;
    }

    /**
     * A track holding the same clip keeps everything; a changed clip whose tree patches in place re-declares only
     * the owners the patch can have changed; anything else starts again. A theme change starts every track again,
     * since colours resolve against it as props are written.
     */
    setProject(next: ProjectDocument): StoreUpdate {
        const update: StoreUpdate = { deltas: new Map(), rebuilt: [] };
        if (this._disposed || next === this._project) return update;
        const themeChanged = !jsonEqual(this._project.theme, next.theme);
        this._project = next;

        const previous = this._entries;
        this._entries = new Map();
        for (const track of next.tracks) {
            const old = previous.get(track.id);
            const entry = old && !themeChanged ? this._reconcile(old, track, update) : this._fresh(track);
            if (old && entry !== old) update.rebuilt.push(track.id);
            this._entries.set(track.id, entry);
        }
        let changed = update.rebuilt.length > 0 || previous.size !== this._entries.size;
        for (const [id, old] of previous) {
            if (this._entries.get(id) === old) continue;
            this._discard(old);
            changed = true;
        }
        const spans = placeTracks(next.tracks, this._scope.fps);
        if (changed || !sameSpans(spans, this._spans)) this._version++;
        this._spans = spans;
        return update;
    }

    /**
     * For a change the document does not carry: the catalog gained an entry, so a track that failed for want of
     * it, or measured against the old size, must be rebuilt. {@link setProject} cannot tell, since it compares
     * documents.
     */
    reset(): void {
        if (this._disposed) return;
        const previous = this._entries;
        this._entries = new Map();
        for (const track of this._project.tracks) this._entries.set(track.id, this._fresh(track));
        for (const old of previous.values()) this._discard(old);
        this._version++;
    }

    ensureBuilt(trackId: string): ClipInstance | null {
        const entry = this._entries.get(trackId);
        if (!entry || entry.running || this._disposed) return null;
        if (entry.steps) this._drain(entry);
        if (!entry.instance && !entry.failure) {
            this._start(entry, true, this._refine !== "none" && !entry.discovered);
            this._drain(entry);
        }
        return entry.instance;
    }

    discover(trackId: string): void {
        const entry = this._entries.get(trackId);
        if (!entry || entry.running || this._disposed) return;
        if (this._refine === "none") {
            this.ensureBuilt(trackId);
            return;
        }
        if (entry.discovered) return;
        if (!entry.steps) this._start(entry, !entry.instance, true);
        this._drain(entry);
    }

    /**
     * A build whose track changed while parked is dropped; a cancelled one stays parked for whoever needs the
     * track next.
     */
    async runAsync(options: StoreRunOptions = {}): Promise<void> {
        const { budgetMs = DEFAULT_PRECOMP_BUDGET_MS, isCancelled, onProgress } = options;
        if (this._refine === "none") return;
        for (;;) {
            if (this._disposed || isCancelled?.()) return;
            const entry = this._nextUndiscovered();
            if (!entry) return;
            if (!entry.steps) this._start(entry, !entry.instance, true);

            let deadline = now() + budgetMs;
            let finished = this._step(entry);
            while (!finished) {
                if (now() >= deadline) {
                    entry.profile?.suspend();
                    await yieldToScheduler();
                    if (this._disposed || isCancelled?.()) return;
                    if (entry.discarded || !entry.steps) break;
                    entry.profile?.resume();
                    deadline = now() + budgetMs;
                }
                finished = this._step(entry);
            }
            if (!entry.discarded && entry.discovered) onProgress?.();
        }
    }

    instanceOf(trackId: string): ClipInstance | null {
        const entry = this._entries.get(trackId);
        return entry && !entry.steps ? entry.instance : null;
    }

    generationOf(trackId: string): number {
        return this._entries.get(trackId)?.generation ?? -1;
    }

    failed(trackId: string): boolean {
        return !!this._entries.get(trackId)?.failure;
    }

    isDiscovered(trackId: string): boolean {
        return !!this._entries.get(trackId)?.discovered;
    }

    trackAssets(trackId: string): TrackAssets | undefined {
        return this._entries.get(trackId)?.discovered ?? undefined;
    }

    errorsOf(trackId: string): readonly BuildError[] {
        const entry = this._entries.get(trackId);
        return entry?.discovered ? entry.errors : [];
    }

    ownersOf(trackId: string, key: string): ReadonlySet<string> {
        return this._entries.get(trackId)?.index.owners(key) ?? new Set();
    }

    layoutGates(trackId: string): readonly AssetRecord[] {
        const entry = this._entries.get(trackId);
        return entry?.discovered ? entry.index.layoutGates() : [];
    }

    learn(trackId: string, ownerKey: string, decl: AssetDecl, localFrame: number): boolean {
        const entry = this._entries.get(trackId);
        if (!entry?.discovered) return false;
        if (entry.index.learn(ownerKey, decl, localFrame).keys.size === 0) return false;
        return this._refresh(entry);
    }

    /**
     * A gate becomes resident once, so a track rebuilds at most once per gate. Every such track is rebuilt, not
     * only one with a layout-reading command: a node may keep what it measured (`code` caches token advances), and
     * only a fresh tree drops metrics taken against the fallback face.
     */
    settleGates(trackIds: Iterable<string>): boolean {
        const isReady = this._options.isReady;
        if (!isReady) return false;
        let rebuilt = false;
        for (const id of trackIds) {
            const entry = this._entries.get(id);
            if (!entry || entry.unready.size === 0 || !entry.instance || entry.steps || entry.running) continue;
            const gates = entry.discovered ? new Set(entry.index.layoutGates().map((record) => record.src)) : null;
            let arrived = false;
            for (const key of [...entry.unready]) {
                if (gates && !gates.has(key)) {
                    // Nothing loads a face no owner declared, so waiting on it is waiting forever.
                    entry.unready.delete(key);
                } else if (isReady(key)) {
                    arrived = true;
                }
            }
            if (!arrived) continue;
            this._rebuildInstance(entry);
            rebuilt = true;
        }
        return rebuilt;
    }

    /**
     * Keeps what refinement found. For an editor override written straight onto a live prop, which the timeline
     * would never restore.
     */
    rebuild(trackId: string): void {
        const entry = this._entries.get(trackId);
        if (!entry || entry.running || entry.steps) return;
        entry.instance?.dispose();
        entry.instance = null;
        entry.unready.clear();
        entry.generation++;
        if (entry.failure) {
            entry.failure = null;
            entry.discovered = null;
            this._version++;
        }
    }

    /** Dispose `trackId`'s tree, keeping its index and audio; a later {@link ensureBuilt} builds it without refining. */
    release(trackId: string): void {
        const entry = this._entries.get(trackId);
        if (!entry || !entry.instance || entry.running || entry.steps || !entry.discovered) return;
        entry.instance.dispose();
        entry.instance = null;
        entry.generation++;
    }

    trim(frame: number, horizon: number): void {
        for (let i = 0; i < this._spans.length; i++) {
            const span = this._spans[i];
            if (span.endFrame >= frame - horizon && span.startFrame <= frame + horizon) continue;
            this.release(span.id);
        }
    }

    dispose(): void {
        this._disposed = true;
        for (const entry of this._entries.values()) this._discard(entry);
    }

    private readonly _options: ClipStoreOptions;
    private readonly _refine: Refinement;
    private _project: ProjectDocument;
    private _entries = new Map<string, Entry>();
    private _spans: TrackSpan[];
    private _version = 0;
    private _disposed = false;

    private _fresh(track: Track, memo = new DeclarationMemo()): Entry {
        const frameCount = trackFrameCount(track.duration, this._scope.fps);
        return {
            track,
            frameCount,
            instance: null,
            steps: null,
            running: false,
            discarded: false,
            profile: undefined,
            discovered: null,
            errors: [],
            index: new AssetIndex(frameCount),
            audio: new AudioIndex(),
            commandAudio: new Set(),
            commandSounds: null,
            deps: new OwnerDependencies(),
            assetDeps: new Map(),
            audioDeps: new Map(),
            ownerErrors: new Map(),
            audioErrors: new Map(),
            issues: [],
            failure: null,
            refineError: null,
            generation: 0,
            writes: new WeakMap(),
            unready: new Set(),
            memo,
        };
    }

    private _reconcile(entry: Entry, track: Track, update: StoreUpdate): Entry {
        const frameCount = trackFrameCount(track.duration, this._scope.fps);
        // A declaration may read the theme outside any slot.
        const memo = jsonEqual(themeOf(entry.track.clip), themeOf(track.clip)) ? entry.memo : undefined;
        if (entry.track.clip === track.clip) return this._resize(entry, track, frameCount);
        if (entry.steps || entry.failure) return this._fresh(track, memo);
        if (!entry.instance) {
            return entry.discovered && diffClip(entry.track.clip, track.clip).identical
                ? this._resize(entry, track, frameCount)
                : this._fresh(track, memo);
        }

        const instance = entry.instance;
        let patch: TimelinePatch | null;
        try {
            patch = instance.planUpdate(track.clip);
        } catch {
            patch = null;
        }
        if (!patch) return this._fresh(track, memo);
        /** Nothing to apply; the tree keeps the document it was built from, which diffs the same. */
        if (patch.diff.identical) return this._resize(entry, track, frameCount);

        const refined = entry.discovered !== null && this._refine !== "none";
        const before = refined ? this._placedWrites(entry) : undefined;
        try {
            this._compile(entry, (measurer) => instance.applyUpdate(patch, track.clip, track.duration, measurer));
        } catch {
            return this._fresh(track, memo);
        }
        entry.issues = issuesOf(track.id, instance);
        entry.generation++;
        entry.track = track;
        if (!refined) {
            entry.frameCount = frameCount;
            return entry;
        }
        if (frameCount > entry.frameCount) {
            // The frames past the old end were never swept.
            this._undiscover(entry, frameCount);
            return entry;
        }

        const dirty = dirtyOwners({
            patch,
            deps: entry.deps,
            before: before!,
            after: this._placedWrites(entry),
            fps: this._scope.fps,
            propsOf: (id) => {
                const node = instance.node(id) as (Node & PropHost) | undefined;
                return node ? new Set(node.__cells?.slots.keys() ?? []) : undefined;
            },
            buildsChildren: (id) => {
                const node = instance.node(id);
                return !!node && node._allChildren.some((child) => instance.node(child.id) !== child);
            },
            isContextProvider: (type) => isContextProvider(this._scope.registry, type),
        });
        const keys = this._applyDirty(entry, dirty, frameCount);
        if (frameCount !== entry.frameCount) {
            entry.frameCount = frameCount;
            for (const key of entry.index.setFrameCount(frameCount).keys) keys.add(key);
        }
        if (this._refresh(entry)) update.deltas.set(track.id, keys);
        return entry;
    }

    /** A shorter clip clips the index; a longer one was never swept past its old end. */
    private _resize(entry: Entry, track: Track, frameCount: number): Entry {
        const duration = entry.track.duration;
        entry.track = track;
        if (track.duration === duration) return entry;
        if (entry.steps) return this._fresh(track, entry.memo);
        entry.instance?.update(entry.instance.clip, track.duration);
        if (this._refine === "none" || !entry.discovered) {
            entry.frameCount = frameCount;
        } else if (frameCount > entry.frameCount) {
            this._undiscover(entry, frameCount);
        } else if (frameCount !== entry.frameCount) {
            entry.frameCount = frameCount;
            entry.index.setFrameCount(frameCount);
            this._refresh(entry);
        }
        return entry;
    }

    private _undiscover(entry: Entry, frameCount: number): void {
        entry.frameCount = frameCount;
        entry.discovered = null;
        this._version++;
    }

    private _discard(entry: Entry): void {
        entry.discarded = true;
        if (entry.running) return;
        entry.steps?.return(undefined);
        entry.steps = null;
        entry.instance?.dispose();
        entry.instance = null;
    }

    private _nextUndiscovered(): Entry | undefined {
        let best: Entry | undefined;
        let bestStart = Infinity;
        for (const span of this._spans) {
            const entry = this._entries.get(span.id);
            if (!entry || entry.discovered || entry.running) continue;
            if (!best || span.startFrame < bestStart) {
                best = entry;
                bestStart = span.startFrame;
            }
        }
        return best;
    }

    private _start(entry: Entry, build: boolean, refine: boolean): void {
        const index = this._project.tracks.findIndex((track) => track.id === entry.track.id);
        entry.profile = refine ? this._options.profile?.track(index, entry.track.id) : undefined;
        entry.steps = this._steps(entry, build, refine);
    }

    private _drain(entry: Entry): void {
        while (entry.steps && !this._step(entry)) { /* drained */ }
    }

    private _step(entry: Entry): boolean {
        const steps = entry.steps;
        if (!steps) return true;
        entry.running = true;
        let result: IteratorResult<void, void>;
        try {
            result = steps.next();
        } finally {
            entry.running = false;
        }
        entry.generation++;
        if (entry.discarded || this._disposed) {
            if (!result.done) steps.return(undefined);
            entry.steps = null;
            entry.instance?.dispose();
            entry.instance = null;
            return true;
        }
        if (!result.done) return false;
        entry.steps = null;
        return true;
    }

    /** Yields only between frames, where the tree is consistent. */
    private *_steps(entry: Entry, build: boolean, refine: boolean): Generator<void, void, void> {
        const profile = entry.profile;
        const { fps, assets: catalog } = this._scope;
        if (build) {
            profile?.enter("build");
            entry.unready.clear();
            try {
                const instance = new ClipInstance(entry.track.clip, entry.track.duration, this._scope);
                entry.instance = instance;
                this._compile(entry, (measurer) => instance.build(measurer));
                entry.issues = issuesOf(entry.track.id, instance);
            } catch (err) {
                entry.instance?.dispose();
                entry.instance = null;
                entry.failure = buildErrorOf(entry.track.id, err);
                entry.issues = [];
                if (refine) {
                    this._resetAssets(entry);
                    this._refresh(entry, true);
                    profile?.done(entry.frameCount);
                }
                return;
            }
            if (!refine) return;
            yield;
        }

        const instance = entry.instance!;
        const frameCount = entry.frameCount;
        this._resetAssets(entry);
        const audioSlots = new Map<string, PropSlot<unknown>[]>();
        try {
            const refined = yield* refineAssets(instance, {
                fps,
                frameCount,
                catalog,
                declare: this._refine === "assets",
                memo: entry.memo,
                onPhase: (phase) => profile?.enter(phase),
                onArrive: (_node, ownerKey) => {
                    profile?.enter("audio");
                    this._declareAudio(entry, ownerKey, audioSlots);
                },
            });
            this._commit(entry, refined, audioSlots);
        } catch (err) {
            entry.refineError = buildErrorOf(entry.track.id, err);
        }
        const isReady = this._options.isReady;
        if (isReady) {
            for (const record of entry.index.layoutGates()) {
                if (record.type === "loader" && !isReady(record.src)) entry.unready.add(record.src);
            }
        }
        this._refresh(entry, true);
        profile?.done(frameCount);
        if (this._options.keepInstances === false) {
            instance.dispose();
            entry.instance = null;
        }
    }

    private _resetAssets(entry: Entry): void {
        entry.index = new AssetIndex(entry.frameCount);
        entry.audio = new AudioIndex();
        entry.commandAudio = new Set();
        entry.commandSounds = null;
        entry.deps = new OwnerDependencies();
        entry.assetDeps.clear();
        entry.audioDeps.clear();
        entry.ownerErrors.clear();
        entry.audioErrors.clear();
        entry.refineError = null;
    }

    private _commit(entry: Entry, refined: RefineResult, audioSlots: ReadonlyMap<string, PropSlot<unknown>[]>): void {
        const namer = new SlotNamer(entry.instance!);
        for (const owner of refined.owners.values()) {
            const key = owner.ownerKey;
            if (owner.error) entry.ownerErrors.set(key, this._ownerError(entry, owner));
            else entry.index.setOwner(key, owner.segments);
            entry.assetDeps.set(key, namer.idsOf(owner.deps));
        }
        for (const [key, slots] of audioSlots) entry.audioDeps.set(key, namer.idsOf(slots));
        for (const key of new Set([...entry.assetDeps.keys(), ...entry.audioDeps.keys()])) this._link(entry, key);
    }

    private _applyDirty(entry: Entry, dirty: DirtyOwners, frameCount: number): Set<string> {
        const keys = new Set<string>();
        const collect = (delta: { keys: ReadonlySet<string> }) => {
            for (const key of delta.keys) keys.add(key);
        };
        for (const row of dirty.removed) {
            for (const key of [row, ...entry.deps.ownersBelow(row)]) this._drop(entry, key, collect);
        }
        if (dirty.owners.size === 0 && dirty.below.size === 0) return keys;

        const instance = entry.instance!;
        const { fps, assets: catalog } = this._scope;
        const seen = new Set<string>();
        const audioSlots = new Map<string, PropSlot<unknown>[]>();
        const sweep = refineAssets(instance, {
            fps,
            frameCount,
            catalog,
            owners: dirty.owners,
            below: dirty.below,
            declare: this._refine === "assets",
            memo: entry.memo,
            onArrive: (_node, ownerKey, span, frame) => {
                seen.add(ownerKey);
                // Audio is declared as an owner arrives, which a sweep starting later never sees.
                if (frame === spanFrames(span, fps, frameCount)?.startFrame) {
                    this._declareAudio(entry, ownerKey, audioSlots);
                }
            },
        });
        let step = sweep.next();
        while (!step.done) step = sweep.next();
        entry.generation++;
        const refined = step.value;

        const fromOf = (key: string): number => {
            let from = dirty.owners.get(key);
            for (let slash = key.indexOf("/"); slash >= 0; slash = key.indexOf("/", slash + 1)) {
                const row = dirty.below.get(key.slice(0, slash));
                if (row !== undefined && (from === undefined || row < from)) from = row;
            }
            return from ?? 0;
        };
        const fromArrival = (key: string): boolean => {
            if (dirty.arrivalOwners.has(key)) return true;
            for (let slash = key.indexOf("/"); slash >= 0; slash = key.indexOf("/", slash + 1)) {
                if (dirty.arrivalBelow.has(key.slice(0, slash))) return true;
            }
            return false;
        };

        const candidates = new Set(refined.owners.keys());
        for (const row of dirty.below.keys()) for (const key of entry.deps.ownersBelow(row)) candidates.add(key);
        const namer = new SlotNamer(instance);
        for (const key of candidates) {
            const from = fromOf(key);
            const owner = refined.owners.get(key);
            if (!owner && from === 0) {
                this._drop(entry, key, collect);
                continue;
            }
            const kept = from > 0 ? keptBefore(entry.index.declaredSegmentsOf(key), from) : [];
            if (owner?.error) entry.ownerErrors.set(key, this._ownerError(entry, owner));
            else entry.ownerErrors.delete(key);
            collect(entry.index.setOwner(key, owner && !owner.error ? [...kept, ...owner.segments] : kept));
            if (owner) {
                const ids = namer.idsOf(owner.deps);
                entry.assetDeps.set(key, from > 0 ? [...new Set([...entry.assetDeps.get(key) ?? [], ...ids])] : ids);
            }
            if (fromArrival(key) && !seen.has(key)) {
                entry.audio.removeOwner(key);
                entry.audioDeps.delete(key);
                entry.audioErrors.delete(key);
            }
            this._link(entry, key);
        }
        for (const [key, slots] of audioSlots) {
            entry.audioDeps.set(key, namer.idsOf(slots));
            this._link(entry, key);
        }
        return keys;
    }

    private _drop(entry: Entry, key: string, collect: (delta: { keys: ReadonlySet<string> }) => void): void {
        collect(entry.index.removeOwner(key));
        entry.audio.removeOwner(key);
        entry.assetDeps.delete(key);
        entry.audioDeps.delete(key);
        entry.ownerErrors.delete(key);
        entry.audioErrors.delete(key);
        entry.deps.remove(key);
        entry.memo.forget(key);
    }

    private _link(entry: Entry, key: string): void {
        const assets = entry.assetDeps.get(key);
        const audio = entry.audioDeps.get(key);
        if (assets === undefined && audio === undefined) entry.deps.remove(key);
        else entry.deps.set(key, [...assets ?? [], ...audio ?? []]);
    }

    /** Reads no slots, but is linked for audio like every arrival. */
    private _declareAudio(entry: Entry, ownerKey: string, slots: Map<string, PropSlot<unknown>[]>): void {
        slots.set(ownerKey, []);
        const sounds = entry.instance ? this._commandSoundsOf(entry, entry.instance).get(ownerKey) : undefined;
        if (sounds) return this._setCommandAudio(entry, entry.instance!, ownerKey, sounds);
        entry.audio.removeOwner(ownerKey);
        entry.audioErrors.delete(ownerKey);
    }

    /**
     * A sound is scheduled ahead of time from where its command sits, not written per frame. Rebuilt whenever the
     * track's audio is published, so an edited command moves its sound.
     */
    private _declareCommandAudio(entry: Entry): void {
        const instance = entry.instance;
        entry.commandSounds = null;
        if (!instance || this._refine === "none") return;
        const byOwner = this._commandSoundsOf(entry, instance);
        for (const key of entry.commandAudio) {
            if (byOwner.has(key)) continue;
            entry.audio.removeOwner(key);
            entry.audioErrors.delete(key);
        }
        entry.commandAudio = new Set(byOwner.keys());
        for (const [key, sounds] of byOwner) this._setCommandAudio(entry, instance, key, sounds);
        entry.commandSounds = null;
    }

    /** The placed commands' sounds, under the row that plays each, so a request keeps its id and its waveform its row. */
    private _commandSoundsOf(entry: Entry, instance: ClipInstance): Map<string, PlacedSound[]> {
        if (entry.commandSounds) return entry.commandSounds;
        const byOwner = new Map<string, PlacedSound[]>();
        for (const sound of instance.commandSounds()) {
            const key = instance.ownerKeyOf(sound.node) ?? COMMAND_AUDIO;
            const list = byOwner.get(key);
            if (list) list.push(sound);
            else byOwner.set(key, [sound]);
        }
        return (entry.commandSounds = byOwner);
    }

    private _setCommandAudio(entry: Entry, instance: ClipInstance, key: string, sounds: readonly PlacedSound[]): void {
        const catalog = this._scope.assets;
        const spanOf = (node: Node): NodeSpan => {
            const found = instance.spanOf(node);
            if (!found) throw new Error(`${node.className} is not in the tree, so it has no span.`);
            return found;
        };
        try {
            const requests = sounds.map((sound, n) => {
                const { bus: busId, closed, ...options } = sound.options;
                // The buses as they stand when the sound starts: a bus may since have left.
                const bus = instance.atPresence(sound.at, () => {
                    const target = busId ? findBusById(sound.node, busId) : null;
                    return target ? busPathTo(target, spanOf) : sound.node instanceof NodeAudio ? busPathOf(sound.node, spanOf) : undefined;
                });
                const trimEnd = options.trimEnd ?? (closed ? catalog.getMediaDuration(sound.src) : undefined);
                return requestOf({ ...options, trimEnd, src: sound.src, at: sound.at, until: sound.until, bus }, catalog, key, n);
            });
            entry.audio.setOwner(key, requests);
            entry.audioErrors.delete(key);
            entry.commandAudio.add(key);
        } catch (err) {
            entry.audio.removeOwner(key);
            entry.audioErrors.set(key, { ...buildErrorOf(entry.track.id, err), nodeId: sounds[0].node.id });
        }
    }

    private _ownerError(entry: Entry, owner: OwnerResult): BuildError {
        const error = owner.error!;
        return {
            trackId: entry.track.id,
            message: error.message,
            ...(error.stack !== undefined && { stack: error.stack }),
            ...(owner.nodeId !== undefined && { nodeId: owner.nodeId }),
            ...(error.prop !== undefined && { prop: error.prop }),
        };
    }

    /** A snapshot, so a result already handed out does not change; nothing bumps when nothing would differ. */
    private _refresh(entry: Entry, landed = false): boolean {
        this._declareCommandAudio(entry);
        const prior = entry.discovered;
        const { fps } = this._scope;
        const records = prior && sameRecords(prior.assetRecords, entry.index.records())
            ? prior.assetRecords
            : new Map(entry.index.records());
        const audioRequests = clampAudioToClip(entry.audio.requests(), entry.frameCount / fps);
        const layoutGates = entry.index.layoutGates().map((record) => record.src);
        const errors = [
            ...entry.issues,
            ...entry.audioErrors.values(),
            ...entry.ownerErrors.values(),
            ...(entry.failure ? [entry.failure] : []),
            ...(entry.refineError ? [entry.refineError] : []),
        ];
        if (!landed && prior && records === prior.assetRecords && prior.frameCount === entry.frameCount
            && sameValue(prior.audioRequests, audioRequests) && sameValue(prior.layoutGates, layoutGates)
            && sameValue(entry.errors, errors)) {
            return false;
        }
        entry.discovered = {
            id: entry.track.id,
            discovered: true,
            frameCount: entry.frameCount,
            startFrame: 0,
            audioRequests,
            assetRecords: records,
            layoutGates,
        };
        entry.errors = errors;
        this._version++;
        return true;
    }

    private _placedWrites(entry: Entry): Map<object, PlacedWrites> {
        const instance = entry.instance!;
        const out = new Map<object, PlacedWrites>();
        let namer: SlotNamer | undefined;
        for (const placed of instance.placedCommands()) {
            let named = entry.writes.get(placed.writes);
            /** An entrance's hold moves with its neighbours while its write set stays. */
            if (!named || named.start !== placed.holdFrom) {
                namer ??= new SlotNamer(instance);
                named = { start: placed.holdFrom, writes: namer.idsOf(placed.writes) };
                entry.writes.set(placed.writes, named);
            }
            out.set(placed.writes, named);
        }
        return out;
    }

    /** A layout-reading command built against a non-resident face captured the fallback's metrics. */
    private _compile(entry: Entry, run: (measurer: MeasureContext2D) => void): void {
        const isReady = this._options.isReady;
        const inner = this._scope.measurer;
        if (!isReady) {
            run(inner);
            return;
        }
        const families = new Set<string>();
        run({
            measureText(text, fontSize, fontFamily, fontWeight, letterSpacing, fontStyle) {
                families.add(fontFamily);
                return inner.measureText(text, fontSize, fontFamily, fontWeight, letterSpacing, fontStyle);
            },
        });
        for (const family of families) {
            if (!isReady(family)) entry.unready.add(family);
        }
    }

    private _rebuildInstance(entry: Entry): void {
        entry.instance?.dispose();
        entry.instance = null;
        entry.generation++;
        this._start(entry, true, false);
        this._drain(entry);
        if (entry.failure && entry.discovered) this._refresh(entry);
    }
}

function issuesOf(trackId: string, instance: ClipInstance): BuildError[] {
    return instance.issues().map(({ code, message, nodeId, commandId }) => ({
        trackId,
        message,
        code,
        ...(nodeId !== undefined && { nodeId }),
        ...(commandId !== undefined && { commandId }),
    }));
}

function buildErrorOf(trackId: string, err: unknown): BuildError {
    const e = err instanceof Error ? err : new Error(String(err));
    return { trackId, message: e.message, stack: e.stack };
}

function keptBefore(segments: readonly AssetSegment[], from: number): AssetSegment[] {
    const out: AssetSegment[] = [];
    for (const segment of segments) {
        if (segment.startFrame >= from) continue;
        out.push(segment.endFrame >= from ? { ...segment, endFrame: from - 1 } : segment);
    }
    return out;
}

/**
 * Confine a clip's bounded audio to its own `[0, clipDuration)`, so a source outlasting the track does not
 * sound past its cut. Open requests pass through, to be resolved against the project total on assembly.
 *
 * Every bus is confined: a bus is a node of this clip, so one nothing removes is present until the clip ends,
 * and that is the span its curves run over.
 */
function clampAudioToClip(requests: readonly AudioRequest[], clipDuration: number): AudioRequest[] {
    const out: AudioRequest[] = [];
    for (const req of requests) {
        const bus = req.bus && clampBusToClip(req.bus, clipDuration);
        const clamped = bus === req.bus ? { ...req } : { ...req, bus };
        if (req.open) {
            out.push(clamped);
            continue;
        }
        if (req.startAt >= clipDuration) continue;
        const endAt = Math.min(req.endAt, clipDuration);
        if (endAt <= req.startAt) continue;
        out.push(endAt === req.endAt ? clamped : { ...clamped, endAt });
    }
    return out;
}

function clampBusToClip(bus: readonly AudioBusStop[], clipDuration: number): readonly AudioBusStop[] {
    if (bus.every((stop) => stop.endAt <= clipDuration)) return bus;
    return bus.map((stop) => (stop.endAt <= clipDuration ? stop : { ...stop, endAt: clipDuration }));
}

function sameRecords(a: ReadonlyMap<string, AssetRecord>, b: ReadonlyMap<string, AssetRecord>): boolean {
    if (a.size !== b.size) return false;
    for (const [key, record] of a) {
        const other = b.get(key);
        if (!other || !sameValue(record, other)) return false;
    }
    return true;
}

function sameSpans(a: readonly TrackSpan[], b: readonly TrackSpan[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].startFrame !== b[i].startFrame || a[i].endFrame !== b[i].endFrame) return false;
    }
    return true;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (!sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }
    return true;
}

function themeOf(clip: ClipDocument): unknown {
    return "theme" in clip ? clip.theme : undefined;
}
