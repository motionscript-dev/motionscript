import { busStopKey, type AudioBusStop, type AudioEffect } from "@motionscript/core";
import { applyTransitions, buildAudioEffectGraph } from "./effect-graph";

/**
 * The live chains for one audio context's buses.
 *
 * Held per context rather than per clip, because that is the whole difference
 * between a bus and per-clip processing: every clip naming a bus connects into
 * the *same* nodes, so a reverb on a bus is one tail the group shares rather
 * than one tail each. Flattening the levels into per-clip gain would sound
 * right; flattening the effects would not.
 */
export class AudioBusGraph {
    constructor(
        private readonly ctx: BaseAudioContext,
        /** Where the last bus in a chain connects — the master, or the destination. */
        private readonly destination: AudioNode,
    ) { }

    /**
     * The input node a clip on `bus` should connect to, building the chain the
     * first time it is asked for.
     *
     * `bus` is source-adjacent first, so `bus[0]` is the one the clip feeds and
     * each stop after it is that bus's own parent. An empty or absent chain
     * returns the destination, which is what every clip did before buses
     * existed.
     *
     * `startTime` is the context time a new chain's schedule starts from, and
     * `clipTime` the same instant in the stops' own seconds. A curve on a stop
     * runs over its `startAt`–`endAt`, so the two are what place it.
     */
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

    /**
     * Build (or reuse) the chain for `bus[index]`, connected to whatever
     * `bus[index + 1]` resolves to.
     *
     * Recursive rather than iterative because a bus's *output* has to exist
     * before its own nodes can connect to it, and the outermost bus is the last
     * entry.
     *
     * Reused by everything that changes what it sounds like, down to the master,
     * not by id alone: a bus edited under a playing device, or one id on two
     * tracks, is a different chain, and one built for the first would play the
     * second through stale levels and a curve anchored to the wrong span.
     */
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
