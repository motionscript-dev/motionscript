import { busStopKey, type AudioBusStop, type AudioEffect } from "@motionscript/core";
import { applyTransitions, buildAudioEffectGraph } from "./effect-graph";

/** The live chains for one audio context's buses. Held per context, not per clip: every clip naming a bus connects into the *same* nodes, so a bus reverb is one shared tail (flattening levels into per-clip gain sounds right; flattening effects would not). */
export class AudioBusGraph {
    constructor(
        private readonly ctx: BaseAudioContext,
        private readonly destination: AudioNode,
    ) { }

    /** The input node a clip on `bus` should connect to, building the chain on first ask. `bus` is source-adjacent first (`bus[0]` is the one the clip feeds; each later stop is its parent); an empty or absent chain returns the destination. `startTime` is the context time a new chain's schedule starts from and `clipTime` the same instant in the stops' own seconds, which place a curve over its `startAt`–`endAt`. */
    inputFor(bus: readonly AudioBusStop[] | undefined, startTime: number, clipTime: number): AudioNode {
        if (!bus || bus.length === 0) return this.destination;
        return this.chainFrom(bus, 0, startTime, clipTime);
    }

    /** Disconnect every live bus node, so the next {@link inputFor} builds afresh. Safe to call more than once. */
    dispose(): void {
        for (const node of this.nodes) {
            try { node.disconnect(); } catch { /* already torn down */ }
        }
        for (const osc of this.oscillators) {
            try { osc.stop(); } catch { /* never started, or already stopped */ }
        }
        this.nodes.length = 0;
        this.oscillators.length = 0;
        this.inputs.clear();
    }

    private readonly inputs = new Map<string, AudioNode>();
    private readonly nodes: AudioNode[] = [];
    private readonly oscillators: OscillatorNode[] = [];

    /** Builds (or reuses) the chain for `bus[index]`, connected to whatever `bus[index + 1]` resolves to. Recursive because a bus's *output* must exist before its own nodes connect to it. Reuse is keyed by everything that changes what it sounds like, not by id alone: a bus edited under a playing device, or one id on two tracks, is a different chain, and a stale one would play stale levels and a curve anchored to the wrong span. */
    private chainFrom(bus: readonly AudioBusStop[], index: number, startTime: number, clipTime: number): AudioNode {
        if (index >= bus.length) return this.destination;

        const stop = bus[index];
        const key = bus.slice(index).map(busStopKey).join(">");
        const existing = this.inputs.get(key);
        if (existing) return existing;

        const output = this.chainFrom(bus, index + 1, startTime, clipTime);

        // A pass-through head every clip connects to, so the bus has one input
        // whatever its effects turn out to be.
        const input = this.ctx.createGain();
        input.gain.value = 1;

        // The level is a gain after the effects, as a sound's own level is, so a
        // ramp on it is scheduled exactly as one in `effects` is.
        const level: AudioEffect = { type: "gain", value: stop.mute ? 0 : stop.volume };
        const span = stop.endAt - stop.startAt;
        const graph = buildAudioEffectGraph(
            this.ctx, input, [...(stop.effects ?? []), level], startTime, span, clipTime - stop.startAt,
        );
        let tail = graph.output;
        if (stop.transitionIn || stop.transitionOut) {
            const transition = this.ctx.createGain();
            applyTransitions(transition.gain, span, stop.transitionIn, stop.transitionOut, startTime, clipTime - stop.startAt);
            tail.connect(transition);
            this.nodes.push(transition);
            tail = transition;
        }
        tail.connect(output);

        this.nodes.push(input, ...graph.nodes);
        this.oscillators.push(...graph.oscillators);
        for (const osc of graph.oscillators) osc.start(startTime);

        this.inputs.set(key, input);
        return input;
    }
}
