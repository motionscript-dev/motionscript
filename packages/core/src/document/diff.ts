import { clipDocument } from "./audio";
import {
    documentDuration,
    nodeSpan,
    ROOT_NODE_ID,
    type ClipDocument,
    type CommandSpec,
    type NodeSpec,
    type VisualDocument,
    type TimedNodeSpec,
    type VariableSpec,
} from "./types";

/**
 * Key order is irrelevant, an `undefined`-valued key equals an absent one (neither survives serialization),
 * arrays are ordered.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
        return a !== a && b !== b;
    }
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!jsonEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (Array.isArray(b)) return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    let defined = 0;
    for (const key of Object.keys(ao)) {
        const value = ao[key];
        if (value === undefined) continue;
        defined++;
        if (!jsonEqual(value, bo[key])) return false;
    }
    for (const key of Object.keys(bo)) {
        if (bo[key] !== undefined) defined--;
    }
    return defined === 0;
}

export interface RowChanges {
    added: Set<string>;
    removed: Set<string>;
    changed: Set<string>;
}

export interface ClipDiff {
    /** Nothing semantic differs — the two documents build the same clip. */
    identical: boolean;
    kindChanged: boolean;
    themeChanged: boolean;
    rootChanged: boolean;
    duration: boolean;
    nodes: RowChanges & {
        respec: Set<string>;
        moved: Set<string>;
        span: Set<string>;
        reorderedParents: Set<string>;
    };
    commands: RowChanges & {
        reorderedAts: Set<number>;
    };
    /** A `name` is a label and never counts. */
    variables: RowChanges;
    remappedKeys: Set<string>;
}

function emptyDiff(): ClipDiff {
    return {
        identical: true,
        kindChanged: false,
        themeChanged: false,
        rootChanged: false,
        duration: false,
        nodes: {
            added: new Set(), removed: new Set(), changed: new Set(),
            respec: new Set(), moved: new Set(), span: new Set(), reorderedParents: new Set(),
        },
        commands: { added: new Set(), removed: new Set(), changed: new Set(), reorderedAts: new Set() },
        variables: { added: new Set(), removed: new Set(), changed: new Set() },
        remappedKeys: new Set(),
    };
}

/**
 * Only semantic fields are compared, so an edit that cannot change what the clip builds (a variable's `name`,
 * key order inside `props`, `startAt: 0` against an absent one) is not a change. Audio documents are compared
 * as the compositions they lower to.
 */
export function diffClip(prev: ClipDocument, next: ClipDocument): ClipDiff {
    const diff = emptyDiff();
    if (prev === next) return diff;

    if (prev.kind !== next.kind) {
        diff.kindChanged = true;
        diff.identical = false;
        return diff;
    }

    const p = lowered(prev);
    const n = lowered(next);

    diff.themeChanged = !jsonEqual((prev as { theme?: unknown }).theme, (next as { theme?: unknown }).theme);
    diff.duration = documentDuration(p) !== documentDuration(n);

    if (prev.nodes !== next.nodes) diffNodes(p.nodes, n.nodes, diff);
    if (prev.variables !== next.variables) diffVariables(p.variables ?? [], n.variables ?? [], diff);
    const prevCommands = p.kind === "composition" ? p.commands : [];
    const nextCommands = n.kind === "composition" ? n.commands : [];
    if ((prev as { commands?: unknown }).commands !== (next as { commands?: unknown }).commands) {
        diffCommands(prevCommands, nextCommands, diff);
    }

    diff.identical = !diff.themeChanged && !diff.rootChanged && !diff.duration
        && diff.remappedKeys.size === 0
        && rowsEmpty(diff.nodes) && diff.nodes.reorderedParents.size === 0
        && rowsEmpty(diff.commands) && diff.commands.reorderedAts.size === 0
        && rowsEmpty(diff.variables);
    return diff;
}

function lowered(doc: ClipDocument): VisualDocument {
    return clipDocument(doc);
}

function rowsEmpty(rows: RowChanges): boolean {
    return rows.added.size === 0 && rows.removed.size === 0 && rows.changed.size === 0;
}

const DEFAULT_ROOT: NodeSpec = { id: ROOT_NODE_ID, type: "canvas2d", parentId: null, layerOrder: 0, props: {} };

