import type { EaseSpec } from "@/tween/ease/spec";
import { loopPasses, type LoopSpec } from "@/tween/loop";
import type { Theme } from "@/project/config";

/**
 * A loop is stored on a {@link CommandSpec} like an {@link EaseSpec}, but its arithmetic lives with the tweens
 * (`tween/loop.ts`).
 */
export type { LoopDirection, LoopSpec } from "@/tween/loop";

/**
 * The clip document, as data: JSON-serializable by construction (no functions, no class instances), so it
 * round-trips through a file or a database column. Nodes are code (a class registered under a string key,
 * `document/registry.ts`, where anything JSON cannot express belongs); documents are data.
 */

/**
 * One node as a flat row, not a nested tree: a command addresses its target by `id`, and "move this under
 * that" stays a single-field edit (`parentId` is a self-referencing foreign key). The scene root is the one
 * row with `id: ""`, `type: "canvas2d"` and `parentId: null`.
 */
export interface NodeSpec {
    id: string;
    /**
     * Registry key of the node's class. A key the registry lacks builds as an inert placeholder keeping the row's
     * id, props and children, reported in `buildErrors` (`missing-node.ts`), so one missing component costs one
     * node, not the clip.
     */
    type: string;
    /**
     * The handle an **expression** names this node by: `"=[card.x]"` reads the `x` of the node keyed `card`.
     *
     * Optional and never generated, unlike {@link id}: a node has one because an author wrote one. Unique per
     * document, or `[card.x]` would mean whichever row was read last. A `parentId` or `targetId` is always an
     * {@link id}, never a key. Not a display label.
     */
    key?: string;
    parentId: string | null;
    /** Load-bearing: a `row`/`column` parent lays its children out in exactly this order. */
    layerOrder: number;
    /**
     * **Sparse**: only what differs from the type's declared defaults, which keeps a document diff small and lets
     * a change to a default reach existing documents.
     */
    props: Record<string, unknown>;
}

/**
 * A {@link NodeSpec} placed on a clip's clock. The span is a field of the node, not a pair of commands, so a
 * node is the same row in a still or a composition. Not `start`/`end`: a painted node owns those as path-trim
 * props.
 */
export interface TimedNodeSpec extends NodeSpec {
    /** Absent is `0`. */
    startAt?: number;
    /** Absent is never: it stays to the clip's end. */
    endAt?: number;
}

/**
 * A named value in neither the tree nor the command list, so a change happens in one place: twelve nodes
 * fading together are one `variableTo` and twelve props bound to `"=[fade]"`.
 *
 * A variable has no presence span: it holds its declared {@link value} from t=0 until a command changes it,
 * since an expression naming one that "does not exist yet" would be a broken document. Only an expression
 * reads a variable, and only in a prop, so variables cannot cycle; a prop reading another node's prop
 * (`[key.x]`) can, and `validate.ts` refuses it.
 */
export interface VariableSpec {
    /** Commands target it and `[id]` in an expression names it: one key, so nothing to keep in sync. */
    id: string;
    name?: string;
    /**
     * Any JSON value; a lone `"=[x]"` hands it through untouched. It is also the type every command that writes it
     * is expected to produce.
     */
    value: unknown;
    /**
     * Registry key (`"number"`, `"vector2"`, `"vector3"`, `"color"`, `"step"`, or one from `Registry.addLerp`); a
     * command may override it per tween. Absent is `"number"` for a numeric {@link value}, else `"step"`: snap at
     * the end rather than interpolate garbage.
     */
    lerp?: string;
}

export type { EaseSpec } from "@/tween/ease/spec";

/**
 * One command placed on the timeline. Sequence is `b.at === a.at + a.duration`, parallel is two commands
 * sharing an `at`, wait is a gap. Because every span is declared rather than discovered, the scene's duration,
 * asset windows and node lifespans are readable straight off the document (`runtime/analysis.ts`).
 */
