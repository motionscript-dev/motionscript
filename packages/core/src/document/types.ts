import type { EaseSpec } from "@/tween/ease/spec";
import { loopPasses, type LoopSpec } from "@/tween/loop";
import type { Theme } from "@/project/config";

/**
 * Re-exported as part of the document vocabulary: a loop is stored on a
 * {@link CommandSpec} the way an {@link EaseSpec} is, but its arithmetic is a
 * tween concern and lives with the tweens (`tween/loop.ts`).
 */
export type { LoopDirection, LoopSpec } from "@/tween/loop";

/**
 * The clip document: what a clip **is**, as data.
 *
 * A visual clip used to be a generator function, so the only way to know what frame N
 * looked like was to run frames 0..N-1. That made a whole class of host
 * impossible — a document cannot be stored, diffed, synced or evaluated out of
 * order when its meaning is "whatever running this code does". These types are
 * the replacement: a clip is rows, and a frame is a pure function of them.
 *
 * The split between what is data and what is code is deliberate and total:
 *
 * - **Nodes are code.** A node type is a class registered under a string key
 *   (see `document/registry.ts`). That is the extension point — a custom node
 *   with its own `property` declarations, its own `renderSelf`, its own
 *   `command` methods — and it is where anything a JSON value cannot express
 *   (a computed lookup table, a generated point cloud) belongs.
 * - **Documents are data.** Which nodes exist, what props they carry, and what
 *   happens to them over time are plain JSON.
 *
 * Everything here is JSON-serializable by construction: no functions, no class
 * instances. A document round-trips through a file or a database column without
 * a mapping layer.
 */

/**
 * One node, as a row.
 *
 * Flat rather than nested, for two reasons that both bite immediately
 * otherwise: a command addresses its target by `id`, and a nested tree makes
 * "move this node under that one" a structural rewrite rather than a
 * single-field edit. It is also the shape a relational store already wants —
 * `parentId` is a self-referencing foreign key.
 *
 * The scene root is not special-cased here: it is the one row with
 * `id: ""`, `type: "canvas2d"` and `parentId: null` — see
 * {@link CommandSpec.targetId}.
 */
export interface NodeSpec {
    /** Stable identity. Command targets resolve to it; it survives reordering. */
    id: string;
    /**
     * Registry key of the node's class — `"rect"`, `"text"`, `"canvas3d"`, or
     * whatever a custom node registered itself as. A key the registry lacks
     * builds as an inert placeholder that keeps the row's id, props and
     * children and is reported in `buildErrors` (`missing-node.ts`), so one
     * missing component costs one node rather than the clip; `validateDocument`
     * with a registry reports it up front.
     */
    type: string;
    /**
     * The handle an **expression** names this node by: `"=[card.x]"` reads the
     * `x` of the node keyed `card`. See {@link CompositionDocument} and
     * `document/expression/`.
     *
     * Optional and **never generated**, unlike {@link id} — a node has one
     * because an author wrote one, which is what makes it safe to point a
     * formula at. Unique per document all the same: a second `card` would make
     * `[card.x]` mean whichever row was read last. It is a *reference*, not an
     * address — a `parentId` or a `targetId` is always an {@link id}, so there is
     * exactly one way to say which node and one way to say which handle.
     *
     * Not a display label. A host that wants one keeps it, since nothing here
     * reads it.
     */
    key?: string;
    /** Parent node id, or `null` for a direct child of the scene root. */
    parentId: string | null;
    /**
     * Position among siblings. Load-bearing rather than cosmetic: a `row`/
     * `column` parent lays its children out in exactly this order.
     */
    layerOrder: number;
    /**
     * Authored props, **sparse** — only what differs from the type's declared
     * defaults. A freshly created node is `{}`, which is what keeps a document
     * diff small and lets a change to a default actually reach existing
     * documents.
     */
    props: Record<string, unknown>;
}

/**
 * A {@link NodeSpec} placed on a clip's clock: present from {@link startAt} until
 * {@link endAt}.
 *
 * The span is a field of the node rather than a pair of commands, so a node is
 * the same row whether a still or a composition holds it — moving a subtree
 * between the two is dropping or adding these two fields, never rewriting rows.
 * Not `start`/`end`: a painted node already owns those as path-trim props.
 */
export interface TimedNodeSpec extends NodeSpec {
    /** Seconds from the clip's start at which the node enters the tree. Absent is `0`. */
    startAt?: number;
    /** Seconds at which it leaves. Absent is never — it stays to the clip's end. */
    endAt?: number;
}

