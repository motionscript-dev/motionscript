import { AudioSink, AudioRequest } from "@motionscript/core";
import { AudioBusGraph } from "./bus-graph";
import { applyLoop, wrapIntoRegion } from "./loop-region";
import { applySpeedToPlaybackRate, buildAudioEffectGraph, buildLevel, playbackOf, sourceOffsetOf } from "./effect-graph";

type ActiveSource = {
    source: AudioBufferSourceNode;
    request: AudioRequest;
    /** Effect and level nodes to disconnect on teardown. */
    nodes: AudioNode[];
    /** Tremolo LFOs to stop on teardown. */
    oscillators: OscillatorNode[];
};

/**
 * Web Audio implementation of {@link AudioSink} — decodes and caches source
 * buffers, then schedules/plays {@link AudioRequest}s as `AudioBufferSourceNode`s
 * through a shared master gain (global mute and volume). `schedule` registers the
 * active set of requests for the current frame; `syncTo` then starts/stops
 * sources to match `clipTime`, so playback follows scrubbing and seeks.
 */
export class WebAudioSink extends AudioSink {
    private readonly borrowed: AudioContext | undefined;
    private _context: AudioContext | null = null;
    private bufferCache = new Map<string, AudioBuffer>();
    private decoding = new Map<string, Promise<void>>();
    private active = new Map<string, ActiveSource>();
    private scheduled: AudioRequest[] = [];
    private disposed: boolean = false;
    /** The master gain and the live bus chains (shared across every clip that names one), built with the context. */
    private _graph: { master: GainNode; buses: AudioBusGraph } | null = null;
    private muted = false;
    private volume = 1;

    constructor(context?: AudioContext) {
        super();
        this.borrowed = context;
    }

    /**
     * The context, created on first use rather than with the sink: a new
     * AudioContext opens the audio device (50–65 ms on a desktop), and a
     * session that never plays or decodes sound never needs one.
     */
    getContext(): AudioContext {
        this._context ??= this.borrowed ?? new AudioContext();
        return this._context;
    }

    private get context(): AudioContext {
        return this.getContext();
    }

    private get graph(): { master: GainNode; buses: AudioBusGraph } {
        if (!this._graph) {
            const master = this.context.createGain();
            master.connect(this.context.destination);
            this._graph = { master, buses: new AudioBusGraph(this.context, master) };
            this.applyMasterGain();
        }
        return this._graph;
    }

    /**
     * Resume the AudioContext. Must be called from within a user gesture
     * (e.g. a click handler) the first time, or browsers keep the context
     * suspended and no audio is heard.
     */
    unlock(): void {
        if (this.context.state === "suspended") {
            this.context.resume();
        }
    }

    has(src: string): boolean {
        return this.bufferCache.has(src);
    }

    async append(src: string, data: ArrayBuffer): Promise<void> {
        if (this.bufferCache.has(src)) return;
        const existing = this.decoding.get(src);
        if (existing) return existing;

        // decodeAudioData detaches `data` — that's fine, the caller in
        // AssetManager.fetchAudio discards its reference immediately after
        // awaiting append. Skipping the defensive .slice(0) saves a multi-MB
        // allocation per audio source.
        const job = this.context.decodeAudioData(data).then((buffer) => {
            this.bufferCache.set(src, buffer);
        }).finally(() => {
            this.decoding.delete(src);
        });
        this.decoding.set(src, job);
        await job;
    }

    /** Drops cached buffers and stops active sources for srcs/requests no longer referenced — called when the asset set changes (e.g. seeking across scene boundaries). */
    retain(keep: ReadonlySet<string>): void {
        for (const src of [...this.bufferCache.keys()]) {
            if (!keep.has(src)) this.bufferCache.delete(src);
        }
        for (const [id, active] of this.active) {
            if (!keep.has(active.request.src)) this.stopSource(id, active);
        }
    }

    /** Replaces the active request set; stops any currently-playing source whose request is no longer scheduled. Actual start/stop-to-match-time happens in `syncTo`. */
    schedule(requests: readonly AudioRequest[]): void {
        const next = new Set(requests.map(r => r.id));
        for (const [id, active] of this.active) {
            if (!next.has(id)) this.stopSource(id, active);
        }
        this.scheduled = requests.slice();
    }

