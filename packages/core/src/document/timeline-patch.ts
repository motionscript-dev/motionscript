import type { CommandTraits } from "./command-traits";
import { jsonEqual, type ClipDiff } from "./diff";
import type { DocIndex } from "./doc-index";
import type { ExpressionRefs } from "./expression/refs";
import { nodeSpan, ROOT_NODE_ID, type CommandSpec, type NodeSpan, type NodeSpec } from "./types";

/** What the planner needs to know about code, so it can be exercised without a registry. */
export interface PatchEnvironment {
    traits(spec: CommandSpec, target: NodeSpec | undefined): CommandTraits | null;
    /** Node ids the command's args name (`moveTo`'s `target`). Absent names none. */
    nodeRefs?(spec: CommandSpec, target: NodeSpec | undefined): readonly string[];
    isContextProvider(type: string): boolean;
    isLayoutNeutralProp(type: string, key: string): boolean;
    /** Whether a new `key` on `row` is written onto its live node rather than a new one. Absent writes none in place. */
    writesInPlace?(row: NodeSpec, key: string): boolean;
    /** The live instance's constructor, or `undefined` when there is none to compare. */
    ctorOf(id: string): unknown;
    registeredCtor(type: string): unknown;
    /** A type's tree; `"audio"` rows are left out of layout decisions. Absent treats every type as laid out. */
    dimensionOf?(type: string): string | undefined;
}

export interface TimelinePatch {
    prev: DocIndex;
    next: DocIndex;
    diff: ClipDiff;
    added: ReadonlySet<string>;
    removed: ReadonlySet<string>;
    /** Kept ids that get a new instance. */
    reinstantiate: ReadonlySet<string>;
    /** Kept ids whose changed props are all placement, written onto the live instance instead. */
    inPlace: ReadonlySet<string>;
    detach: ReadonlySet<string>;
    /** Nodes whose command chains are rebuilt; may include the root `""`. */
    dirtyNodes: ReadonlySet<string>;
    dirtyVariables: ReadonlySet<string>;
    /** Clean chains that must run for dirty ones to build against the right values; empty means none. */
    replay: ReadonlySet<string> | "all";
    /** Arrival baselines to take during the walk, ascending by `at`. */
    captures: ReadonlyArray<{ at: number; id: string }>;
    layoutChanged: boolean;
}

export interface PatchOptions {
    /** Rebuild instead once more than this fraction of nodes would be re-instantiated. Default 0.5. */
    rebuildFraction?: number;
    /** Patch whenever at most this many nodes would be re-instantiated, whatever the fraction. Default {@link MIN_REBUILD_NODES}. */
    minRebuildNodes?: number;
}

/**
 * A rebuild of a small clip is not cheaper than patching it: the runtime also
 * throws away the track's asset index, sweeps it again and republishes it.
 */
export const MIN_REBUILD_NODES = 16;

/**
 * Plan an in-place update of a built clip from `prev` to `next`, or `null` when
 * only a rebuild is sound.
 *
 * Every rule errs towards doing more: a node marked dirty that did not need it
 * costs one chain rebuild, while one missed renders a frame that disagrees with
 * a fresh build of the same document.
 */
