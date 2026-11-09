import { describe, expect, it } from "vitest";
import { AudioEffects, hold, ramp, type AudioEffect } from "@motionscript/core";
import {
    applySpeedToPlaybackRate,
    applyTransitions,
    buildAudioEffectGraph,
    playbackOf,
    type AudioEffectGraph,
} from "../src/audio/effect-graph";
import { SAMPLE_RATE, levelAt, peakBetween, request, sineBuffer, toneBuffer, troughBetween } from "./audio.fixtures";

/**
 * `buildAudioEffectGraph` rendered offline, one effect type at a time.
 *
 * What is asserted is the signal that comes out of the graph, since a node with
 * the right type and a wrong parameter is the failure that looks right in the
 * debugger, plus the shape of the graph it returns for the
 * things a signal cannot say: which nodes there are, and in what order.
 */

interface Rendered {
    out: AudioBuffer;
    graph: AudioEffectGraph;
}

/** `source` through `filters`, rendered for `seconds`. The oscillators are started with the source, as the callers do. */
async function render(
    source: AudioBuffer,
    filters: readonly AudioEffect[],
    seconds: number,
    options: { startTime?: number; clipDuration?: number; elapsed?: number } = {},
): Promise<Rendered> {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    const node = ctx.createBufferSource();
    node.buffer = source;
    const graph = buildAudioEffectGraph(ctx, node, filters, options.startTime ?? 0, options.clipDuration ?? 0, options.elapsed ?? 0);
    graph.output.connect(ctx.destination);
    node.start(0);
    for (const osc of graph.oscillators) osc.start(0);
    return { out: await ctx.startRendering(), graph };
}

/** The graph's nodes by class name, in the order they were built. */
const kinds = (graph: AudioEffectGraph): string[] => graph.nodes.map((n) => n.constructor.name);

const chain = (...filters: Iterable<AudioEffect>[]): AudioEffect[] => filters.flatMap((f) => [...f]);

describe("an empty chain", () => {
    it("returns the source itself as the output, with no nodes and no oscillators", async () => {
        const ctx = new OfflineAudioContext(1, 8, SAMPLE_RATE);
        const source = ctx.createBufferSource();

        const graph = buildAudioEffectGraph(ctx, source, []);

        expect(graph.output).toBe(source);
        expect(graph.nodes).toEqual([]);
        expect(graph.oscillators).toEqual([]);
    });
});

describe("gain", () => {
    it("scales the signal and is one GainNode", async () => {
        const { out, graph } = await render(toneBuffer(1, 0.5), chain(AudioEffects.gain(0.5)), 1);

        expect(kinds(graph)).toEqual(["GainNode"]);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.25, 2);
    });

    it("is the same through the volume alias", async () => {
        const { out } = await render(toneBuffer(1, 0.5), chain(AudioEffects.volume(2)), 1);

        expect(levelAt(out, 0.5)).toBeCloseTo(1, 2);
    });

    it("leaves the parameter's current value for a value that is not finite", async () => {
        const { out } = await render(toneBuffer(1, 0.5), chain(AudioEffects.gain(Infinity), AudioEffects.gain(NaN)), 1);

        // A GainNode's own default is 1, so a non-finite gain changes nothing and does not throw.
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });
});

describe("highpass and lowpass", () => {
    const low = sineBuffer(1, 100, 0.5);
    const high = sineBuffer(1, 8000, 0.5);

    it("highpass removes what is below the cutoff and keeps what is above", async () => {
        const cut = await render(low, chain(AudioEffects.highpass(2000)), 1);
        const kept = await render(high, chain(AudioEffects.highpass(2000)), 1);

        expect(kinds(cut.graph)).toEqual(["BiquadFilterNode"]);
        expect((cut.graph.nodes[0] as BiquadFilterNode).type).toBe("highpass");
        expect(peakBetween(cut.out, 0.5, 1)).toBeLessThan(0.02);
        expect(peakBetween(kept.out, 0.5, 1)).toBeGreaterThan(0.4);
    });

    it("lowpass keeps what is below the cutoff and removes what is above", async () => {
        const kept = await render(low, chain(AudioEffects.lowpass(500)), 1);
        const cut = await render(high, chain(AudioEffects.lowpass(500)), 1);

        expect((kept.graph.nodes[0] as BiquadFilterNode).type).toBe("lowpass");
        expect(peakBetween(kept.out, 0.5, 1)).toBeGreaterThan(0.4);
        expect(peakBetween(cut.out, 0.5, 1)).toBeLessThan(0.02);
    });

    it("sets the cutoff, and sets Q only when one is given", async () => {
        const plain = await render(low, chain(AudioEffects.lowpass(750)), 0.1);
        const resonant = await render(low, chain(AudioEffects.lowpass({ frequency: 750, q: 6 })), 0.1);

        const [plainFilter, resonantFilter] = [plain.graph.nodes[0], resonant.graph.nodes[0]] as BiquadFilterNode[];
        expect(plainFilter.frequency.value).toBe(750);
        expect(plainFilter.Q.value).toBe(1);
        expect(resonantFilter.Q.value).toBe(6);
    });
});

