import {
    documentDuration,
    type ClipDocument,
    type CommandSpec,
    type CompositionDocument,
    type NodeSpec,
    type ProjectDocument,
    type StillDocument,
    type TimedNodeSpec,
    type Track,
} from "@motionscript/core";

/**
 * Documents written in a line. These suites prove the platform draws what it is
 * given; the document model itself is verified in core's own tests.
 */

/** One node row. A `null` parent is the scene root; `id: ""` with `"canvas2d"` is the root itself. */
export function node(
    id: string,
    type: string,
    props: Record<string, unknown> = {},
    parentId: string | null = null,
    layerOrder = 0,
): NodeSpec {
    return { id, type, parentId, layerOrder, props: asData(props) };
}

export function still(...nodes: NodeSpec[]): StillDocument {
    return { kind: "still", nodes };
}

/** One command in a {@link comp} chain. `type` defaults to `"to"`; `target: null` is the root. */
export interface CommandStep {
    target: string | null;
    type?: string;
    args: Record<string, unknown>;
    duration?: number;
}

/** A command after the previous one ends, a number of seconds to hold, or commands that start together. */
export type Step = CommandStep | number | readonly CommandStep[];

/**
 * A composition: `nodes` present from 0 unless they carry a span, then `steps`
 * placed the way a chain places them. Its `duration` is the chain's total, so a
 * trailing hold counts; pass one to override.
 */
export function comp(nodes: TimedNodeSpec[], steps: readonly Step[] = [], duration?: number): CompositionDocument {
    const commands: CommandSpec[] = [];
    let at = 0;
    for (const step of steps) {
        if (typeof step === "number") {
            at += step;
            continue;
        }
        let longest = 0;
        for (const s of (Array.isArray(step) ? step : [step]) as CommandStep[]) {
            const length = s.duration ?? 0;
            commands.push({
                id: `c${commands.length}`,
                type: s.type ?? "to",
                targetId: s.target,
                at,
                duration: length,
                args: asData(s.args),
            });
            longest = Math.max(longest, length);
        }
        at += longest;
    }
    const total = duration ?? at;
    return { kind: "composition", nodes, commands, ...(total > 0 && { duration: total }) };
}

/** A track playing `clip` for its own length unless `over` says otherwise. */
export function track(id: string, clip: ClipDocument, over: Partial<Track> = {}): Track {
    return { id, clip, duration: documentDuration(clip), ...over };
}

export function project(tracks: Track[], over: Partial<ProjectDocument> = {}): ProjectDocument {
    return { kind: "project", name: "Test", tracks, ...over };
}

/** What a stored document would hold — a `Fills` chain becomes its raw array, as it would on disk. */
function asData(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value));
}