function diffNodes(prevRows: readonly TimedNodeSpec[], nextRows: readonly TimedNodeSpec[], diff: ClipDiff): void {
    const prev = byId(prevRows);
    const next = byId(nextRows);
    const changes = diff.nodes;

    const prevRoot = prev.get(ROOT_NODE_ID) ?? DEFAULT_ROOT;
    const nextRoot = next.get(ROOT_NODE_ID) ?? DEFAULT_ROOT;
    diff.rootChanged = prevRoot !== nextRoot && !sameNode(prevRoot, nextRoot);

    for (const [id, a] of prev) {
        if (id === ROOT_NODE_ID) continue;
        const b = next.get(id);
        if (!b) {
            changes.removed.add(id);
            continue;
        }
        if (a === b) continue;
        let changed = false;
        if (a.type !== b.type || a.key !== b.key || !jsonEqual(a.props, b.props)) {
            changes.respec.add(id);
            changed = true;
        }
        if (a.parentId !== b.parentId) {
            changes.moved.add(id);
            changed = true;
        }
        if (!sameSpan(a, b)) {
            changes.span.add(id);
            changed = true;
        }
        if (changed || a.layerOrder !== b.layerOrder) changes.changed.add(id);
    }
    for (const id of next.keys()) {
        if (id !== ROOT_NODE_ID && !prev.has(id)) changes.added.add(id);
    }

    const prevKeys = keyed(prevRows);
    for (const [key, id] of keyed(nextRows)) {
        const was = prevKeys.get(key);
        if (was !== undefined && was !== id) diff.remappedKeys.add(key);
    }

    const prevOrder = siblingOrder(prevRows);
    const nextOrder = siblingOrder(nextRows);
    for (const [parent, before] of prevOrder) {
        const after = nextOrder.get(parent);
        if (after && !sameRelativeOrder(before, after)) changes.reorderedParents.add(parent);
    }
}

function sameNode(a: NodeSpec, b: NodeSpec): boolean {
    return a.type === b.type
        && a.key === b.key
        && a.parentId === b.parentId
        && a.layerOrder === b.layerOrder
        && jsonEqual(a.props, b.props)
        && sameSpan(a, b);
}

function sameSpan(a: NodeSpec, b: NodeSpec): boolean {
    const sa = nodeSpan(a);
    const sb = nodeSpan(b);
    return sa.start === sb.start && sa.end === sb.end;
}

function diffCommands(prevRows: readonly CommandSpec[], nextRows: readonly CommandSpec[], diff: ClipDiff): void {
    const prev = byId(prevRows);
    const next = byId(nextRows);
    const changes = diff.commands;

    for (const [id, a] of prev) {
        const b = next.get(id);
        if (!b) {
            changes.removed.add(id);
            continue;
        }
        if (a === b) continue;
        if (
            a.type !== b.type
            || a.targetId !== b.targetId
            || a.at !== b.at
            || (a.duration ?? 0) !== (b.duration ?? 0)
            || !jsonEqual(a.easing, b.easing)
            || !jsonEqual(a.loop, b.loop)
            || !jsonEqual(a.args, b.args)
        ) {
            changes.changed.add(id);
        }
    }
    for (const id of next.keys()) {
        if (!prev.has(id)) changes.added.add(id);
    }

    const prevAts = groupByAt(prevRows);
    const nextAts = groupByAt(nextRows);
    for (const [at, before] of prevAts) {
        const after = nextAts.get(at);
        if (after && !sameRelativeOrder(before, after)) changes.reorderedAts.add(at);
    }
}

function diffVariables(prevRows: readonly VariableSpec[], nextRows: readonly VariableSpec[], diff: ClipDiff): void {
    const prev = byId(prevRows);
    const next = byId(nextRows);
    const changes = diff.variables;
    for (const [id, a] of prev) {
        const b = next.get(id);
        if (!b) {
            changes.removed.add(id);
            continue;
        }
        if (a !== b && (a.lerp !== b.lerp || !jsonEqual(a.value, b.value))) changes.changed.add(id);
    }
    for (const id of next.keys()) {
        if (!prev.has(id)) changes.added.add(id);
    }
}

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
    const out = new Map<string, T>();
    for (const row of rows) out.set(row.id, row);
    return out;
}

function keyed(rows: readonly NodeSpec[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const row of rows) if (row.key) out.set(row.key, row.id);
    return out;
}

function siblingOrder(rows: readonly NodeSpec[]): Map<string, string[]> {
    const groups = new Map<string, Array<{ id: string; order: number; index: number }>>();
    rows.forEach((row, index) => {
        if (row.id === ROOT_NODE_ID) return;
        const parent = row.parentId ?? ROOT_NODE_ID;
        let list = groups.get(parent);
        if (!list) groups.set(parent, list = []);
        list.push({ id: row.id, order: row.layerOrder, index });
    });
    const out = new Map<string, string[]>();
    for (const [parent, list] of groups) {
        list.sort((a, b) => (a.order - b.order) || (a.index - b.index));
        out.set(parent, list.map((e) => e.id));
    }
    return out;
}

function groupByAt(rows: readonly CommandSpec[]): Map<number, string[]> {
    const out = new Map<number, string[]>();
    for (const row of rows) {
        let list = out.get(row.at);
        if (!list) out.set(row.at, list = []);
        list.push(row.id);
    }
    return out;
}

function sameRelativeOrder(a: readonly string[], b: readonly string[]): boolean {
    const inB = new Set(b);
    const inA = new Set(a);
    const sharedA = a.filter((id) => inB.has(id));
    const sharedB = b.filter((id) => inA.has(id));
    if (sharedA.length !== sharedB.length) return false;
    for (let i = 0; i < sharedA.length; i++) {
        if (sharedA[i] !== sharedB[i]) return false;
    }
    return true;
}
