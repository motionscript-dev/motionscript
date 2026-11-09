import { NodeAudio } from "@/components/trees/audio/node-audio";
import type { Allowed, BoxAudioState, BuiltNode, ChildView, Component, Element, Merge, SpecAudio, StateSpec, TreeCallProps } from "@/components/factory/api";
import { componentBase, finishComponent, lowering, type CoreSpec } from "@/components/factory/factory";
import { childView } from "@/components/factory/views";

/**
 * An audio component: a sound, or a bus mixing the sounds in it. Lowers onto a
 * generated `NodeAudio` subclass. It has no audio field: what it plays comes
 * from its commands' `timeline.sound`.
 */
export function componentAudio<
    const K extends string,
    const S extends StateSpec = {},
    const C = {},
    const A extends Allowed = null,
    const B extends Element = never,
>(spec: SpecAudio<K, Merge<BoxAudioState, S>, S, C, A, B>): Component<K, Merge<BoxAudioState, S>, C, A, NodeAudio, TreeCallProps<Merge<BoxAudioState, S>, BuiltNode<Merge<BoxAudioState, S>, C, NodeAudio>>> {
    const l = lowering(spec as unknown as CoreSpec, NodeAudio);

    class Generated extends componentBase(NodeAudio, l) {
        override _commandChildren(): readonly ChildView[] {
            return this.childrenAudio.map(childView);
        }
    }

    return finishComponent(Generated, l) as never;
}
