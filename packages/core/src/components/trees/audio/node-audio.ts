import { declareMembers, property } from "@/attributes/properties/decorator";
import { audioEffectsProperty, audioParamProperty } from "@/attributes/properties/typed";
import { type AudioEffectsInput } from "@/attributes/audio/effects/chain";
import type { AudioEffect } from "@/attributes/audio/effects/union";
import type { Param } from "@/attributes/audio/ramp";
import type { AudioTransition } from "@/attributes/audio/transition";
import type { AudioBusStop } from "@/attributes/audio/request";
import type { NodeSpan } from "@/document/types";
import { Node, type NodeConfig, type NodeDimension, type NodeProps } from "@/components/trees/node/node";
import type { EasingFunction } from "@/tween/ease/type";
import type { TweenStepper } from "@/tween/stepper";

export interface NodeAudioProps extends NodeProps {
    /** Linear gain. 1 leaves the signal alone, 0 silences it. */
    volume: Param;
    /** Stereo position: -1 hard left, 0 centre, +1 hard right. */
    pan: Param;
    /** Silence this node and, on a bus, everything under it. */
    mute: boolean;
    /** Effects applied in array order, index 0 closest to the source. */
    effects: AudioEffectsInput;
    /** A fade over its first `duration` seconds, on top of `volume`. */
    transitionIn: AudioTransition | undefined;
    /** A fade over its last `duration` seconds, on top of `volume`. */
    transitionOut: AudioTransition | undefined;
}

/**
 * The third scene graph: things that make sound. Sibling to `Node2D`/`Node3D` and thin because a sounding node has
 * no box and no place in space; it inherits tree, identity, props, commands, context and clock from {@link Node} and
 * adds a level, stereo position, mute, effect chain and how it enters and leaves. Two kinds: `SoundNode` (a leaf that
 * plays a file) and `AudioBus` (a group everything beneath it feeds).
 *
 * Levels are ramps, not tweens: `volume` and `pan` are {@link Param}, so a fade is a ramp (`ramp(1, 0, 1)`) or a
 * `transitionOut`. A tween writes a prop once per frame, while sound is scheduled once ahead of time and runs at
 * 48 kHz, so a per-frame write would reach the graph on one frame only and `to({ volume })` would read as animated on
 * the timeline yet render flat. `_prepareStep` refuses it.
 */
export class NodeAudio<P extends NodeAudioProps = NodeAudioProps> extends Node<P> {
    get dimension(): NodeDimension { return "audio"; }

    declare volume: Param;
    declare pan: Param;
    declare mute: boolean;
    declare effects: AudioEffectsInput;
    declare transitionIn: AudioTransition | undefined;
    declare transitionOut: AudioTransition | undefined;

    constructor(props?: NodeConfig<any, P>) {
        super(props);
        // Deferred from `super()`: field initializers run after it, so applying props earlier would write into cells that don't exist yet.
        this.initProps(props);
        this.adoptChildrenProp(props);
    }

    /** This node's children in the audio tree. */
    get childrenAudio(): NodeAudio[] {
        return this._allChildren.filter((c): c is NodeAudio => c instanceof NodeAudio);
    }

    /**
     * This bus's identity in the platform's graph: one chain everything under it feeds. The authored id, else the
     * structural path for a code-built bus. Neither alone works, and being wrong is silent (the string reaches
     * `AssetManager.stableKey`, so a changing one re-fetches and re-schedules every clip on the bus): a document row's id
     * is fixed while its child index moves as `syncPresence` adds and removes siblings, whereas a code-built bus has no
     * authored id but its parent builds it in the same slot every time.
     *
     * @internal
     */
    get _busId(): string {
        const authored = this._props?.id;
        return `bus:${typeof authored === "string" ? authored : structuralPathOf(this)}`;
    }

