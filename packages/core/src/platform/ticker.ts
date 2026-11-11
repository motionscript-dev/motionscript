/** Called every animation frame with the current playhead time (seconds). Must return a Promise so the clock can await all renderers before advancing. */
export type TickCallback = (time: number) => Promise<void>;

/** Fired when playback starts. Receives the time at which playback began, the playback speed multiplier, and whether playback is reversed. */
export type PlayCallback = (time: number, speed: number, reverse: boolean) => void;

/** Fired when the playhead reaches a new frame: once per frame, not per animation frame (see {@link Ticker.setCurrentTime}), so a rAF-driven subclass on a high-refresh display keeps the extra positions to itself. */
export type TimeCallback = (time: number) => void;

/**
 * Platform-agnostic base for driving playback. Subclasses implement the frame loop (rAF in the browser, a setInterval
 * in Node) and call `setCurrentTime` / `tick`; `Ticker` owns the subscriber lists and shared playback state. Register
 * listeners via `onTick` / `onPlay` / `onPause` / `onTime`, set `setDuration`, and `dispose` when done.
 *
 * `play`, `pause` and `seek` take effect before they return, so any order of them in one turn leaves the clock where
 * the last one put it. A time listener or tick callback may `seek` (a host looping wraps to the start when it hears the
 * end), so a subclass must read the end of a run again afterwards. At the end of a run it reports a final tick and pauses.
 */
export abstract class Ticker {
    private _isPlaying: boolean = false;
    private _currentTime: number = 0;
    protected _duration: number = 0;

    get isPlaying(): boolean {
        return this._isPlaying;
    }

    get currentTime(): number {
        return this._currentTime;
    }

    get duration(): number {
        return this._duration;
    }

    setDuration(duration: number): void {
        this._duration = duration;
    }

    /**
     * Updates the playhead and notifies time listeners; no-ops if the time hasn't changed. `notify: false` keeps the
     * clock exact (`pause`/`play` anchor their elapsed-time maths on it, so it advances every loop frame) while keeping
     * subscribers quiet: a subclass that knows its frame rate fires {@link onTime} once per frame, not per animation
     * frame (on a 144Hz display that was a React render per refresh to drive a 60fps render).
     */
    protected setCurrentTime(t: number, notify: boolean = true): void {
        if (this._currentTime === t) return;
        this._currentTime = t;
        if (!notify) return;
        for (const cb of this.timeCallbacks) cb(t);
    }

    protected setPlaying(playing: boolean): void {
        this._isPlaying = playing;
    }

    play(speed: number, reverse: boolean): void {
        this._isPlaying = true;
        for (const cb of this.playCallbacks) cb(this._currentTime, speed, reverse);
    }

    /** Awaits all tick callbacks in parallel. Subclasses call this once per frame after updating `currentTime`. */
    protected async tick(): Promise<void> {
        await Promise.all(this.tickCallbacks.map(c => c(this._currentTime)));
    }

    pause(): void {
        this._isPlaying = false;
        for (const cb of this.pauseCallbacks) cb();
    }

    /** Moves the playhead to `t` (seconds). Subclasses decide whether this also triggers a tick. */
    abstract seek(t: number): void;

    protected tickCallbacks: TickCallback[] = [];
    protected playCallbacks: PlayCallback[] = [];
    protected pauseCallbacks: (() => void)[] = [];
    protected timeCallbacks: TimeCallback[] = [];

    /** Clears all registered callbacks. Call when tearing down a scene to avoid memory leaks. */
    dispose() {
        this.tickCallbacks.length = 0;
        this.playCallbacks.length = 0;
        this.pauseCallbacks.length = 0;
        this.timeCallbacks.length = 0;
    }

    onTick(callback: TickCallback) {
        this.tickCallbacks.push(callback);
    }

    onPlay(callback: PlayCallback) {
        this.playCallbacks.push(callback);
    }

    onPause(callback: () => void) {
        this.pauseCallbacks.push(callback);
    }

    onTime(callback: TimeCallback) {
        this.timeCallbacks.push(callback);
    }
}