export interface CommandSpec {
    id: string;
    /**
     * Registry key: `"to"`, `"set"`, `"variableTo"`, or any `command()` method a node class exposes. A command
     * changes what a node holds, never whether it exists; that is its {@link TimedNodeSpec} span.
     */
    type: string;
    /**
     * The node this command acts on, or `null` for the scene root (the `Canvas2D` with `id: ""`: layout frame,
     * background paint and camera).
     *
     * A variable command (`"variableTo"`, `"variableSet"`) names a {@link VariableSpec} here; the command type
     * says which table. Ids are unique across nodes and variables so a host grouping rows by `targetId` cannot
     * conflate the two.
     */
    targetId: string | null;
    /**
     * Seconds, not frames, so the same scene at 30 and 60 fps is the same animation. Frames are derived (`at *
     * fps`).
     */
    at: number;
    /**
     * Seconds one pass takes. Absent or `0` is a stamp: it applies at once. One pass, not the whole span, so
     * {@link loop}ing repeats the motion rather than squeezing it into the same time. The span is {@link
     * commandSpan}.
     */
    duration?: number;
    easing?: EaseSpec;
    /**
     * A placement field, not part of {@link args}: the runtime wraps the built command, so every command type
     * loops by the same code. Absent runs it once.
     */
    loop?: LoopSpec;
    /**
     * Shape is per command type: `"to"`/`"set"`'s is the props diff, `"variableTo"`'s carries the `value`, a named
     * command carries its leading arguments by parameter name.
     */
    args: Record<string, unknown>;
}

/**
 * A **still**: a node tree and nothing else, one frame. Its own type because a still is edited and validated
 * differently: one carrying a duration or a half-applied tween should not be representable. The scene root is
 * the row in {@link nodes} with `id: ""` and `type: "canvas2d"`; omitting it gets the default root.
 */
export interface StillDocument {
    kind: "still";
    /** Absent is format 0 (written before the field existed); see `migrate.ts`. */
    formatVersion?: number;
    /** Order is irrelevant: `parentId`/`layerOrder` carry the structure. */
    nodes: NodeSpec[];
    variables?: VariableSpec[];
    /**
     * Colour tokens and typography presets this clip resolves against. On the clip, not only the project, because
     * a theme is part of what a clip looks like; a project's own `theme` is the default for clips that declare
     * none.
     */
    theme?: Theme;
}

/**
 * A **composition**: a still's node tree placed in time, plus the commands that animate it. The nodes are the
 * same rows a still holds, each with its own span. The root is the row with `id: ""` and `type: "canvas2d"`,
 * as on a still; a command targeting `null` animates it.
 */
export interface CompositionDocument {
    kind: "composition";
    /** Absent is format 0 (written before the field existed); see `migrate.ts`. */
    formatVersion?: number;
    /** Order is irrelevant: `parentId`/`layerOrder` carry the structure. */
    nodes: TimedNodeSpec[];
    variables?: VariableSpec[];
    /** Order is irrelevant; `at` is the placement. */
    commands: CommandSpec[];
    /** Colour tokens and typography presets this clip resolves against; see {@link StillDocument.theme}. */
    theme?: Theme;

    /**
     * Total seconds. Defaults to the last moment anything happens (a command's end, or a node's start or finite
     * end); set it to hold the final frame or cut a scene short.
     */
    duration?: number;
}

/**
 * An **audio document**: a bus tree placed in time, with the commands that move it. Reads like {@link
 * CompositionDocument}. The root is implicit: `targetId: null` and `parentId: null` name the row with `id: ""`
 * and `type: "audioBus"`. There is no still case, since sound with no timeline is silence.
 */
export interface AudioDocument {
    kind: "audio";
    /** Absent is format 0 (written before the field existed); see `migrate.ts`. */
    formatVersion?: number;
    nodes: TimedNodeSpec[];
    variables?: VariableSpec[];
    /** Order is irrelevant; `at` is the placement. */
    commands: CommandSpec[];
    /** Same rule as {@link CompositionDocument}. */
    duration?: number;
}

export type VisualDocument = StillDocument | CompositionDocument;

/**
 * One union rather than two lists, because a track is a placement and does not care which. A composition's
 * `canvas2d` root already takes audio children, so an {@link AudioDocument} is the clip for when there is no
 * picture to go with the sound.
 */
export type ClipDocument = VisualDocument | AudioDocument;

export function isStillDocument(doc: VisualDocument): doc is StillDocument {
    return doc.kind === "still";
}

export function isCompositionDocument(doc: VisualDocument): doc is CompositionDocument {
    return doc.kind === "composition";
}

export function isAudioDocument(doc: ClipDocument): doc is AudioDocument {
    return doc.kind === "audio";
}

export function hasTimeline(doc: ClipDocument): doc is CompositionDocument | AudioDocument {
    return doc.kind !== "still";
}