describe("tremolo", () => {
    it("wobbles a constant signal between 1 − depth and 1 at the rate", async () => {
        const { out, graph } = await render(toneBuffer(1, 1), chain(AudioEffects.tremolo({ rate: 5, depth: 1 })), 1);

        expect(graph.oscillators).toHaveLength(1);
        expect(graph.oscillators[0].type).toBe("sine");
        expect(graph.oscillators[0].frequency.value).toBe(5);
        expect(peakBetween(out, 0, 1)).toBeCloseTo(1, 1);
        expect(troughBetween(out, 0, 1)).toBeLessThan(0.05);
    });

    it("keeps a half-depth wobble between one half and one", async () => {
        const { out } = await render(toneBuffer(1, 1), chain(AudioEffects.tremolo({ rate: 5, depth: 0.5 })), 1);

        expect(peakBetween(out, 0, 1)).toBeCloseTo(1, 1);
        expect(troughBetween(out, 0, 1)).toBeGreaterThan(0.45);
        expect(troughBetween(out, 0, 1)).toBeLessThan(0.55);
    });

    it("leaves the signal alone at depth 0, and clamps a depth outside [0, 1]", async () => {
        const flat = await render(toneBuffer(1, 0.5), chain(AudioEffects.tremolo({ rate: 5, depth: 0 })), 1);
        expect(peakBetween(flat.out, 0, 1)).toBeCloseTo(0.5, 2);
        expect(troughBetween(flat.out, 0, 1)).toBeCloseTo(0.5, 2);

        const over = await render(toneBuffer(1, 1), chain(AudioEffects.tremolo({ rate: 5, depth: 7 })), 1);
        expect(troughBetween(over.out, 0, 1)).toBeLessThan(0.05);
        expect(peakBetween(over.out, 0, 1)).toBeLessThanOrEqual(1.0001);
    });

    it("builds the LFO's gain and the carrier as nodes the caller can disconnect, and returns the carrier as output", async () => {
        const { graph } = await render(toneBuffer(0.1, 1), chain(AudioEffects.tremolo({ rate: 3 })), 0.1);

        expect(kinds(graph)).toEqual(["GainNode", "GainNode"]);
        expect(graph.output).toBe(graph.nodes[1]);
    });
});

