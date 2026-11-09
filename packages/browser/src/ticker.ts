import { Ticker } from "@motionscript/core";

/**
 * Ticker backed by a Web Audio AudioContext. Clip time follows
 * `audioContext.currentTime` (within a few ms, see `startLoop`), so any
 * AudioBufferSourceNodes scheduled on the same context play in sync.
 *
 * When paused we suspend the context (audio stops, currentTime freezes);
 * when playing we resume and a rAF loop publishes ticks at the target fps.
 *
 * A single silent buffer covering the full timeline is started on play(),
 * which keeps the context active and gives the browser a stable audio
 * graph to schedule against even on scenes that contain no audio nodes.
 */
export class WebTicker extends Ticker {
    private readonly contextOf: () => AudioContext;
    private readonly ownsContext: boolean;
    private _context: AudioContext | null = null;
    private fps: number;

    private playStartCtxTime: number = 0;
    private seekOffset: number = 0;
    private speed: number = 1;
    private reverse: boolean = false;

    private rafId: number | null = null;
    /** Bumped by every `seek`, so the loop can tell that a listener or tick callback moved the playhead under it. */
    private seekEpoch: number = 0;
    private silentSource: AudioBufferSourceNode | null = null;

    /**
     * `context` may be a getter, called on the first `play`: a session hands
     * over its audio sink's, which is created on first use, so a session that
     * never plays never opens the audio device.
     */
    constructor(opts: { context?: AudioContext | (() => AudioContext); fps: number }) {
        super();
        const { context } = opts;
        this.contextOf = typeof context === "function" ? context : () => context ?? new AudioContext();
        this.ownsContext = !context;
        this.fps = opts.fps;
    }

    getContext(): AudioContext {
        this._context ??= this.contextOf();
        return this._context;
    }

    private get context(): AudioContext {
        return this.getContext();
    }

    seek(t: number): void {
        const clamped = Math.max(0, Math.min(t, this.duration));
        this.seekOffset = clamped;
        // The clock is read only while playing; `play` anchors it afresh.
        if (this.isPlaying) this.playStartCtxTime = this.context.currentTime;
        this.seekEpoch++;
        this.setCurrentTime(clamped);
    }

    /**
     * Anchors elapsed-time tracking to the current `context.currentTime`, starts the silent ticker
     * + rAF tick loop and asks a suspended context to resume.
     *
     * Synchronous, as {@link Ticker.play} is: a `pause` or `seek` in the same turn must find a
     * running clock to stop. A suspended context's `currentTime` is frozen, so the clock holds at
     * the anchor until the resume lands — outside a user gesture that is never.
     */
    play(speed: number = 1, reverse: boolean = false): void {
        this.speed = speed;
        this.reverse = reverse;
        this.seekOffset = this.currentTime;

        if (this.context.state === "suspended") {
            this.context.resume().then(
                () => {
                    // A pause that arrived while the resume was pending could not suspend it.
                    if (!this.isPlaying && this.context.state === "running") void this.context.suspend();
                },
                (error) => {
                    console.error("[WebTicker] The audio context could not resume:", error);
                    this.pause();
                },
            );
        }

        this.playStartCtxTime = this.context.currentTime;
        this.startSilentTicker();
        super.play(speed, reverse);
        this.startLoop();
    }

    /** Stops the tick loop and silent ticker, then suspends the context — freezing `currentTime` so elapsed-time math stays correct across the pause. */
    pause(): void {
        this.seekOffset = this.currentTime;
        this.stopLoop();
        this.stopSilentTicker();
        if (this._context?.state === "running") {
            this._context.suspend();
        }
        super.pause();
    }

