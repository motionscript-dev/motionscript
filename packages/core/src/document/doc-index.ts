import { clipDocument } from "./audio";
import { expressionRefs, type ExpressionRefs } from "./expression/refs";
import {
    documentDuration,
    nodeSpan,
    ROOT_NODE_ID,
    type ClipDocument,
    type CommandSpec,
    type NodeSpan,
    type VisualDocument,
    type TimedNodeSpec,
    type VariableSpec,
} from "./types";

export type InitialKey = "mounted" | "unmounted" | "absent";

/**
 * When compile baselines a node not present at t=0: at the first command `at` inside its own span, mounted or
 * not at that moment.
 */
export type CaptureKey = "none" | "arrival-mounted" | "arrival-unmounted";

/** Any one means rebuild. */
export interface DocIndexIssues {
    duplicateIds: boolean;
    duplicateKeys: boolean;
    unresolvedParent: boolean;
    cycle: boolean;
    invalidRoot: boolean;
    unparsable: boolean;
    /** An expression naming a variable or node key the document does not declare. */
    unresolvedRefs: boolean;
}

export interface DocIndex {
    /** Audio documents are indexed as the composition they lower to. */
    readonly doc: VisualDocument;
    readonly nodes: ReadonlyMap<string, TimedNodeSpec>;
    readonly nodeCount: number;
    readonly variables: ReadonlyMap<string, VariableSpec>;
    readonly commands: ReadonlyMap<string, CommandSpec>;
    /** `at`, ties by array index. */
    readonly ordered: readonly CommandSpec[];
    /** Command ids per target in timeline order; the root's under `""`. */
    readonly byTarget: ReadonlyMap<string, readonly string[]>;
    readonly keyed: ReadonlyMap<string, string>;
    /** Nodes whose props (or `set` args) read a variable, or a keyed node's prop. */
    readonly dependents: {
        byVar: ReadonlyMap<string, ReadonlySet<string>>;
        byKey: ReadonlyMap<string, ReadonlySet<string>>;
    };
    readonly duration: number;
    readonly issues: DocIndexIssues;

    children(parentId: string): readonly string[];
    descendants(id: string): string[];
    ownSpan(id: string): NodeSpan | undefined;
    /** Half-open. */
    effSpan(id: string): NodeSpan | undefined;
    targetOf(spec: CommandSpec): string;
    commandsAt(at: number): readonly CommandSpec[];
    /** References per top-level prop, from the row's props and every `set` targeting it. */
    bindings(id: string): ReadonlyMap<string, ExpressionRefs>;
    refs(id: string): ExpressionRefs;
    initialKey(id: string): InitialKey;
    captureKey(id: string): CaptureKey;
    captureTime(id: string): number | undefined;
}

export function indexDocument(doc: ClipDocument): DocIndex {
    return new DocumentIndex(clipDocument(doc));
}

const NO_REFS: ExpressionRefs = Object.freeze({ vars: [], keys: [], unparsable: 0 }) as ExpressionRefs;
const NO_BINDINGS: ReadonlyMap<string, ExpressionRefs> = new Map();
const EMPTY: readonly never[] = [];

function contains(span: NodeSpan | undefined, t: number): boolean {
    return span !== undefined && t >= span.start && t < span.end;
}

class DocumentIndex implements DocIndex {
    readonly nodes = new Map<string, TimedNodeSpec>();
    readonly nodeCount: number;
    readonly variables = new Map<string, VariableSpec>();
    readonly commands = new Map<string, CommandSpec>();
    readonly ordered: readonly CommandSpec[];
    readonly byTarget = new Map<string, string[]>();
    readonly keyed = new Map<string, string>();
    readonly dependents = { byVar: new Map<string, Set<string>>(), byKey: new Map<string, Set<string>>() };
    readonly duration: number;
    readonly issues: DocIndexIssues = {
        duplicateIds: false,
        duplicateKeys: false,
        unresolvedParent: false,
        cycle: false,
        invalidRoot: false,
        unparsable: false,
        unresolvedRefs: false,
    };