/**
 * A **variable**: a value with a name, in neither the tree nor the command list.
 *
 * The thing that exists purely so a change can happen in *one* place. Twelve
 * nodes fading together used to be twelve `to` commands whose `at` and
 * `duration` had to be kept equal by hand; with a variable it is one
 * `variableTo` and twelve props bound to `"=[fade]"`.
 *
 * Every document kind declares them the same way, in `variables`. On a still
 * nothing can change one, so it is a fixed value; on a composition a
 * `variableTo`/`variableSet` command may drive it. A variable has no presence
 * span: an expression naming one that "does not exist yet" is a broken document,
 * so a variable holds its declared {@link value} from t=0 until a command
 * changes it.
 *
 * Nothing reads a variable except an expression (`document/expression/`), and an
 * expression can only appear in a prop — so a variable cannot read another
 * variable, and no chain of them can cycle. A prop reading another node's prop
 * (`[key.x]`) is the case that can, and `validate.ts` refuses it.
 */
export interface VariableSpec {
    /**
     * Stable identity. Commands target it, and `[id]` in an expression names
     * it — one key, not two, so there is nothing to keep in sync.
     */
    id: string;
    /** A display label for a host's UI. Expressions never see it. */
    name?: string;
    /**
     * What it holds before anything changes it, and the value type every
     * command that writes it is expected to produce.
     *
     * Any JSON value. A number is the common case, but a colour string, a
     * `Vector2` or a whole fill object all work — a lone `"=[x]"` hands the
     * value through untouched, so a variable is as expressive as the prop it
     * drives.
     */
    value: unknown;
    /**
     * How it interpolates, by registry key — `"number"`, `"vector2"`,
     * `"vector3"`, `"color"`, `"step"`, or anything `Registry.addLerp`
     * added. A command may override it per tween.
     *
     * Absent means `"number"` for a numeric {@link value} and `"step"` for
     * anything else: snap at the end rather than interpolate garbage.
     */
    lerp?: string;
}

/** How a command eases, as data — resolved to an `EasingFunction` once, at compile time. */
export type { EaseSpec } from "@/tween/ease/spec";

/**
 * One command, **placed on the timeline**.
 *
 * The placement is the whole idea. A generator expressed sequencing by
 * suspending — running `a` to completion before `b` began — which is why order
 * of evaluation was order of execution, and why seeking backwards meant
 * starting over. A command
 * carries its own `at`, so:
 *
 * - **sequence** is `b.at === a.at + a.duration`,
 * - **parallel** is two commands sharing an `at`,
 * - **wait** is a gap between them.
 *
 * There are no `sequence`/`parallel`/`wait` primitives any more because there
 * is nothing left for them to do. And because every command's span is declared
 * rather than discovered, the scene's duration, its asset windows and each
 * node's lifespan are all readable straight off the document — see
 * `runtime/analysis.ts`.
 */
export interface CommandSpec {
    /** Stable identity, so a host can address and reorder one command. */
    id: string;
    /**
     * Registry key of the command — `"to"`, `"set"`, `"variableTo"`, or any
     * `command()` method a node class exposes (`"moveTo"`, `"fillTo"`,
     * `"countTo"`, …). See `document/registry.ts`. A command changes what a
     * node holds, never whether it exists — that is its {@link TimedNodeSpec} span.
     */
    type: string;
    /**
     * The node this command acts on, or `null` for the scene root — the
     * `Canvas2D` that is simultaneously the scene's layout frame, its
     * background paint and its camera (the node with `id: ""`,
     * `type: "canvas2d"`).
     *
     * A **variable** command (`"variableTo"`, `"variableSet"`) names a
     * {@link VariableSpec} here instead. The command type says which table the
     * id is looked up in, so there is no prefix to write; ids are required to be
     * unique across nodes and variables so a host grouping its timeline rows by
     * `targetId` cannot conflate the two.
     */
    targetId: string | null;
    /**
     * Seconds from the scene's start at which the command begins.
     *
     * Seconds rather than a frame index because a document has to survive an
     * fps change: the same scene rendered at 30 and at 60 must be the same
     * animation, not the same integers. Frames are derived (`at * fps`).
     */
    at: number;
    /**
     * Seconds **one pass** takes. Absent or `0` is a stamp — it applies at once.
     *
     * One pass rather than the whole span, so that {@link loop}ing a command
     * repeats it instead of squeezing the same motion into the same time: a
     * two-second spin repeated three times runs for six seconds and each turn
     * still takes two. The span is {@link commandSpan}.
     */
    duration?: number;
    /** How it eases, per pass. Absent means the command's own default. */
    easing?: EaseSpec;
    /**
     * How it repeats. Absent runs it once.
     *
     * A placement field beside {@link at} and {@link duration} rather than
     * something inside {@link args}, because repeating is not any one command's
     * business: the runtime wraps the *built* command, so `to`, `fillTo`,
     * `countTo` and a node's own `command()` all loop by the same code and a
     * newly written command type gets it for free.
     */
    loop?: LoopSpec;
    /**
     * The command's arguments. Shape is per command type: `"to"`/`"set"`'s *is*
     * the props diff, `"variableTo"`'s carries the `value`, a named command
     * carries its leading arguments by parameter name. Never wrapped in an extra
     * key for a command with exactly one argument.
     */
    args: Record<string, unknown>;
}