describe("echo", () => {
    const burst = toneBuffer(0.5, 0.5);

    it("is dry plus a delayed wet copy, summed", async () => {
        const { out, graph } = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: 0, mix: 0.5 })), 1.5);

        expect(kinds(graph)).toEqual(["GainNode", "DelayNode", "GainNode", "GainNode", "GainNode"]);
        // Dry at half, then the wet copy at half once the delay is up.
        expect(levelAt(out, 0.25)).toBeCloseTo(0.25, 2);
        expect(levelAt(out, 0.75)).toBeCloseTo(0.25, 2);
        expect(levelAt(out, 1.25)).toBeCloseTo(0, 2);
    });

    it("is wet only at mix 1 and dry only at mix 0", async () => {
        const wet = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: 0, mix: 1 })), 1.5);
        expect(levelAt(wet.out, 0.25)).toBeCloseTo(0, 2);
        expect(levelAt(wet.out, 0.75)).toBeCloseTo(0.5, 2);

        const dry = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: 0, mix: 0 })), 1.5);
        expect(levelAt(dry.out, 0.25)).toBeCloseTo(0.5, 2);
        expect(levelAt(dry.out, 0.75)).toBeCloseTo(0, 2);
    });

    it("takes a mix of one half when none is given", async () => {
        const { out } = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: 0 })), 1.5);

        expect(levelAt(out, 0.25)).toBeCloseTo(0.25, 2);
        expect(levelAt(out, 0.75)).toBeCloseTo(0.25, 2);
    });

    it("clamps the mix to [0, 1] and the feedback to [0, 0.99]", async () => {
        const { graph } = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: 5, mix: 3 })), 0.1);
        const [dry, , feedback, wet] = graph.nodes as GainNode[];

        expect(dry.gain.value).toBe(0);
        expect(wet.gain.value).toBe(1);
        expect(feedback.gain.value).toBeCloseTo(0.99, 6);

        const negative = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: -2, mix: -1 })), 0.1);
        const [dry2, , feedback2, wet2] = negative.graph.nodes as GainNode[];
        expect(dry2.gain.value).toBe(1);
        expect(wet2.gain.value).toBe(0);
        expect(feedback2.gain.value).toBe(0);
    });

    it("feeds the wet path back, so the repeats decay by the feedback", async () => {
        const { out } = await render(burst, chain(AudioEffects.echo({ delay: 0.5, feedback: 0.5, mix: 1 })), 2.5);

        expect(levelAt(out, 0.75)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 1.25)).toBeCloseTo(0.25, 2);
        expect(levelAt(out, 1.75)).toBeCloseTo(0.125, 2);
    });

    it("sizes the delay line from the delay, with a floor of a second", async () => {
        const short = await render(burst, chain(AudioEffects.echo({ delay: 0.2, feedback: 0 })), 0.1);
        const long = await render(burst, chain(AudioEffects.echo({ delay: 2.5, feedback: 0 })), 0.1);

        expect((short.graph.nodes[1] as DelayNode).delayTime.maxValue).toBeCloseTo(1.2, 5);
        expect((long.graph.nodes[1] as DelayNode).delayTime.maxValue).toBeCloseTo(3.5, 5);
    });
});

describe("playbackOf", () => {
    it("sets a scalar speed as the rate and leaves a ramp to the scheduler", () => {
        expect(playbackOf(request("s", { speed: 2 }), 4).rate).toBe(2);
        expect(playbackOf(request("s"), 4).rate).toBe(1);
        // A speed that is zero or negative has no playback rate to give.
        expect(playbackOf(request("s", { speed: 0 }), 4).rate).toBe(1);
        expect(playbackOf(request("s", { speed: -2 }), 4).rate).toBe(1);

        const curve = ramp(1, 3, 1);
        const ramped = playbackOf(request("s", { speed: curve }), 4);
        expect(ramped.rate).toBe(1);
        expect(ramped.speedRamp).toBe(curve);
    });

    it("places a speed ramp on the source length the request carries, not the decoded buffer", () => {
        expect(playbackOf(request("s", { trimStart: 1, speed: ramp(1, 2, 2), sourceLength: 3 }), 10).sourceLength).toBe(3);
        expect(playbackOf(request("s", { trimStart: 1, speed: ramp(1, 2, 2) }), 10).sourceLength).toBe(9);
    });

    it("gives an open clip no end for its transitions", () => {
        expect(playbackOf(request("s", { startAt: 1, endAt: 3 }), 10).transitionLength).toBe(2);
        expect(playbackOf(request("s", { endAt: Infinity, speed: 2 }), 10)).toMatchObject({ clipDuration: 5, transitionLength: Infinity });
    });
});