    constructor(readonly doc: VisualDocument) {
        this.duration = documentDuration(doc);
        const commandRows = doc.kind === "composition" ? doc.commands : [];

        this._indexNodes(doc.nodes);
        this.nodeCount = this.nodes.size - 1;
        for (const spec of doc.variables ?? []) {
            if (this.variables.has(spec.id) || this.nodes.has(spec.id)) this.issues.duplicateIds = true;
            this.variables.set(spec.id, spec);
        }

        this.ordered = commandRows
            .map((spec, index) => ({ spec, index }))
            .sort((a, b) => (a.spec.at - b.spec.at) || (a.index - b.index))
            .map((e) => e.spec);
        for (const spec of this.ordered) {
            if (this.commands.has(spec.id)) this.issues.duplicateIds = true;
            this.commands.set(spec.id, spec);
            const target = this.targetOf(spec);
            let list = this.byTarget.get(target);
            if (!list) this.byTarget.set(target, list = []);
            list.push(spec.id);
            let atList = this._byAt.get(spec.at);
            if (!atList) this._byAt.set(spec.at, atList = []);
            atList.push(spec);
        }
        this._ats = [...this._byAt.keys()];

        this._indexRefs(commandRows);
    }

    children(parentId: string): readonly string[] {
        return this._children.get(parentId) ?? EMPTY;
    }

    descendants(id: string): string[] {
        const out: string[] = [];
        const seen = new Set<string>([id]);
        const stack = [...this.children(id)].reverse();
        while (stack.length > 0) {
            const child = stack.pop()!;
            if (seen.has(child)) continue;
            seen.add(child);
            out.push(child);
            const grand = this.children(child);
            for (let i = grand.length - 1; i >= 0; i--) stack.push(grand[i]);
        }
        return out;
    }

    ownSpan(id: string): NodeSpan | undefined {
        const spec = this.nodes.get(id);
        return spec ? nodeSpan(spec) : undefined;
    }

    effSpan(id: string): NodeSpan | undefined {
        const memo = this._eff.get(id);
        if (memo) return memo;
        if (!this.nodes.has(id)) return undefined;

        const chain: TimedNodeSpec[] = [];
        const seen = new Set<string>();
        let base: NodeSpan = { start: 0, end: Infinity };
        let cursor = this.nodes.get(id);
        while (cursor) {
            const known = this._eff.get(cursor.id);
            if (known) {
                base = known;
                break;
            }
            if (seen.has(cursor.id)) break;
            seen.add(cursor.id);
            chain.push(cursor);
            if (cursor.id === ROOT_NODE_ID || cursor.parentId === null) break;
            cursor = this.nodes.get(cursor.parentId);
        }
        for (let i = chain.length - 1; i >= 0; i--) {
            const own = nodeSpan(chain[i]);
            base = { start: Math.max(base.start, own.start), end: Math.min(base.end, own.end) };
            this._eff.set(chain[i].id, base);
        }
        return this._eff.get(id);
    }

    targetOf(spec: CommandSpec): string {
        return spec.targetId ?? ROOT_NODE_ID;
    }

    commandsAt(at: number): readonly CommandSpec[] {
        return this._byAt.get(at) ?? EMPTY;
    }

    bindings(id: string): ReadonlyMap<string, ExpressionRefs> {
        return this._bindings.get(id) ?? NO_BINDINGS;
    }

    refs(id: string): ExpressionRefs {
        return this._refs.get(id) ?? NO_REFS;
    }

    initialKey(id: string): InitialKey {
        if (!contains(this.ownSpan(id), 0)) return "absent";
        return contains(this.effSpan(id), 0) ? "mounted" : "unmounted";
    }

    captureKey(id: string): CaptureKey {
        const at = this.captureTime(id);
        if (at === undefined) return "none";
        return contains(this.effSpan(id), at) ? "arrival-mounted" : "arrival-unmounted";
    }

