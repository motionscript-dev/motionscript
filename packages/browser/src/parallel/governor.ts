/**
 * Decides how many lanes render at once, from what the run itself measures.
 *
 * Lanes do not add throughput for free. Every lane's encoder, and on a WebGPU
 * canvas its frame capture, run in the browser's one GPU process, so once a lane
 * spends its time waiting on the encoder rather than drawing, a second lane only
 * splits the same encoder between two sessions and the export gets slower. The
 * governor starts with one lane, adds the next only while lanes are mostly
 * drawing, keeps it only if total throughput rose, and then settles.
 */
export interface GovernorOptions {
    /** Lanes available, the first being the one every run starts with. */
    lanes: number;
    /** How long a configuration is measured before it is judged, in ms. */
    windowMs?: number;
    /** Frames a window needs before it is judged. */
    minFrames?: number;
    /** Above this share of time waiting on the encoder, another lane cannot help. */
    maxWaitShare?: number;
    /** A lane is kept only if it raises throughput by at least this factor. */
    minGain?: number;
    /** How long the newest lane draws before it is measured: its first frames wait on loads and a cold encoder. */
    warmupMs?: number;
}

export interface FrameSample {
    lane: number;
    frames: number;
    busyMs: number;
    waitMs: number;
    at: number;
}

interface Window {
    start: number | null;
    frames: number;
    busyMs: number;
    waitMs: number;
}

export class LaneGovernor {
    private _active = 1;
    private _settled: boolean;
    private _window: Window = emptyWindow();
    private _previousFps = 0;
    private _newestFirstAt: number | null = null;
    private readonly _windowMs: number;
    private readonly _minFrames: number;
    private readonly _maxWaitShare: number;
    private readonly _minGain: number;
    private readonly _warmupMs: number;

    constructor(private readonly _options: GovernorOptions) {
        this._windowMs = _options.windowMs ?? 1500;
        this._minFrames = _options.minFrames ?? 24;
        this._maxWaitShare = _options.maxWaitShare ?? 0.45;
        this._minGain = _options.minGain ?? 1.1;
        this._warmupMs = _options.warmupMs ?? 300;
        this._settled = _options.lanes <= 1;
    }

    /** Lanes `0..active-1` may take chunks. */
    get active(): number {
        return this._active;
    }

    get settled(): boolean {
        return this._settled;
    }

    /** Stop measuring once a lane dies: the run continues on at most `alive` lanes. */
    laneLost(alive: number): void {
        this._active = Math.max(1, Math.min(this._active, alive));
        this._settled = true;
    }

    /**
     * Record frames a lane drew. Returns the new active count when it changed.
     * A window opens once the newest lane has drawn for `warmupMs`, so its
     * start-up is not counted against it.
     */
    record(sample: FrameSample): number | null {
        if (this._settled || sample.lane >= this._active) return null;
        const w = this._window;
        if (w.start === null) {
            if (sample.lane !== this._active - 1) return null;
            this._newestFirstAt ??= sample.at;
            if (sample.at - this._newestFirstAt >= this._warmupMs) w.start = sample.at;
            return null;
        }
        w.frames += sample.frames;
        w.busyMs += sample.busyMs;
        w.waitMs += sample.waitMs;
        const elapsed = sample.at - w.start;
        if (elapsed < this._windowMs || w.frames < this._minFrames) return null;

        const fps = (w.frames * 1000) / elapsed;
        const waitShare = w.waitMs / Math.max(1, w.busyMs + w.waitMs);
        const before = this._active;
        if (this._active > 1 && fps < this._previousFps * this._minGain) {
            this._active -= 1;
            this._settled = true;
        } else if (waitShare <= this._maxWaitShare && this._active < this._options.lanes) {
            this._previousFps = fps;
            this._active += 1;
        } else {
            this._settled = true;
        }
        this._window = emptyWindow();
        this._newestFirstAt = null;
        return this._active !== before ? this._active : null;
    }
}

function emptyWindow(): Window {
    return { start: null, frames: 0, busyMs: 0, waitMs: 0 };
}