describe("applyTransitions", () => {
    async function faded(over: Parameters<typeof applyTransitions>, seconds: number): Promise<AudioBuffer> {
        const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
        const source = ctx.createBufferSource();
        source.buffer = toneBuffer(seconds, 0.5);
        const gain = ctx.createGain();
        over[0] = gain.gain;
        applyTransitions(...over);
        source.connect(gain).connect(ctx.destination);
        source.start(0);
        return ctx.startRendering();
    }

    it("fades in over the first seconds and out over the last, on the curve given", async () => {
        const linear = { kind: "linear" } as const;
        const out = await faded([null!, 4, { duration: 1, curve: linear }, { duration: 2, curve: linear }, 0, 0], 4);

        expect(levelAt(out, 0)).toBeLessThan(0.02);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 1.5)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 3)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 3.98)).toBeLessThan(0.02);
    });

    it("defaults to equal power", async () => {
        const out = await faded([null!, 2, { duration: 2 }, undefined, 0, 0], 2);

        expect(levelAt(out, 1)).toBeCloseTo(0.5 * Math.SQRT1_2, 1);
    });

    it("starts where a mid-clip seek lands", async () => {
        const linear = { kind: "linear" } as const;
        const out = await faded([null!, 4, { duration: 2, curve: linear }, undefined, 0, 1], 2);

        expect(levelAt(out, 0)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 1.5)).toBeCloseTo(0.5, 2);
    });
});

describe("the order of a chain", () => {
    it("builds in array order, index 0 next to the source, and outputs the last", async () => {
        const { graph } = await render(
            toneBuffer(0.1, 0.5),
            chain(AudioEffects.gain(0.5).lowpass(5000).tremolo({ rate: 4 }).highpass(20)),
            0.1,
        );

        expect(kinds(graph)).toEqual(["GainNode", "BiquadFilterNode", "GainNode", "GainNode", "BiquadFilterNode"]);
        expect(graph.output).toBe(graph.nodes[graph.nodes.length - 1]);
        expect(graph.oscillators).toHaveLength(1);
    });

    it("stacks the effect of each filter in turn", async () => {
        const { out } = await render(toneBuffer(1, 0.8), chain(AudioEffects.gain(0.5).gain(0.5)), 1);

        expect(levelAt(out, 0.5)).toBeCloseTo(0.2, 2);
    });
});

describe("a curve against a known length", () => {
    const tone = toneBuffer(2, 0.5);

    it("resolves a fade-out against the clip duration it is given", async () => {
        const over2 = await render(tone, chain(AudioEffects.gain(hold().ramp(1, 0, 1))), 2, { clipDuration: 2 });
        const over3 = await render(tone, chain(AudioEffects.gain(hold().ramp(1, 0, 1))), 2, { clipDuration: 3 });

        // End-anchored: the last second of a 2 s clip is 1…2, and of a 3 s clip 2…3.
        expect(levelAt(over2.out, 0.5)).toBeCloseTo(0.5, 2);
        expect(levelAt(over2.out, 1.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(over3.out, 1.5)).toBeCloseTo(0.5, 2);
    });

    it("holds a fade-in at the start of the clip, whatever its length", async () => {
        const { out } = await render(tone, chain(AudioEffects.gain(ramp(0, 1, 1).hold())), 2, { clipDuration: 2 });

        expect(levelAt(out, 0)).toBeLessThan(0.02);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 1.5)).toBeCloseTo(0.5, 2);
    });

    it("bakes an eased segment into samples and follows it", async () => {
        const quad = { kind: "in", args: "quad" } as const;
        const { out } = await render(tone, chain(AudioEffects.gain(ramp(0, 1, 2, { ease: quad }))), 2, { clipDuration: 2 });

        // Half-way through, an ease-in quadratic is a quarter of the way up.
        expect(levelAt(out, 1)).toBeCloseTo(0.5 * 0.25, 1);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5 * 0.0625, 1);
        expect(levelAt(out, 1.9)).toBeCloseTo(0.5 * 0.9025, 1);
    });

    it("holds the curve's static value when it is given no clip length", async () => {
        const defaulted = await render(tone, chain(AudioEffects.gain(ramp(0.2, 1, 1))), 1);
        const zero = await render(tone, chain(AudioEffects.gain(ramp(0.2, 1, 1))), 1, { clipDuration: 0 });
        const infinite = await render(tone, chain(AudioEffects.gain(ramp(0.2, 1, 1))), 1, { clipDuration: Infinity });

        for (const { out } of [defaulted, zero, infinite]) {
            expect(levelAt(out, 0.1)).toBeCloseTo(0.1, 2);
            expect(levelAt(out, 0.9)).toBeCloseTo(0.1, 2);
        }
    });

    it("schedules a curve-valued filter parameter, not only a gain", async () => {
        const { out } = await render(
            sineBuffer(2, 6000, 0.5),
            chain(AudioEffects.lowpass(ramp(20000, 200, 2))),
            2,
            { clipDuration: 2 },
        );

        // The cutoff sweeps down from far above the tone to far below it: loud at the start, gone by the end.
        expect(peakBetween(out, 0.05, 0.2)).toBeGreaterThan(0.4);
        expect(peakBetween(out, 1.8, 1.95)).toBeLessThan(0.1);
    });
});