export function planTimelinePatch(
    prev: DocIndex,
    next: DocIndex,
    diff: ClipDiff,
    env: PatchEnvironment,
    options: PatchOptions = {},
): TimelinePatch | null {
    if (diff.kindChanged || diff.themeChanged) return null;
    if (structurallyFaulty(prev) || structurallyFaulty(next)) return null;
    const prevRoot = prev.nodes.get(ROOT_NODE_ID)!;
    const nextRoot = next.nodes.get(ROOT_NODE_ID)!;
    // The canvas is never re-instantiated, so only props it can be reset and re-set to are patched.
    if (diff.rootChanged && !onlyPropsDiffer(prevRoot, nextRoot)) return null;
    if (next.issues.unparsable || next.issues.unresolvedRefs) return null;
    if (diff.remappedKeys.size > 0) return null;

    const prevTraits = traitsOf(prev, env);
    const nextTraits = prevTraits && traitsOf(next, env);
    if (!prevTraits || !nextTraits) return null;

    const { added, removed, respec, moved, span, reorderedParents } = diff.nodes;
    const targeted = (id: string): boolean => (next.byTarget.get(id)?.length ?? 0) > 0;
    const anyCommand = (index: DocIndex, traits: Map<string, CommandTraits>, id: string, test: (t: CommandTraits) => boolean) =>
        index.byTarget.get(id)?.some((cid) => test(traits.get(cid)!)) ?? false;
    const unknownEither = (id: string) =>
        anyCommand(prev, prevTraits, id, (t) => !t.known) || anyCommand(next, nextTraits, id, (t) => !t.known);
    const laidOut = (index: DocIndex, id: string) => {
        const type = index.nodes.get(id)?.type;
        return type === undefined || env.dimensionOf?.(type) !== "audio";
    };
    const laidOutEither = (id: string) => laidOut(prev, id) || laidOut(next, id);
    const kept: string[] = [];
    for (const id of next.nodes.keys()) {
        if (id !== ROOT_NODE_ID && prev.nodes.has(id)) kept.push(id);
    }

    // ── Re-instantiation ────────────────────────────────────────────────────
    const R = new Set<string>();
    const isProvider = (id: string) => {
        const a = prev.nodes.get(id)?.type;
        const b = next.nodes.get(id)?.type;
        return (a !== undefined && env.isContextProvider(a)) || (b !== undefined && env.isContextProvider(b));
    };
    const reinstantiate = (id: string) => {
        if (R.has(id)) return;
        R.add(id);
        // A provider among the descendants needs no recursion: its subtree is already in this one.
        if (isProvider(id)) for (const d of next.descendants(id)) R.add(d);
    };

    const inPlace = new Set<string>();
    for (const id of respec) {
        if (placementOnly(prev, next, id, env)) inPlace.add(id);
        else reinstantiate(id);
    }
    for (const id of moved) {
        reinstantiate(id);
        if (providerAbove(prev, id, env) || providerAbove(next, id, env)) {
            for (const d of next.descendants(id)) R.add(d);
        }
    }
    for (const id of [...added, ...removed]) {
        if (isProvider(id)) for (const d of next.descendants(id)) R.add(d);
    }
    let reregistered = false;
    for (const id of kept) {
        const live = env.ctorOf(id);
        if (live !== undefined && env.registeredCtor(next.nodes.get(id)!.type) !== live) {
            reinstantiate(id);
            if (laidOutEither(id)) reregistered = true;
        }
        if (targeted(id) && prev.initialKey(id) !== next.initialKey(id)) reinstantiate(id);
    }

    // ── Dirty chains ────────────────────────────────────────────────────────
    const DN = new Set<string>();
    const DV = new Set<string>();
    const mark = (id: string) => {
        if (next.variables.has(id)) DV.add(id);
        else if (next.nodes.has(id)) DN.add(id);
    };

    for (const cid of diff.commands.added) mark(next.targetOf(next.commands.get(cid)!));
    for (const cid of diff.commands.removed) mark(prev.targetOf(prev.commands.get(cid)!));
    for (const cid of diff.commands.changed) {
        mark(prev.targetOf(prev.commands.get(cid)!));
        mark(next.targetOf(next.commands.get(cid)!));
    }
    for (const id of new Set([...prev.byTarget.keys(), ...next.byTarget.keys()])) {
        if (!sameList(prev.byTarget.get(id), next.byTarget.get(id))) mark(id);
    }
    for (const at of diff.commands.reorderedAts) {
        for (const spec of prev.commandsAt(at)) mark(prev.targetOf(spec));
        for (const spec of next.commandsAt(at)) mark(next.targetOf(spec));
    }
    // An unlimited loop is built to fill the clip it found, so a clip that grew
    // or shrank rebuilds it — nothing on the command itself changed.
    if (diff.duration) {
        for (const spec of next.commands.values()) {
            if (spec.loop?.count === null) mark(next.targetOf(spec));
        }
    }
    for (const id of diff.variables.added) DV.add(id);
    for (const id of diff.variables.changed) DV.add(id);

    const presenceChanged = new Set<string>();
    for (const id of kept) {
        if (!sameSpan(prev.effSpan(id), next.effSpan(id))) {
            presenceChanged.add(id);
            if (targeted(id)) DN.add(id);
        } else if (
            targeted(id)
            && (prev.captureKey(id) !== next.captureKey(id) || prev.captureTime(id) !== next.captureTime(id))
        ) {
            DN.add(id);
        }
    }

    let L = reorderedParents.size > 0 || reregistered
        || [...added].some((id) => laidOut(next, id))
        || [...removed].some((id) => laidOut(prev, id))
        || [...moved].some(laidOutEither)
        || [...span].some(laidOutEither)
        || [...respec].some((id) => laidOutEither(id) && respecTouchesLayout(prev.nodes.get(id)!, next.nodes.get(id)!, env))
        || (diff.rootChanged && respecTouchesLayout(prevRoot, nextRoot, env));

    // Nodes whose prop values over time may differ from the live build: anything
    // reading one of them through `[key.prop]` builds its chain from different values.
    const valueChanged = new Set<string>([...added, ...removed, ...presenceChanged, ...inPlace]);
    if (diff.rootChanged) valueChanged.add(ROOT_NODE_ID);
    const aimed = [...nodeReaders(prev, env), ...nodeReaders(next, env)];
    const bindsLayout = (reader: string, reads: (refs: ExpressionRefs) => boolean) => {
        const type = next.nodes.get(reader)?.type;
        if (type === undefined || env.dimensionOf?.(type) === "audio") return false;
        for (const [prop, refs] of next.bindings(reader)) {
            if (reads(refs) && !env.isLayoutNeutralProp(type, prop)) return true;
        }
        return false;
    };

    let size = -1;
    while (size !== DN.size + DV.size + R.size + valueChanged.size + (L ? 1 : 0)) {
        size = DN.size + DV.size + R.size + valueChanged.size + (L ? 1 : 0);

        for (const id of R) if (targeted(id)) DN.add(id);
        for (const id of R) valueChanged.add(id);
        for (const id of DN) valueChanged.add(id);

        for (const v of DV) {
            for (const reader of next.dependents.byVar.get(v) ?? []) {
                valueChanged.add(reader);
                if (!L && bindsLayout(reader, (refs) => refs.vars.includes(v))) L = true;
            }
        }
        for (const id of valueChanged) {
            for (const key of keysOf(prev, next, id)) {
                for (const reader of next.dependents.byKey.get(key) ?? []) {
                    valueChanged.add(reader);
                    if (!L && bindsLayout(reader, (refs) => refs.keys.some(([k]) => k === key))) L = true;
                }
            }
        }
        // Where a named node is depends on every ancestor too.
        for (const { reader, ref } of aimed) {
            if (lineageIn(prev, ref, valueChanged) || lineageIn(next, ref, valueChanged)) valueChanged.add(reader);
        }
        for (const id of valueChanged) if (next.nodes.has(id) && targeted(id)) DN.add(id);

        for (const id of DN) {
            if (id !== ROOT_NODE_ID && unknownEither(id)) reinstantiate(id);
        }

        if (!L) {
            for (const id of [...DN, ...DV]) {
                if (anyCommand(prev, prevTraits, id, (t) => t.writesLayout) || anyCommand(next, nextTraits, id, (t) => t.writesLayout)) {
                    L = true;
                    break;
                }
            }
        }
        if (L) {
            for (const id of next.byTarget.keys()) {
                if (next.nodes.has(id) && anyCommand(next, nextTraits, id, (t) => t.readsLayout)) DN.add(id);
            }
        }
    }

    if (DN.has(ROOT_NODE_ID) && unknownEither(ROOT_NODE_ID)) return null;
    const limit = Math.max((options.rebuildFraction ?? 0.5) * next.nodeCount, options.minRebuildNodes ?? MIN_REBUILD_NODES);
    if (R.size > limit) return null;
    for (const id of R) inPlace.delete(id);

    // ── Replay ──────────────────────────────────────────────────────────────
    let replay: Set<string> | "all";
    const dirtyTargets = [...DN, ...DV];
    if (dirtyTargets.some((id) => anyCommand(next, nextTraits, id, (t) => t.readsLayout || !t.known))) {
        replay = "all";
    } else {
        replay = new Set<string>();
        const queue: string[] = [];
        const visited = new Set<string>();
        for (const id of DN) {
            const refs = next.refs(id);
            if (refs.vars.length === 0 && refs.keys.length === 0) continue;
            if (!(next.byTarget.get(id) ?? []).some((cid) => next.commands.get(cid)!.type !== "set")) continue;
            visited.add(id);
            queue.push(id);
        }
        while (queue.length > 0) {
            const refs = next.refs(queue.pop()!);
            for (const v of refs.vars) {
                if (!DV.has(v) && targeted(v)) replay.add(v);
            }
            for (const [key] of refs.keys) {
                const id = next.keyed.get(key);
                if (id === undefined) continue;
                if (!DN.has(id) && targeted(id)) replay.add(id);
                if (!visited.has(id)) {
                    visited.add(id);
                    queue.push(id);
                }
            }
        }
    }

    // ── Structure ───────────────────────────────────────────────────────────
    const detach = new Set<string>([...removed, ...R]);
    for (const parent of reorderedParents) {
        for (const child of next.children(parent)) if (prev.nodes.has(child)) detach.add(child);
    }
    for (const id of R) {
        for (const child of next.children(id)) detach.add(child);
    }

    const captures: Array<{ at: number; id: string }> = [];
    for (const id of new Set([...DN, ...R, ...added])) {
        if (!targeted(id)) continue;
        const at = next.captureTime(id);
        if (at !== undefined) captures.push({ at, id });
    }
    captures.sort((a, b) => a.at - b.at);

    return {
        prev,
        next,
        diff,
        added,
        removed,
        reinstantiate: R,
        inPlace,
        detach,
        dirtyNodes: DN,
        dirtyVariables: DV,
        replay,
        captures,
        layoutChanged: L,
    };
}

