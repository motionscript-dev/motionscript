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
 * The third scene graph: things that make sound.
 *
 * Sibling to `Node2D` and `Node3D`, and thin for the same reason they are thick
 * — a node that makes sound has no box and no place in space, so it inherits the
 * tree, identity, props, commands, context and clock from {@link Node} and adds
 * only what every audible thing has: a level, a position in the stereo field, a
 * mute, an effect chain, and how it enters and leaves.
 *
 * Two concrete kinds, and no more: `SoundNode` is a leaf that plays a file, and
 * `AudioBus` is a group that everything beneath it feeds. That is the whole
 * vocabulary of a mixer, and it is deliberately the same shape as the visual
 * trees — a group node and a drawing node — because the thing being described is
 * the same: what exists, and what is under what.
 *
 * ### Levels are ramps, not tweens
 *
 * `volume` and `pan` are {@link Param}, so a fade is a ramp (`ramp(1, 0, 1)`)
 * or a `transitionOut` rather than a `to()`. That is not a
 * limitation being worked around, it is what the two mechanisms mean: a tween
 * writes a prop once per *frame*, while sound is scheduled once, ahead of
 * time, and then runs at 48 kHz. A per-frame write reaches the graph on the one
 * frame that built the request and never again — so a `to({ volume })` would
 * read as animated on the timeline and render flat. `_prepareStep` refuses it
 * instead.
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
        // Deferred to here rather than run by `super()`: a subclass's field
        // initializers only run once `super()` has returned, so applying props
        // any earlier would write into cells that do not exist yet.
        this.initProps(props);
        this.adoptChildrenProp(props);
    }

    /** This node's children in the audio tree. */
    get childrenAudio(): NodeAudio[] {
        return this._allChildren.filter((c): c is NodeAudio => c instanceof NodeAudio);
    }

    /**
     * This bus's identity in the platform's graph: one chain, which everything
     * under it feeds.
     *
     * The authored id, and the structural path for a bus built in code rather
     * than from a document row. Neither answer alone works, and being wrong is
     * silent either way — the string reaches `AssetManager.stableKey`, so one
     * that changes re-fetches and re-schedules every clip on the bus. A document
     * row's id is fixed for the document's life, while its child index moves as
     * `syncPresence` adds and removes siblings; a code-built bus has no authored
     * id, but its parent builds it in the same slot every time.
     *
     * @internal
     */
    get _busId(): string {
        const authored = this._props?.id;
        return `bus:${typeof authored === "string" ? authored : structuralPathOf(this)}`;
    }

    /**
     * Refuse a tween on a level, naming the curve that does work.
     *
     * Loud rather than silent because the failure is otherwise invisible: the
     * command runs its full duration, the timeline draws a bar, and the render
     * is at one flat level. See the class docblock for why the two mechanisms
     * cannot agree.
     */
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

/**
 * The buses a node feeds, **source-adjacent first**.
 *
 * Walks up the audio ancestors only: the walk stops at the first non-audio
 * parent, which is the `Canvas2D` scene root, because a scene root is not a bus
 * — it has no level of its own and nothing to mix.
 */
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

/**
 * The bus in `from`'s scene with node id `id`, or `null`.
 *
 * What lets something outside the audio tree feed a bus — a `Video`, whose audio
 * is welded to its picture and so cannot be parented under one. It names the bus
 * by the same id a `SoundNode` under that bus writes in its `parentId`, because
 * it is asking the same question: which bus. A `key` would be a second
 * vocabulary for it, and an optional one.
 */
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

/**
 * A node's child-index path from the root of its tree, joined with ".".
 *
 * The same identity `nodePath` gives the runtime, computed bottom-up because a
 * node declaring its audio knows its parents and not its index in a
 * walk. Stable across a rebuild for an unchanged tree, which is the property
 * both a bus id and a clip's request id need.
 */
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