    /** (Re)starts the silent buffer source covering the remaining timeline — keeps the AudioContext active and gives a stable graph for other AudioBufferSourceNodes to schedule against, per the class-level note. */
    private startSilentTicker(): void {
        this.stopSilentTicker();
        const remaining = Math.max(0.001, this.duration - this.seekOffset);
        const sampleRate = this.context.sampleRate;
        const buffer = this.context.createBuffer(1, Math.ceil(remaining * sampleRate), sampleRate);
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.context.destination);
        source.start();
        this.silentSource = source;
    }

    private stopSilentTicker(): void {
        if (this.silentSource) {
            try {
                this.silentSource.onended = null;
                this.silentSource.stop();
                this.silentSource.disconnect();
            } catch {
                // already stopped
            }
            this.silentSource = null;
        }
    }

    /** Where the playhead is now, from elapsed `context.currentTime` (so it stays sample-accurate), and whether that is the end of the run. */
    private position(): { time: number; ended: boolean } {
        const elapsed = (this.context.currentTime - this.playStartCtxTime) * this.speed;
        const next = this.reverse
            ? this.seekOffset - elapsed
            : this.seekOffset + elapsed;
        const time = Math.max(0, Math.min(next, this.duration));
        return { time, ended: this.reverse ? time <= 0 : time >= this.duration };
    }

    /**
     * Drives ticks off `requestAnimationFrame`, firing `tick()` when the playhead reaches another
     * project frame — and once more at the end of the run, whether or not it landed on a boundary.
     *
     * `context.currentTime` moves in whole render quanta handed over in bursts: at 48 kHz on a
     * 60 Hz display it advances 8, 10.67, 18.67 or 21.33 ms between animation frames, and a
     * playhead read straight off it skipped up to a third of the frames. So the playhead advances
     * by each animation frame's own interval, pulled 5% of the way to the audio clock every frame
     * and snapped to it when they disagree by more than 50 ms (a stall, a seek). It stays within
     * a few ms of the audio and moves one frame per frame.
     *
     * A listener may `seek` (a host looping wraps to 0 when it hears the end), so the end is
     * re-read after the listeners and the tick callbacks have run: a run that was seeked out of
     * its end carries on, and one that was not pauses itself.
     */
    private startLoop(): void {
        if (this.rafId !== null) return;
        const frameOf = (t: number) => Math.floor(t * this.fps + 1e-6);
        let lastFrame = frameOf(this.currentTime);
        let steady: { time: number; at: number; epoch: number } | null = null;
        const steadied = (now: number): { time: number; ended: boolean } => {
            const audio = this.position();
            let time = audio.time;
            if (!audio.ended && steady && steady.epoch === this.seekEpoch) {
                const step = ((now - steady.at) / 1000) * this.speed;
                const predicted = this.reverse ? steady.time - step : steady.time + step;
                const drift = audio.time - predicted;
                const next = predicted + drift * 0.05;
                if (Math.abs(drift) <= 0.05 && next > 0 && next < this.duration) time = next;
            }
            steady = { time, at: now, epoch: this.seekEpoch };
            return { time, ended: audio.ended };
        };

        const loop = async (now: number) => {
            let epoch = this.seekEpoch;
            const position = steadied(now);
            let ended = position.ended;
            // This loop runs at the display's refresh rate, which on a 120 or 144Hz panel is two
            // or three times the rate anything is rendered at — so the clock advances every time
            // round (the elapsed maths in `play`/`pause` depend on it being exact) while listeners
            // hear about it once per frame. The end of the run always reports, or the final
            // position would never reach a host. See `Ticker.setCurrentTime`.
            const crossed = frameOf(position.time) !== lastFrame;
            const report = crossed || ended;
            this.setCurrentTime(position.time, report);

            const reread = () => {
                if (this.seekEpoch === epoch) return;
                epoch = this.seekEpoch;
                lastFrame = frameOf(this.currentTime);
                ended = this.position().ended;
            };
            reread();

            if (report) {
                lastFrame = frameOf(this.currentTime);
                // Await so that a slow tick (asset load on a clip
                // boundary) doesn't queue a second concurrent tick.
                await this.tick();
                reread();
            }

            // If pause() cleared the rafId while we were awaiting tick(),
            // do not resume the loop.
            if (this.rafId === null) return;
            if (ended) {
                this.pause();
                return;
            }
            this.rafId = requestAnimationFrame(loop);
        };

        this.rafId = requestAnimationFrame(loop);
    }

    private stopLoop(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    dispose(): void {
        this.stopLoop();
        this.stopSilentTicker();
        if (this.ownsContext) {
            void this._context?.close();
        }
        super.dispose();
    }
}
