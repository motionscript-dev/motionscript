import type { ProjectDocument, Track } from "@/document/project";
import { isAudioDocument } from "@/document/types";
import type { NodeEditorStates } from "@/components/trees/node/node-editor-state";
import type { Canvas2D } from "@/components/trees/root/canvas2d-node";
import type { MeasureContext2D } from "@/render/measure-context";
import type { RenderPass2D } from "@/render/render-context2d";
import type { ClipInstance, RuntimeScope } from "./clip-instance";
import { ClipStore } from "./clip-store";
import { clipFrameToTime } from "./frame-time";
import { frameTime, placeTracks, spansCovering, type TrackSpan } from "./placement";

interface Slot {
    track: Track;
    span: TrackSpan;
    instance: ClipInstance | null;
    /** The store's generation for the track when {@link instance} was last evaluated. */
    generation: number;
}

/**
 * Puts a project's tracks into the state for a frame, then lays out and draws the ones covering it, back to
 * front.
 *
 * Trees come from a {@link ClipStore}: a track's is built the first time it covers a frame (or taken as
 * discovery left it) and thereafter only asked for times, so a seek costs the same in either direction. The
 * store owns them; anything it does to one moves its generation, and this evaluates again. Overlapping tracks
 * composite by draw order alone, which lets a translucent track show the one beneath it.
 */
export class StateEvaluator {
    constructor(project: ProjectDocument, private readonly _scope: RuntimeScope, store?: ClipStore) {
        this._owned = store === undefined;
        this._store = store ?? new ClipStore(project, _scope, { assets: false, audio: false });
        this._slots = this._slotsFor(project.tracks, new Map());
        this._currentTrackId = firstVisual(this._slots)?.track.id ?? null;
    }

    get currentFrame(): number {
        return this._currentFrame;
    }

    /**
     * Over a hole, the last one there was. An audio clip is a canvas drawing nothing, so it is never what an
     * editor picks from.
     */
    get currentTrackId(): string | null {
        return this._currentTrackId;
    }

    get currentCanvas(): Canvas2D | null {
        return this.currentInstance?.canvas ?? null;
    }

    get currentInstance(): ClipInstance | null {
        const slot = this._slotOf(this._currentTrackId);
        if (!slot?.instance) return null;
        return slot.instance === this._store.instanceOf(slot.track.id) ? slot.instance : null;
    }

    get activeTrackIds(): string[] {
        return this._active.map(slot => slot.track.id);
    }

    stateAt(frame: number): void {
        if (this._disposed) return;
        const target = Math.max(0, Math.floor(frame));
        const active = this._slotsToDraw(target);

        /**
         * Evaluation is idempotent, so a repeat would only cost. Compared by slot, not count: a swap can change which
         * tracks are on screen without changing how many.
         */
        if (!this._stale && target === this._currentFrame && sameSlots(active, this._active)
            && active.every(slot => this._settled(slot))) {
            return;
        }

        this._active = active;
        const topmost = firstVisual([...active].reverse());
        if (topmost) this._currentTrackId = topmost.track.id;

        for (const slot of active) slot.instance = this._store.ensureBuilt(slot.track.id);
        for (const slot of active) {
            if (!slot.instance) continue;
            this._evaluate(slot, target - slot.span.startFrame);
            slot.generation = this._store.generationOf(slot.track.id);
        }

        this._currentFrame = target;
        this._stale = false;
    }

    layout(measurer: MeasureContext2D = this._scope.measurer): void {
        for (const slot of this._active) this._live(slot)?.layout(measurer);
    }

    render(pass: RenderPass2D): void {
        for (const slot of this._active) this._live(slot)?.render(pass);
    }

    invalidate(): void {
        this._stale = true;
    }

    /**
     * The way back to what the document says for a node nothing animates: the timeline restores only what its
     * commands write, so a value written onto a live prop (an editor's override) survives re-evaluation.
     */
    rebuild(trackId: string | null = this._currentTrackId): void {
        if (trackId === null) return;
        this._store.rebuild(trackId);
        this._stale = true;
    }