describe("a seek into a clip", () => {
    const tone = toneBuffer(2, 0.5);

    it("starts a fade where the clip has got to, not at its beginning", async () => {
        // The source starts at clip time 1; the fade-out is over clip time 1…2.
        const { out } = await render(tone, chain(AudioEffects.gain(hold().ramp(1, 0, 1))), 1, { clipDuration: 2, elapsed: 1 });

        expect(levelAt(out, 0)).toBeCloseTo(0.5, 1);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 0.98)).toBeLessThan(0.02);
    });

    it("carries on from the part of a segment already under way", async () => {
        // A 2 s ramp 0 → 1, entered 0.5 s in: the value starts at a quarter and keeps rising.
        const { out } = await render(tone, chain(AudioEffects.gain(ramp(0, 1, 2))), 1, { clipDuration: 2, elapsed: 0.5 });

        expect(levelAt(out, 0)).toBeCloseTo(0.5 * 0.25, 1);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5 * 0.5, 1);
    });

    it("waits out a negative elapsed time, holding the first value until the span begins", async () => {
        // The clip's span begins 0.5 s into the render.
        const { out } = await render(tone, chain(AudioEffects.gain(ramp(0, 1, 1).hold())), 2, { clipDuration: 2, elapsed: -0.5 });

        expect(levelAt(out, 0.25)).toBeLessThan(0.02);
        expect(levelAt(out, 1.0)).toBeCloseTo(0.25, 1);
        expect(levelAt(out, 1.75)).toBeCloseTo(0.5, 1);
    });

    it("skips a segment wholly behind the seek point", async () => {
        // Seeking to 1.5 into a fade over 0…1 leaves only its end value.
        const { out } = await render(tone, chain(AudioEffects.gain(ramp(0, 1, 1).hold())), 1, { clipDuration: 2, elapsed: 1.5 });

        expect(levelAt(out, 0)).toBeCloseTo(0.5, 2);
        expect(levelAt(out, 0.5)).toBeCloseTo(0.5, 2);
    });
});

describe("applySpeedToPlaybackRate", () => {
    /** The rate a source ends up with at each context time, read by rendering a ramp through it. */
    async function consumedBy(curve: ReturnType<typeof ramp>, seconds: number, elapsed = 0): Promise<number> {
        // A source whose sample value is its own time (in units of 0.1 s) says how far into it the output has got.
        const frames = Math.round(20 * SAMPLE_RATE);
        const buffer = new AudioBuffer({ length: frames, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) data[i] = (0.01 * i) / SAMPLE_RATE;

        const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        applySpeedToPlaybackRate(source.playbackRate, curve, 20, seconds, 0, elapsed);
        source.start(0);
        const out = await ctx.startRendering();
        // Sample value at the end, back to seconds of source.
        return out.getChannelData(0)[out.length - 1] / 0.01;
    }

    it("follows a flat ramp at its value", async () => {
        expect(await consumedBy(ramp(2, 2, 20), 1)).toBeCloseTo(2, 1);
    });

    it("integrates a rising curve over the clip", async () => {
        // The rate runs 1 → 3 over the first 2 s of source: the source covered in 1 s of clip is less than 2 s.
        const covered = await consumedBy(ramp(1, 3, 20), 1);

        expect(covered).toBeGreaterThan(1);
        expect(covered).toBeLessThan(1.5);
    });

    it("does nothing without a curve", () => {
        const ctx = new OfflineAudioContext(1, 8, SAMPLE_RATE);
        const source = ctx.createBufferSource();

        applySpeedToPlaybackRate(source.playbackRate, undefined, 2, 2, 0, 0);

        expect(source.playbackRate.value).toBe(1);
    });
});
