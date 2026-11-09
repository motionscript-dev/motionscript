import {
    clipTimeAtSource,
    isRamp,
    resolveRamp,
    sampleRamp,
    sourceTimeAtClip,
    staticValue,
    transitionGainAt,
    transitionSpans,
    type AudioEffect,
    type AudioRequest,
    type AudioTransition,
    type Param,
    type Ramp,
} from "@motionscript/core";

/**
 * The Web Audio graph for one source's effect chain.
 *
 * `output` is the last node, to connect downstream; `nodes` are every node to
 * `disconnect()` on teardown; `oscillators` are tremolo LFOs the caller starts
 * and stops alongside the source.
 */
export interface AudioEffectGraph {
    output: AudioNode;
    nodes: AudioNode[];
    oscillators: OscillatorNode[];
}

/** Sample points per second an eased segment or a transition is baked into: about every 5 ms. */
const CURVE_SAMPLES_PER_SECOND = 200;

/**
 * Apply a {@link Param} to a Web Audio {@link AudioParam}: a number once, a
 * ramp as a schedule — linear segments as `linearRampToValueAtTime`, eased
 * ones baked into `setValueCurveAtTime`.
 *
 * `elapsed` is the clip seconds already played when a mid-clip seek starts the
 * source, so "now" reads the ramp at the clip's current position. `clamp` keeps
 * every scheduled value in a param's valid range.
 */
function applyParam(
    audioParam: AudioParam,
    param: Param,
    startTime: number,
    clipDuration: number,
    elapsed: number,
    clamp: (v: number) => number = (v) => v,
): void {
    // The platform throws on a non-finite value.
    const finite = (v: number): number => {
        const c = clamp(v);
        return Number.isFinite(c) ? c : audioParam.value;
    };

    if (!isRamp(param)) {
        audioParam.value = finite(param);
        return;
    }
    if (!Number.isFinite(clipDuration) || clipDuration <= 0) {
        audioParam.value = finite(staticValue(param, audioParam.value));
        return;
    }

    const keys = resolveRamp(param, clipDuration);
    if (keys.length === 0) return;
    const base = startTime - elapsed;
    audioParam.setValueAtTime(finite(sampleRamp(param, Math.max(0, elapsed), clipDuration, audioParam.value)), startTime);

    for (let i = 1; i < keys.length; i++) {
        const previous = keys[i - 1];
        const key = keys[i];
        const segStart = base + previous.time;
        const segEnd = base + key.time;
        if (segEnd <= startTime) continue;

        const span = key.time - previous.time;
        if (span <= 0) {
            audioParam.setValueAtTime(finite(key.value), Math.max(segEnd, startTime));
            continue;
        }

        // A segment already under way when the source starts carries on from
        // the value set at `startTime` rather than restarting from its own.
        const done = Math.max(0, (startTime - segStart) / span);
        const curveStart = Math.max(segStart, startTime);
        if (key.linear) {
            if (done === 0) audioParam.setValueAtTime(finite(previous.value), curveStart);
            audioParam.linearRampToValueAtTime(finite(key.value), segEnd);
        } else {
            const curveDur = segEnd - curveStart;
            const count = Math.max(2, Math.ceil(curveDur * CURVE_SAMPLES_PER_SECOND));
            const samples = new Float32Array(count);
            for (let n = 0; n < count; n++) {
                const local = done + (1 - done) * (n / (count - 1));
                samples[n] = finite(previous.value + (key.value - previous.value) * key.ease(local));
            }
            audioParam.setValueCurveAtTime(samples, curveStart, curveDur);
        }
    }
}

/**
 * Builds the Web Audio graph for a clip's effect chain, after an
 * already-created `source`. Shared by live playback ({@link WebAudioSink}) and
 * offline export (`mixAudio`) so both sound identical.
 *
 * `startTime` is the context time the source starts; `clipDuration` the clip
 * seconds ramps run over (a clip's, or a bus's span); `elapsed` the clip seconds
 * already played at a mid-clip seek (0 for a clean start, negative before the
 * span begins).
 */