    /** Starts sources whose `[startAt, endAt)` window now contains `clipTime` (computing the correct buffer offset for the seek point) and stops any that have fallen outside it. */
    syncTo(clipTime: number): void {
        const liveIds = new Set<string>();

        for (const req of this.scheduled) {
            // `endAt` is `Infinity` for an open clip, so the comparison needs no
            // nullish fallback — see AudioRequest.endAt.
            const isInWindow = clipTime >= req.startAt && clipTime < req.endAt;
            if (!isInWindow) continue;

            liveIds.add(req.id);
            if (!this.active.has(req.id)) {
                const buffer = this.bufferCache.get(req.src);
                if (buffer) this.playBuffer(buffer, req, clipTime);
            }
        }

        for (const [id, active] of this.active) {
            if (!liveIds.has(id)) this.stopSource(id, active);
        }
    }

    async play(time: number, _speed: number, _reverse: boolean): Promise<void> {
        if (this.context.state === "suspended") {
            await this.context.resume();
        }
        this.syncTo(time);
    }

    stop(): void {
        for (const [id, active] of this.active) {
            this.stopSource(id, active);
        }
        // A bus's curves are scheduled against the clock of the run that built
        // it, so the next play, from wherever it lands, builds them again.
        this._graph?.buses.dispose();
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        this.applyMasterGain();
    }

    setVolume(volume: number): void {
        this.volume = Math.max(0, volume);
        this.applyMasterGain();
    }

    /** Mute and volume are held separately so unmuting restores the set level. */
    private applyMasterGain(): void {
        if (this._graph) this._graph.master.gain.value = this.muted ? 0 : this.volume;
    }

    /** Starts a buffer source mid-clip if `clipTime` lands after the request's start — the offset accounts for the request's trim, the elapsed time since `startAt`, and its speed. */
    private playBuffer(buffer: AudioBuffer, req: AudioRequest, clipTime: number): void {
        const startTime = this.context.currentTime;
        const playback = playbackOf(req, buffer.duration);
        const elapsed = Math.max(0, clipTime - req.startAt);

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        const loopRegion = applyLoop(source, req);
        if (playback.rate !== 1) source.playbackRate.value = playback.rate;
        applySpeedToPlaybackRate(
            source.playbackRate, playback.speedRamp, playback.sourceLength, playback.clipDuration, startTime, elapsed,
        );

        const graph = buildAudioEffectGraph(
            this.context, source, req.effects ?? [], startTime, playback.clipDuration, elapsed,
        );
        const level = buildLevel(this.context, graph.output, req, playback, startTime, elapsed);
        // Into this clip's bus chain, or straight to the master when it has none.
        // The chain is shared: two clips on one bus reach the same nodes, which is
        // what makes a bus effect one tail rather than one per clip.
        level.output.connect(this.graph.buses.inputFor(req.bus, startTime, clipTime));

        const audioOffset = req.trimStart + sourceOffsetOf(playback, elapsed);
        source.start(startTime, wrapIntoRegion(loopRegion, audioOffset));
        for (const osc of graph.oscillators) osc.start(startTime);

        source.onended = () => {
            if (this.active.get(req.id)?.source === source) {
                this.active.delete(req.id);
            }
        };

        this.active.set(req.id, {
            source,
            request: req,
            nodes: [...graph.nodes, ...level.nodes],
            oscillators: graph.oscillators,
        });
    }

    private stopSource(id: string, active: ActiveSource): void {
        try {
            active.source.onended = null;
            active.source.stop();
            for (const osc of active.oscillators) osc.stop();
            active.source.disconnect();
            for (const node of active.nodes) node.disconnect();
        } catch {
            // already stopped
        }
        this.active.delete(id);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        super.dispose();
        this.bufferCache.clear();
        this.decoding.clear();
        this.scheduled.length = 0;
        this._graph?.buses.dispose();
        try {
            this._graph?.master.disconnect();
        } catch {
            // already disconnected
        }
        const owned = this.borrowed ? null : this._context;
        if (owned && owned.state !== "closed") {
            owned.close();
        }
    }
}