function structurallyFaulty(index: DocIndex): boolean {
    const { duplicateIds, duplicateKeys, unresolvedParent, cycle, invalidRoot } = index.issues;
    return duplicateIds || duplicateKeys || unresolvedParent || cycle || invalidRoot;
}

/**
 * Every command's traits, or `null` when one cannot be patched at all: it does
 * not resolve, it changes structure, or its target is not the kind its scope names.
 */
function traitsOf(index: DocIndex, env: PatchEnvironment): Map<string, CommandTraits> | null {
    const out = new Map<string, CommandTraits>();
    for (const spec of index.ordered) {
        const targetId = index.targetOf(spec);
        const target = index.nodes.get(targetId);
        const traits = env.traits(spec, target);
        if (!traits || traits.lifecycle) return null;
        if (traits.scope === "variable" ? !index.variables.has(targetId) : !target) return null;
        out.set(spec.id, traits);
    }
    return out;
}

/** Each command target paired with a node its args name. */
function nodeReaders(index: DocIndex, env: PatchEnvironment): Array<{ reader: string; ref: string }> {
    if (!env.nodeRefs) return [];
    const out: Array<{ reader: string; ref: string }> = [];
    for (const spec of index.ordered) {
        const reader = index.targetOf(spec);
        for (const ref of env.nodeRefs(spec, index.nodes.get(reader))) out.push({ reader, ref });
    }
    return out;
}