export function buildAudioEffectGraph(
    ctx: BaseAudioContext,
    source: AudioNode,
    effects: readonly AudioEffect[],
    startTime: number = ctx.currentTime,
    clipDuration: number = 0,
    elapsed: number = 0,
): AudioEffectGraph {
    const nodes: AudioNode[] = [];
    const oscillators: OscillatorNode[] = [];
    let cursor: AudioNode = source;

    const series = (node: AudioNode): void => {
        cursor.connect(node);
        nodes.push(node);
        cursor = node;
    };

    const apply = (p: AudioParam, v: Param, clamp?: (n: number) => number): void =>
        applyParam(p, v, startTime, clipDuration, elapsed, clamp);

    for (const effect of effects) {
        switch (effect.type) {
            case "gain": {
                const gain = ctx.createGain();
                apply(gain.gain, effect.value);
                series(gain);
                break;
            }
            case "highpass":
            case "lowpass": {
                const biquad = ctx.createBiquadFilter();
                biquad.type = effect.type;
                apply(biquad.frequency, effect.frequency);
                if (effect.q !== undefined) apply(biquad.Q, effect.q);
                series(biquad);
                break;
            }
            case "tremolo": {
                // A carrier gain an LFO swings: with depth d the carrier sits at
                // 1 - d/2 and the swing is d/2.
                const carrier = ctx.createGain();
                const lfo = ctx.createOscillator();
                const lfoDepth = ctx.createGain();

                apply(carrier.gain, effect.depth, (d) => 1 - clamp01(d) / 2);
                apply(lfoDepth.gain, effect.depth, (d) => clamp01(d) / 2);
                apply(lfo.frequency, effect.rate);

                lfo.connect(lfoDepth);
                lfoDepth.connect(carrier.gain);

                nodes.push(lfoDepth);
                oscillators.push(lfo);
                series(carrier);
                break;
            }
            case "echo": {
                const split = cursor;
                const merge = ctx.createGain();

                const dry = ctx.createGain();
                apply(dry.gain, effect.mix ?? 0.5, (m) => 1 - clamp01(m));
                split.connect(dry);
                dry.connect(merge);

                // The delay line is sized once, so it has to hold the ramp's longest delay.
                const delay = ctx.createDelay(Math.max(1, maxOf(effect.delay) + 1));
                apply(delay.delayTime, effect.delay);
                const feedbackGain = ctx.createGain();
                apply(feedbackGain.gain, effect.feedback, (f) => Math.max(0, Math.min(0.99, f)));
                const wet = ctx.createGain();
                apply(wet.gain, effect.mix ?? 0.5, (m) => clamp01(m));

                split.connect(delay);
                delay.connect(feedbackGain);
                feedbackGain.connect(delay);
                delay.connect(wet);
                wet.connect(merge);

                nodes.push(dry, delay, feedbackGain, wet, merge);
                cursor = merge;
                break;
            }
        }
    }

    return { output: cursor, nodes, oscillators };
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function maxOf(p: Param): number {
    return isRamp(p) ? Math.max(0, ...p.keys.map((k) => k.value)) : p;
}

/**
 * Schedule `transitionIn`/`transitionOut` onto a gain over a span `length`
 * seconds long, baked like an eased ramp. Between the two it holds at 1.
 */
export function applyTransitions(
    gain: AudioParam,
    length: number,
    transitionIn: AudioTransition | undefined,
    transitionOut: AudioTransition | undefined,
    startTime: number,
    elapsed: number,
): void {
    if (!transitionIn && !transitionOut) return;
    const seek = Math.max(0, elapsed);
    const at = (t: number): number => transitionGainAt(t, length, transitionIn, transitionOut);
    gain.setValueAtTime(at(seek), startTime);

    const spans = transitionSpans(length, transitionIn, transitionOut);
    const windows: [number, number][] = [];
    if (spans.in > 0) windows.push([0, spans.in]);
    if (spans.out > 0 && Number.isFinite(length)) windows.push([length - spans.out, length]);
    const base = startTime - elapsed;
    for (const [from, to] of windows) {
        const begin = Math.max(from, seek);
        const duration = to - begin;
        if (duration <= 0) continue;
        const count = Math.max(2, Math.ceil(duration * CURVE_SAMPLES_PER_SECOND));
        const samples = new Float32Array(count);
        for (let n = 0; n < count; n++) samples[n] = at(begin + duration * (n / (count - 1)));
        gain.setValueCurveAtTime(samples, base + begin, duration);
    }
}

/** How one request plays its source: the rate, and the lengths its ramps and transitions run over. */
export interface Playback {
    /** The constant `playbackRate`; 1 under a ramp, which is scheduled instead. */
    rate: number;
    speedRamp?: Ramp;
    /** Source seconds a speed ramp is placed on. */
    sourceLength: number;
    /** Clip seconds the volume and effect ramps run over. */
    clipDuration: number;
    /** What the transitions run over: the clip's length, unknown for an open one. */
    transitionLength: number;
}

export function playbackOf(req: AudioRequest, bufferDuration: number): Playback {
    const speed = req.speed ?? 1;
    const speedRamp = isRamp(speed) ? speed : undefined;
    const rate = speedRamp || !(Number.isFinite(speed) && (speed as number) > 0) ? 1 : (speed as number);
    // Placed on the same length core sized the request with, not the decoded buffer.
    const sourceLength = req.sourceLength ?? Math.max(0, bufferDuration - req.trimStart);
    const bounded = Number.isFinite(req.endAt);
    const clipDuration = bounded ? Math.max(0, req.endAt - req.startAt) : clipTimeAtSource(speed, sourceLength);
    return { rate, speedRamp, sourceLength, clipDuration, transitionLength: bounded ? clipDuration : Infinity };
}

/** Source seconds after `trimStart` that `clipElapsed` clip seconds have played. */
export function sourceOffsetOf(playback: Playback, clipElapsed: number): number {
    return playback.speedRamp
        ? sourceTimeAtClip(playback.speedRamp, playback.sourceLength, clipElapsed)
        : clipElapsed * playback.rate;
}

/**
 * A request's level, then its transitions, after `from`: the gains every
 * request plays through on its way to its bus.
 */
export function buildLevel(
    ctx: BaseAudioContext,
    from: AudioNode,
    req: AudioRequest,
    playback: Playback,
    startTime: number,
    elapsed: number,
): { output: AudioNode; nodes: AudioNode[] } {
    const level = ctx.createGain();
    applyParam(level.gain, req.volume ?? 1, startTime, playback.clipDuration, elapsed);
    from.connect(level);
    if (!req.transitionIn && !req.transitionOut) return { output: level, nodes: [level] };
    const transition = ctx.createGain();
    applyTransitions(transition.gain, playback.transitionLength, req.transitionIn, req.transitionOut, startTime, elapsed);
    level.connect(transition);
    return { output: transition, nodes: [level, transition] };
}

/**
 * Schedule a speed ramp onto an `AudioBufferSourceNode.playbackRate`.
 *
 * The ramp runs over **source** seconds and Web Audio schedules in context
 * seconds, so this walks clip time in small steps, converts each to a source
 * offset through the integral inverse, and lays down the rate there. `elapsed`
 * is clip seconds already played at a mid-clip seek.
 */
export function applySpeedToPlaybackRate(
    rate: AudioParam,
    speed: Ramp | undefined,
    sourceLength: number,
    clipDuration: number,
    startTime: number,
    elapsed: number,
): void {
    if (!speed) return;
    const step = 1 / CURVE_SAMPLES_PER_SECOND;
    const seekAt = Math.max(0, elapsed);
    const valueAt = (clipElapsed: number): number =>
        Math.max(1e-4, sampleRamp(speed, sourceTimeAtClip(speed, sourceLength, clipElapsed), sourceLength, 1));
    rate.setValueAtTime(valueAt(seekAt), startTime);

    for (let s = seekAt + step; s <= clipDuration + step; s += step) {
        const clamped = Math.min(s, clipDuration);
        rate.linearRampToValueAtTime(valueAt(clamped), startTime + (clamped - seekAt));
        if (clamped >= clipDuration) break;
    }
}