    /** Refuses a tween on a level, naming the curve that works. Loud because the failure is otherwise invisible: the command runs its duration and the timeline draws a bar, yet the render is flat (see the class docblock). */
    override _prepareStep(to: Partial<P>, duration: number, easing?: EasingFunction): TweenStepper {
        for (const key of TWEEN_REFUSED) {
            if (!(key in to)) continue;
            throw new TypeError(
                `${this.className}: "${key}" cannot be tweened — an audio param is scheduled once, ` +
                `not written per frame, so a tween on it would render flat. Automate it with a ` +
                `ramp instead: ${key}: ramp(1, 0, 1), or transitionOut: { duration: 1 }.`,
            );
        }
        return super._prepareStep(to, duration, easing);
    }
}

declareMembers(NodeAudio, {
    volume: audioParamProperty({ default: 1 }),
    pan: audioParamProperty({ default: 0 }),
    mute: property({ default: false }),
    effects: audioEffectsProperty(),
    transitionIn: property({ default: undefined }),
    transitionOut: property({ default: undefined }),
});

const TWEEN_REFUSED = ["volume", "pan", "speed"] as const;

/** The buses a node feeds, **source-adjacent first**. Walks audio ancestors only, stopping at the first non-audio parent (the `Canvas2D` root), which is not a bus. */
export function busPathOf(node: NodeAudio, spanOf: SpanOf): AudioBusStop[] | undefined {
    const stops: AudioBusStop[] = [];
    let parent = node.parent;
    while (parent instanceof NodeAudio) {
        stops.push(stopOf(parent, spanOf));
        parent = parent.parent;
    }
    return stops.length > 0 ? stops : undefined;
}

/** {@link busPathOf}, with `bus` itself as the first stop. */
export function busPathTo(bus: NodeAudio, spanOf: SpanOf): AudioBusStop[] {
    return [stopOf(bus, spanOf), ...(busPathOf(bus, spanOf) ?? [])];
}

/** When a node is in the tree, in clip seconds: the span a bus stop carries. */
export type SpanOf = (node: Node) => Readonly<NodeSpan>;

/** The bus in `from`'s scene with node id `id`, or `null`. Lets something outside the audio tree (a `Video`, whose audio is welded to its picture) feed a bus by the same id a `SoundNode` under it writes in `parentId`, rather than a second vocabulary. */
export function findBusById(from: Node, id: string): NodeAudio | null {
    let root: Node = from;
    while (root.parent) root = root.parent;
    return searchBus(root, id);
}

function searchBus(node: Node, id: string): NodeAudio | null {
    if (node instanceof NodeAudio && node.id === id) return node;
    for (const child of node._allChildren) {
        const found = searchBus(child, id);
        if (found) return found;
    }
    return null;
}

/** One bus, flattened to the plain data a platform builds its chain from. */
function stopOf(bus: NodeAudio, spanOf: SpanOf): AudioBusStop {
    const effects = bus.effects as unknown as AudioEffect[];
    const span = spanOf(bus);
    return {
        id: bus._busId,
        volume: bus.volume,
        pan: bus.pan,
        mute: bus.mute,
        ...(effects.length > 0 ? { effects } : {}),
        ...(bus.transitionIn ? { transitionIn: bus.transitionIn } : {}),
        ...(bus.transitionOut ? { transitionOut: bus.transitionOut } : {}),
        startAt: span.start,
        endAt: span.end,
    };
}

/** A node's child-index path from its tree root, joined with ".": the identity `nodePath` gives the runtime, computed bottom-up since a node declaring audio knows its parents, not its walk index. Stable across a rebuild of an unchanged tree, which both bus ids and clip request ids need. */
export function structuralPathOf(node: Node): string {
    const parts: string[] = [];
    let current: Node | null = node;
    while (current) {
        const parent: Node | null = current.parent;
        if (!parent) break;
        parts.push(String(parent._allChildren.indexOf(current)));
        current = parent;
    }
    return parts.reverse().join(".");
}