    /**
     * The store decides what each track keeps (see {@link ClipStore.setProject}); a store shared with a precomp
     * has already taken it, and taking it twice is a no-op.
     */
    setProject(next: ProjectDocument): void {
        if (this._disposed) return;
        this._store.setProject(next);
        const prior = new Map(this._slots.map(slot => [slot.track.id, slot]));
        this._slots = this._slotsFor(next.tracks, prior);

        const kept = new Set(this._slots);
        for (const id of this._editorStates.keys()) {
            if (!this._slotOf(id)) this._editorStates.delete(id);
        }

        /**
         * Keep drawing what survived until the next evaluation: a repaint can land in between, and an emptied set
         * would paint a blank frame over an edit.
         */
        this._active = this._active.filter(slot => kept.has(slot));
        if (!this._slotOf(this._currentTrackId)) {
            this._currentTrackId = firstVisual(this._slots)?.track.id ?? null;
        }
        this._stale = true;
    }

    setEditorStates(trackId: string, states: NodeEditorStates | undefined): void {
        if (states) this._editorStates.set(trackId, states);
        else this._editorStates.delete(trackId);
        this._stale = true;
    }

    dispose(): void {
        this._disposed = true;
        this._active = [];
        for (const slot of this._slots) slot.instance = null;
        if (this._owned) this._store.dispose();
    }

    private readonly _store: ClipStore;
    private readonly _owned: boolean;
    private _slots: Slot[];
    private _active: Slot[] = [];
    private _currentFrame = 0;
    private _currentTrackId: string | null;
    /** Kept apart from the frame, so "evaluate again" never reads as "frame -1". */
    private _stale = false;
    private _disposed = false;
    private readonly _editorStates = new Map<string, NodeEditorStates>();

    private _slotsFor(tracks: readonly Track[], prior: ReadonlyMap<string, Slot>): Slot[] {
        const spans = placeTracks(tracks, this._scope.fps);
        return tracks.map((track, i) => {
            const old = prior.get(track.id);
            if (old) {
                old.track = track;
                old.span = spans[i];
                return old;
            }
            return { track, span: spans[i], instance: null, generation: -1 };
        });
    }

    private _slotOf(trackId: string | null): Slot | undefined {
        return trackId === null ? undefined : this._slots.find(slot => slot.track.id === trackId);
    }

    private _settled(slot: Slot): boolean {
        const id = slot.track.id;
        if (!slot.instance) return this._store.failed(id);
        return slot.instance === this._store.instanceOf(id) && slot.generation === this._store.generationOf(id);
    }

    private _live(slot: Slot): ClipInstance | null {
        return slot.instance && slot.instance === this._store.instanceOf(slot.track.id) ? slot.instance : null;
    }

    /**
     * Hold the final stack past the end of the project, so a frame parked beyond the last one keeps showing the
     * picture; a gap in the middle is a real hole and draws nothing.
     */
    private _slotsToDraw(frame: number): Slot[] {
        const spans = this._slots.map(slot => slot.span);
        let covering = spansCovering(spans, frame);
        if (covering.length === 0) {
            const last = Math.max(-1, ...spans.map(span => span.endFrame));
            if (frame > last && last >= 0) covering = spansCovering(spans, last);
        }
        return covering.map(span => this._slots[span.index]);
    }

    /**
     * The track runs on its own clock. The frame before is evaluated too and stamped as motion history: motion is
     * a property of the frame, not of the seek that reached it.
     */
    private _evaluate(slot: Slot, localFrame: number): void {
        const instance = slot.instance!;
        const dt = clipFrameToTime(1, this._scope.fps);
        /**
         * Clamped so a frame held past the end shows where the track stops: a track can cut its clip short, and the
         * clip goes on past the cut.
         */
        const time = frameTime(localFrame, this._scope.fps, slot.track.duration);
        instance.attach(time, this._editorStates.get(slot.track.id));

        const previous = Math.max(0, time - dt);
        instance.evaluateAt(previous);
        instance.layout();
        instance.primeMotion(previous);

        instance.evaluateAt(time);
        instance.layout();
        instance.sample();
    }
}

function firstVisual(slots: readonly Slot[]): Slot | undefined {
    return slots.find(slot => !isAudioDocument(slot.track.clip));
}

function sameSlots(a: readonly Slot[], b: readonly Slot[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