    captureTime(id: string): number | undefined {
        const own = this.ownSpan(id);
        if (!own || contains(own, 0)) return undefined;
        let lo = 0;
        let hi = this._ats.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._ats[mid] < own.start) lo = mid + 1;
            else hi = mid;
        }
        const at = this._ats[lo];
        return at !== undefined && at < own.end ? at : undefined;
    }

    private readonly _children = new Map<string, string[]>();
    private readonly _eff = new Map<string, NodeSpan>();
    private readonly _byAt = new Map<number, CommandSpec[]>();
    private _ats: number[] = [];
    private readonly _bindings = new Map<string, Map<string, ExpressionRefs>>();
    private readonly _refs = new Map<string, ExpressionRefs>();

    private _indexNodes(rows: readonly TimedNodeSpec[]): void {
        const siblings = new Map<string, Array<{ id: string; order: number; index: number }>>();
        rows.forEach((spec, index) => {
            if (this.nodes.has(spec.id)) this.issues.duplicateIds = true;
            this.nodes.set(spec.id, spec);
            if (spec.key) {
                if (this.keyed.has(spec.key)) this.issues.duplicateKeys = true;
                this.keyed.set(spec.key, spec.id);
            }
            if (spec.id === ROOT_NODE_ID) {
                if (spec.type !== "canvas2d" || spec.parentId !== null) this.issues.invalidRoot = true;
                return;
            }
            const parent = spec.parentId ?? ROOT_NODE_ID;
            let list = siblings.get(parent);
            if (!list) siblings.set(parent, list = []);
            list.push({ id: spec.id, order: spec.layerOrder, index });
        });
        if (!this.nodes.has(ROOT_NODE_ID)) {
            this.nodes.set(ROOT_NODE_ID, { id: ROOT_NODE_ID, type: "canvas2d", parentId: null, layerOrder: 0, props: {} });
        }
        for (const [parent, list] of siblings) {
            list.sort((a, b) => (a.order - b.order) || (a.index - b.index));
            this._children.set(parent, list.map((e) => e.id));
        }

        const settled = new Set<string>([ROOT_NODE_ID]);
        for (const spec of this.nodes.values()) {
            if (spec.parentId !== null && !this.nodes.has(spec.parentId)) this.issues.unresolvedParent = true;
            const seen = new Set<string>();
            let cursor: TimedNodeSpec | undefined = spec;
            while (cursor && !settled.has(cursor.id)) {
                if (seen.has(cursor.id)) {
                    this.issues.cycle = true;
                    break;
                }
                seen.add(cursor.id);
                cursor = cursor.parentId === null ? undefined : this.nodes.get(cursor.parentId);
            }
            for (const id of seen) settled.add(id);
        }
    }

    private _indexRefs(commandRows: readonly CommandSpec[]): void {
        for (const spec of this.nodes.values()) this._bind(spec.id, spec.props);
        for (const command of commandRows) {
            if (command.type === "set") {
                const target = this.targetOf(command);
                if (this.nodes.has(target)) {
                    this._bind(target, command.args);
                    continue;
                }
            }
            if (expressionRefs(command.args).unparsable > 0) this.issues.unparsable = true;
        }

        for (const [id, props] of this._bindings) {
            const vars = new Set<string>();
            const keys = new Map<string, [string, string]>();
            let unparsable = 0;
            for (const refs of props.values()) {
                for (const v of refs.vars) vars.add(v);
                for (const pair of refs.keys) keys.set(`${pair[0]}.${pair[1]}`, pair);
                unparsable += refs.unparsable;
            }
            this._refs.set(id, { vars: [...vars], keys: [...keys.values()], unparsable });

            for (const v of vars) {
                if (!this.variables.has(v)) this.issues.unresolvedRefs = true;
                let readers = this.dependents.byVar.get(v);
                if (!readers) this.dependents.byVar.set(v, readers = new Set());
                readers.add(id);
            }
            for (const [key] of keys.values()) {
                if (!this.keyed.has(key)) this.issues.unresolvedRefs = true;
                let readers = this.dependents.byKey.get(key);
                if (!readers) this.dependents.byKey.set(key, readers = new Set());
                readers.add(id);
            }
        }
    }

    private _bind(id: string, props: Record<string, unknown> | undefined): void {
        if (!props) return;
        for (const prop of Object.keys(props)) {
            const found = expressionRefs(props[prop]);
            if (found.unparsable > 0) this.issues.unparsable = true;
            if (found.vars.length === 0 && found.keys.length === 0) continue;
            let table = this._bindings.get(id);
            if (!table) this._bindings.set(id, table = new Map());
            const existing = table.get(prop);
            if (!existing) {
                table.set(prop, found);
                continue;
            }
            const vars = new Set([...existing.vars, ...found.vars]);
            const keys = new Map([...existing.keys, ...found.keys].map((p) => [`${p[0]}.${p[1]}`, p] as const));
            table.set(prop, { vars: [...vars], keys: [...keys.values()], unparsable: existing.unparsable + found.unparsable });
        }
    }
}