/**
 * A **still**: a node tree and nothing else.
 *
 * One frame, no timeline, no commands. It is its own document type rather than
 * "an animation nobody ran" because the two are edited by different tools and
 * validated by different rules — a still carrying a duration, or a half-applied
 * tween, is a document that should never have been representable.
 *
 * The scene root — `fill`, `overlay`, `flow`, `align`, `padding`, the camera
 * (`zoom`, `origin`, `heading`) — is not a separate field: it is the row in
 * {@link nodes} with `id: ""` and `type: "canvas2d"`. Omitting it gets the
 * default root.
 */
export interface StillDocument {
    kind: "still";
    /** The format it was written in — see `migrate.ts`. Absent is format 0, every document written before the field existed. */
    formatVersion?: number;
    /** Every node in the scene, including the root. Order here is irrelevant — `parentId`/`layerOrder` carry the structure. */
    nodes: NodeSpec[];
    /** Values props bind to with an expression. Fixed here — nothing on a still changes one. */
    variables?: VariableSpec[];
    /**
     * Colour tokens and typography presets this clip resolves against.
     *
     * On the clip, not only on the project, because a theme is part of what a
     * clip *looks like* — a lower third in a brand's palette is that document,
     * not that document plus a setting a host remembered to pass alongside it.
     * A project's own `theme` is the default for clips that declare none.
     */
    theme?: Theme;
}

/**
 * A **composition**: a still's node tree, placed in time, and the commands that
 * animate it.
 *
 * The nodes are the same rows a still holds, each with its own span, so when a
 * node appears is one editable field rather than an implicit consequence of
 * where a `stage.add(...)` sat in a function body — and a subtree lifted out of
 * a still drops in here unchanged.
 *
 * The scene root is the row in {@link nodes} with `id: ""` and
 * `type: "canvas2d"`, as on a still. Omitting it gets the default root; a
 * command targeting `null` animates it like any other node.
 */
export interface CompositionDocument {
    kind: "composition";
    /** The format it was written in — see `migrate.ts`. Absent is format 0, every document written before the field existed. */
    formatVersion?: number;
    /** Every node, the root included. Order is irrelevant — `parentId`/`layerOrder` carry the structure. */
    nodes: TimedNodeSpec[];
    /** Values props bind to with an expression, and that `variableTo`/`variableSet` may drive. */
    variables?: VariableSpec[];
    /** Every command. Order in the array is irrelevant; `at` is the placement. */
    commands: CommandSpec[];
    /**
     * Colour tokens and typography presets this clip resolves against.
     *
     * On the clip, not only on the project, because a theme is part of what a
     * clip *looks like* — a lower third in a brand's palette is that document,
     * not that document plus a setting a host remembered to pass alongside it.
     * A project's own `theme` is the default for clips that declare none.
     */
    theme?: Theme;

    /**
     * Total length in seconds. Defaults to the last moment anything happens — a
     * command's end, or a node's start or finite end — which is what you want
     * almost always; set it to hold on the final frame, or to cut a scene short.
     */
    duration?: number;
}

/**
 * An **audio document**: a bus tree placed in time, and the commands that move
 * it.
 *
 * The audio counterpart to {@link CompositionDocument}, and it reads the same
 * way for the same reason — when a sound starts is its node's `startAt`, not a
 * consequence of running something.
 *
 * The root is implicit, on the same convention a composition uses for its
 * `canvas2d`: `targetId: null` on a command, and `parentId: null` on a node,
 * name *this document's own root bus* — the row with `id: ""` and
 * `type: "audioBus"`. Omitting it gets the default one.
 *
 * There is deliberately no "still" case for audio: unlike a picture, sound with
 * no timeline is silence, so the degenerate case is not worth a document kind.
 */