/** Whether `id` or any ancestor of it is in `set`. */
function lineageIn(index: DocIndex, id: string, set: ReadonlySet<string>): boolean {
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined && !seen.has(cursor)) {
        if (set.has(cursor)) return true;
        seen.add(cursor);
        const spec = index.nodes.get(cursor);
        if (!spec || cursor === ROOT_NODE_ID) return false;
        cursor = spec.parentId ?? ROOT_NODE_ID;
    }
    return false;
}

function providerAbove(index: DocIndex, id: string, env: PatchEnvironment): boolean {
    const seen = new Set<string>([id]);
    let cursor = index.nodes.get(id);
    while (cursor && cursor.id !== ROOT_NODE_ID) {
        const parentId: string = cursor.parentId ?? ROOT_NODE_ID;
        if (seen.has(parentId)) return false;
        seen.add(parentId);
        cursor = index.nodes.get(parentId);
        if (cursor && env.isContextProvider(cursor.type)) return true;
    }
    return false;
}

function onlyPropsDiffer(a: NodeSpec, b: NodeSpec): boolean {
    const sa = nodeSpan(a);
    const sb = nodeSpan(b);
    return a.type === b.type && a.key === b.key && a.parentId === b.parentId && a.layerOrder === b.layerOrder
        && sa.start === sb.start && sa.end === sb.end;
}

/** Whether every prop the row changed is a literal placement value it still sets. */
function placementOnly(prev: DocIndex, next: DocIndex, id: string, env: PatchEnvironment): boolean {
    const a = prev.nodes.get(id)!;
    const b = next.nodes.get(id)!;
    if (!env.writesInPlace || a.type !== b.type || a.key !== b.key) return false;
    const was = prev.bindings(id);
    const is = next.bindings(id);
    for (const key of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
        if (jsonEqual(a.props[key], b.props[key])) continue;
        // A prop taken out would go back to its default, which only a new instance knows.
        if (b.props[key] === undefined || was.has(key) || is.has(key) || !env.writesInPlace(b, key)) return false;
    }
    return true;
}

function respecTouchesLayout(a: NodeSpec, b: NodeSpec, env: PatchEnvironment): boolean {
    if (a.type !== b.type || a.key !== b.key) return true;
    for (const key of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
        if (!jsonEqual(a.props[key], b.props[key]) && !env.isLayoutNeutralProp(b.type, key)) return true;
    }
    return false;
}

function keysOf(prev: DocIndex, next: DocIndex, id: string): string[] {
    const out: string[] = [];
    const a = prev.nodes.get(id)?.key;
    const b = next.nodes.get(id)?.key;
    if (a) out.push(a);
    if (b && b !== a) out.push(b);
    return out;
}

function sameSpan(a: NodeSpan | undefined, b: NodeSpan | undefined): boolean {
    return a?.start === b?.start && a?.end === b?.end;
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