/**
 * A real id rather than a missing one. A host storing its root under another id maps it here at the boundary
 * where its rows become a document.
 */
export const ROOT_NODE_ID = "";

export interface NodeSpan {
    start: number;
    end: number;
}

export function nodeSpan(spec: NodeSpec | TimedNodeSpec): NodeSpan {
    const timed = spec as TimedNodeSpec;
    return { start: timed.startAt ?? 0, end: timed.endAt ?? Infinity };
}

/**
 * A node's own span intersected with every ancestor's: a child cannot outlive its parent. Empty (`start >=
 * end`) when the spans never overlap; `undefined` for an id no row declares.
 */
export function effectiveSpan(nodes: readonly (NodeSpec | TimedNodeSpec)[], id: string): NodeSpan | undefined {
    return effectiveSpanIn(new Map(nodes.map((n) => [n.id, n])), id);
}

/** {@link effectiveSpan} for every row at once, each ancestor chain walked once. */
export function effectiveSpans(nodes: readonly (NodeSpec | TimedNodeSpec)[]): Map<string, NodeSpan> {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const spans = new Map<string, NodeSpan>();
    const chain: (NodeSpec | TimedNodeSpec)[] = [];
    const inChain = new Set<string>();
    for (const start of byId.values()) {
        if (spans.has(start.id)) continue;
        chain.length = 0;
        inChain.clear();
        let above: NodeSpan | undefined;
        let spec: NodeSpec | TimedNodeSpec | undefined = start;
        while (spec) {
            const known = spans.get(spec.id);
            if (known) {
                above = known;
                break;
            }
            if (inChain.has(spec.id)) {
                /**
                 * A parent cycle has no top to fold down from; an invalid document gets the single-id answer for each member.
                 */
                for (const member of chain) spans.set(member.id, effectiveSpanIn(byId, member.id)!);
                chain.length = 0;
                break;
            }
            chain.push(spec);
            inChain.add(spec.id);
            spec = spec.parentId === null ? undefined : byId.get(spec.parentId);
        }
        for (let i = chain.length - 1; i >= 0; i--) {
            const span = nodeSpan(chain[i]);
            if (above) {
                span.start = Math.max(span.start, above.start);
                span.end = Math.min(span.end, above.end);
            }
            spans.set(chain[i].id, span);
            above = span;
        }
    }
    return spans;
}

/** @internal {@link effectiveSpan} over an id map a caller already holds. */
export function effectiveSpanIn(
    byId: ReadonlyMap<string, NodeSpec | TimedNodeSpec>,
    id: string,
): NodeSpan | undefined {
    let spec = byId.get(id);
    if (!spec) return undefined;
    const span = nodeSpan(spec);
    const seen = new Set<string>();
    while (spec.parentId !== null && !seen.has(spec.id)) {
        seen.add(spec.id);
        const parent = byId.get(spec.parentId);
        if (!parent) break;
        const own = nodeSpan(parent);
        span.start = Math.max(span.start, own.start);
        span.end = Math.min(span.end, own.end);
        spec = parent;
    }
    return span;
}

/** What a timed node becomes when it lands in a still. */
export function untimed(spec: NodeSpec | TimedNodeSpec): NodeSpec {
    const { startAt: _startAt, endAt: _endAt, ...rest } = spec as TimedNodeSpec;
    return rest;
}

/**
 * One pass, or every pass of a counted loop. An unlimited loop counts as **one**: it runs for as long as there
 * is clip, and letting it answer here would make a command ask for a scene that can never end.
 */
export function commandSpan(command: CommandSpec): number {
    const duration = command.duration ?? 0;
    if (duration <= 0 || !command.loop || command.loop.count === null) return duration;
    return duration * loopPasses(command.loop);
}

/**
 * Its declared `duration`, else the last moment anything happens (a command's end, a node's arrival or finite
 * departure). A still has none.
 */
export function documentDuration(doc: ClipDocument): number {
    if (!hasTimeline(doc)) return 0;
    if (doc.duration !== undefined) return doc.duration;
    let end = 0;
    for (const command of doc.commands) {
        end = Math.max(end, command.at + commandSpan(command));
    }
    for (const node of doc.nodes) {
        if (node.startAt !== undefined) end = Math.max(end, node.startAt);
        if (node.endAt !== undefined && Number.isFinite(node.endAt)) end = Math.max(end, node.endAt);
    }
    return end;
}