export interface AudioDocument {
    kind: "audio";
    /** The format it was written in — see `migrate.ts`. Absent is format 0, every document written before the field existed. */
    formatVersion?: number;
    /** Every node, the root bus included. */
    nodes: TimedNodeSpec[];
    /** Values props bind to with an expression, and that `variableTo`/`variableSet` may drive. */
    variables?: VariableSpec[];
    /** Every command. Order in the array is irrelevant; `at` is the placement. */
    commands: CommandSpec[];
    /** Defaults to the last moment anything happens, same rule as {@link CompositionDocument}. */
    duration?: number;
}

/** Either **visual** document kind — the two that draw. */
export type VisualDocument = StillDocument | CompositionDocument;

/**
 * Anything a project track can play: a picture, or sound.
 *
 * One union rather than two lists, because a track is a placement and a
 * placement does not care which. A composition already carries both halves —
 * its `canvas2d` root takes audio children as readily as visual ones — so an
 * {@link AudioDocument} is not "the audio track kind", it is the clip you reach
 * for when there is no picture to go with the sound.
 */
export type ClipDocument = VisualDocument | AudioDocument;

/** Narrows a {@link VisualDocument} to a still. */
export function isStillDocument(doc: VisualDocument): doc is StillDocument {
    return doc.kind === "still";
}

/** Narrows a {@link VisualDocument} to a composition. */
export function isCompositionDocument(doc: VisualDocument): doc is CompositionDocument {
    return doc.kind === "composition";
}

/** Narrows a {@link ClipDocument} to an audio document. */
export function isAudioDocument(doc: ClipDocument): doc is AudioDocument {
    return doc.kind === "audio";
}

/** Narrows a {@link ClipDocument} to one that has a clock — anything but a still. */
export function hasTimeline(doc: ClipDocument): doc is CompositionDocument | AudioDocument {
    return doc.kind !== "still";
}

/**
 * The id the scene root answers to — the empty string, a real id rather than a
 * missing one. A host storing its root under some other id maps it here at the
 * one boundary its rows become a document.
 */
export const ROOT_NODE_ID = "";

/** When a node is in the tree. `end` is `Infinity` for a node that never leaves. */
export interface NodeSpan {
    start: number;
    end: number;
}

/** A node's own span, as declared. A still's node — no span fields — is present always. */
export function nodeSpan(spec: NodeSpec | TimedNodeSpec): NodeSpan {
    const timed = spec as TimedNodeSpec;
    return { start: timed.startAt ?? 0, end: timed.endAt ?? Infinity };
}

/**
 * When a node is actually drawn: its own span intersected with every ancestor's.
 *
 * A child hangs off its parent, so it cannot outlive it — this is what the
 * runtime already does, and what an editor drawing a clipped bar or a validator
 * asking "is the target there" should read. Empty (`start >= end`) when the
 * spans never overlap; `undefined` for an id no row declares.
 */
export function effectiveSpan(nodes: readonly (NodeSpec | TimedNodeSpec)[], id: string): NodeSpan | undefined {
    return effectiveSpanIn(new Map(nodes.map((n) => [n.id, n])), id);
}

/**
 * {@link effectiveSpan} for every row at once, each ancestor chain walked once
 * however many descendants share it.
 */
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
                // A parent cycle has no top to fold down from; an invalid document
                // gets the single-id answer for each member instead.
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

/** A node with its span dropped — what a timed node becomes when it lands in a still. */
export function untimed(spec: NodeSpec | TimedNodeSpec): NodeSpec {
    const { startAt: _startAt, endAt: _endAt, ...rest } = spec as TimedNodeSpec;
    return rest;
}

/**
 * Seconds a command occupies: one pass, or every pass of a counted loop.
 *
 * An unlimited loop counts as **one** pass. It has no length of its own — it
 * runs for as long as there is clip — so letting it answer here would be a
 * command asking for a scene as long as it wants, which is a scene that can
 * never end.
 */
export function commandSpan(command: CommandSpec): number {
    const duration = command.duration ?? 0;
    if (duration <= 0 || !command.loop || command.loop.count === null) return duration;
    return duration * loopPasses(command.loop);
}

/**
 * How long a clip runs: its declared `duration`, else the last moment anything in
 * it happens — a command's end, or a node's arrival or finite departure. A still
 * has none.
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
