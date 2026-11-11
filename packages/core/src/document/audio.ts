import type { AudioDocument, ClipDocument, CommandSpec, CompositionDocument, NodeSpec, TimedNodeSpec, VisualDocument } from "./types";
import { isAudioDocument, isStillDocument, nodeSpan } from "./types";

/**
 * Namespaced like every other synthesized id in the document layer, so it can never collide with an authored
 * one.
 */
const AUDIO_ROOT_ID = "@bus";

function defaultRootBus(): NodeSpec {
    return { id: AUDIO_ROOT_ID, type: "audioBus", parentId: null, layerOrder: 0, props: {} };
}

function clipRoot(): NodeSpec {
    return { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} };
}

/**
 * An audio document, as the composition it already is: one evaluator runs sound, so a bus fade and a
 * rectangle's fade cannot drift. Only the root needs arranging. A clip's root is always a `Canvas2D`, so the
 * bus becomes its single audio child under {@link AUDIO_ROOT_ID} and every `targetId: null` / `parentId: null`
 * is rewritten to name it. The canvas draws nothing and lays out an empty box once, the whole cost of a clip
 * that is only sound.
 */
export function loweredAudioDocument(doc: AudioDocument): CompositionDocument {
    const nodes: TimedNodeSpec[] = [clipRoot()];
    if (!doc.nodes.some(isRootBus)) nodes.push(defaultRootBus());
    for (const spec of doc.nodes) nodes.push(reparent(spec));

    return {
        kind: "composition",
        duration: doc.duration,
        variables: doc.variables,
        nodes,
        commands: doc.commands.map(retarget),
    };
}

function isRootBus(spec: NodeSpec): boolean {
    return spec.id === "" && spec.type === "audioBus";
}

function reparent(spec: TimedNodeSpec): TimedNodeSpec {
    if (isRootBus(spec)) return { ...spec, id: AUDIO_ROOT_ID, parentId: null };
    /**
     * `null` is the document's convention for "the root"; `""` is the same row named by id, which `checkTree` also
     * resolves.
     */
    if (spec.parentId === null || spec.parentId === "") return { ...spec, parentId: AUDIO_ROOT_ID };
    return spec;
}

function retarget(command: CommandSpec): CommandSpec {
    if (command.targetId === null || command.targetId === "") {
        return { ...command, targetId: AUDIO_ROOT_ID };
    }
    return command;
}

export { AUDIO_ROOT_ID };

/**
 * A `sound` or `video` row with no `play` command of its own gets one: a sound over its span (open-ended, to
 * its own end), a video once per segment or over its span while it plays.
 */
export function withPlayedSounds(doc: CompositionDocument): CompositionDocument {
    const played = new Set(doc.commands.filter((c) => c.type === "play").map((c) => c.targetId));
    const added: CommandSpec[] = [];
    for (const spec of doc.nodes) {
        if ((spec.type !== "sound" && spec.type !== "video") || played.has(spec.id)) continue;
        const { start, end } = nodeSpan(spec);
        const segments = spec.type === "video" ? (spec.props as { segments?: unknown }).segments : undefined;
        if (Array.isArray(segments) && segments.length > 0) {
            (segments as { at: number; from: number; duration: number; speed?: number; volume?: number }[]).forEach((segment, i) => {
                added.push({
                    // An endless segment plays to the source's end: a command has no endless length.
                    id: `@play:${spec.id}:${i}`, type: "play", targetId: spec.id, at: start + segment.at,
                    duration: Number.isFinite(segment.duration) ? segment.duration : 0,
                    args: {
                        from: segment.from,
                        ...(segment.speed !== undefined && { speed: segment.speed }),
                        ...(segment.volume !== undefined && { volume: segment.volume }),
                    },
                });
            });
            continue;
        }
        added.push({
            id: `@play:${spec.id}`, type: "play", targetId: spec.id, at: start,
            duration: Number.isFinite(end) ? end - start : 0, args: {},
        });
    }
    return added.length === 0 ? doc : { ...doc, commands: [...doc.commands, ...added] };
}

export function clipDocument(doc: ClipDocument): VisualDocument {
    const lowered = isAudioDocument(doc) ? loweredAudioDocument(doc) : doc;
    return isStillDocument(lowered) ? lowered : withPlayedSounds(lowered);
}
