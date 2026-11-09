import type { AssetCatalog } from "@/assets/catalog";
import type { Size2D } from "@/attributes/layout/size";
import { clipDocument } from "@/document/audio";
import type { Registry } from "@/document/registry";
import { ClipTimeline, type PlacedCommandInfo, type PlacedSound, type TimelineIssue } from "@/document/timeline";
import type { TimelinePatch } from "@/document/timeline-patch";
import type { PropSlot } from "@/props/slot";
import {
    effectiveSpans,
    ROOT_NODE_ID,
    type ClipDocument,
    type NodeSpan,
    type VisualDocument,
} from "@/document/types";
import type { Node } from "@/components/trees/node/node";
import { applyEditorStates, type NodeEditorStates } from "@/components/trees/node/node-editor-state";
import { primeMotionTree, sampleTree } from "@/components/trees/node/node-walk";
import { Canvas2D } from "@/components/trees/root/canvas2d-node";
import { nodePath } from "@/project/tree";
import type { MeasureContext2D } from "@/render/measure-context";
import type { RenderPass2D } from "@/render/render-context2d";
import { ContextMap } from "@/util/context";

/** What a clip is built and measured against — the same for every track in a session. */
export interface RuntimeScope {
    registry: Registry;
    viewport: Size2D;
    fps: number;
    assets: AssetCatalog;
    measurer: MeasureContext2D;
}

/**
 * One track's clip, live: the viewport-sized {@link Canvas2D} it builds into and
 * the timeline compiled over it.
 *
 * Built once, then asked for a time. Nothing resets one — a caller that needs a
 * fresh tree builds a new instance — which is what lets the measuring pass and
 * the evaluator each hold their own instead of taking turns with one.
 */
export class ClipInstance {
    readonly canvas: Canvas2D;

    constructor(clip: ClipDocument, duration: number, private readonly _scope: RuntimeScope) {
        this._clip = clip;
        this._duration = duration;
        this._doc = lowered(clip);
        const { width, height } = _scope.viewport;
        // Seeded here because this canvas *is* the document's root row, yet it is
        // the one node no `Registry.instantiate` makes: `ClipTimeline` applies
        // that row's props with `set()`, which writes property fields only, so
        // an unseeded root would report a UUID no document row mentions.
        this.canvas = new Canvas2D({ id: ROOT_NODE_ID, width, height, flow: "freeform" });
        this._timeline = new ClipTimeline(this._doc, _scope.registry, this.canvas);
        this._indexRows();
    }

    get duration(): number {
        return this._duration;
    }

    /** The clip document this instance plays, as handed in — before audio lowering. */
    get clip(): ClipDocument {
        return this._clip;
    }

    /**
     * Build the tree, then fix every command against it laid out — see `ClipTimeline.compile`.
     * `measurer` stands in for the scope's during the build only.
     */
    build(measurer: MeasureContext2D = this._scope.measurer): void {
        this.attach(0);
        this._timeline.build();
        this.sample();
        this.layout(measurer);
        this._timeline.compile(() => {
            this.sample();
            this.layout(measurer);
        });
        this.layout(measurer);
    }

    /**
     * Patch the built tree to play `next`, re-instantiating and recompiling only
     * what the difference touches. `false` means the change needs a fresh instance
     * (see `planTimelinePatch`); the tree is untouched then. A throw leaves the tree
     * unusable — the caller disposes it and builds fresh.
     */
    update(next: ClipDocument, duration: number): boolean {
        if (next === this._clip) {
            this._duration = duration;
            return true;
        }
        const patch = this.planUpdate(next);
        if (!patch) return false;
        this.applyUpdate(patch, next, duration);
        return true;
    }

    /** {@link update}'s plan, for a caller that has to look at the tree before it changes. */
    planUpdate(next: ClipDocument): TimelinePatch | null {
        return this._timeline.planUpdate(lowered(next));
    }

    applyUpdate(
        patch: TimelinePatch,
        next: ClipDocument,
        duration: number,
        measurer: MeasureContext2D = this._scope.measurer,
    ): void {
        this.attach(0);
        const relayout = () => {
            this.sample();
            this.layout(measurer);
        };
        this._timeline.applyUpdate(patch, relayout, relayout);
        this.layout(measurer);
        this._clip = next;
        this._doc = patch.next.doc;
        this._duration = duration;
        this._indexRows();
    }

    /** Every command as compiled, with what each writes — see `ClipTimeline.placedCommands`. */
    placedCommands(): readonly PlacedCommandInfo[] {
        return this._timeline.placedCommands();
    }

    /** What the build stepped around instead of failing — see `ClipTimeline.issues`. */
    issues(): TimelineIssue[] {
        return this._timeline.issues();
    }

    commandSounds(): PlacedSound[] {
        return this._timeline.commandSounds();
    }

    /** `read`, with the tree's presence as it stands at `seconds`; the presence is put back after. */
    atPresence<T>(seconds: number, read: () => T): T {
        const was = this._timeline.presenceTime;
        this._timeline.syncPresence(seconds);
        try {
            return read();
        } finally {
            this._timeline.syncPresence(was);
        }
    }

    evaluateAt(seconds: number, onWrite?: (index: number, slot: PropSlot<unknown>) => void): void {
        this._timeline.syncPresence(seconds);
        this._timeline.evaluateAt(seconds, onWrite);
    }

    attach(seconds: number, editor?: NodeEditorStates): void {
        this.canvas.attach({ assets: this._scope.assets, context: ContextMap.EMPTY, time: seconds });
        // Before layout, so a node that appeared this frame gets its editor state
        // on the frame it appears — and a hidden one is out of the flow before it
        // is measured.
        applyEditorStates(this.canvas, editor);
    }

    layout(measurer: MeasureContext2D = this._scope.measurer): void {
        const { width, height } = this._scope.viewport;
        this.canvas.layout({ x: 0, y: 0, width, height }, measurer);
    }

    render(pass: RenderPass2D): void {
        this.canvas.render(pass);
    }

    sample(): void {
        sampleTree(this.canvas);
    }

    primeMotion(at: number): void {
        primeMotionTree(this.canvas, at);
    }

    /** The node a document row built, mounted or not; the canvas for the root. */
    node(rowId: string): Node | undefined {
        return this._timeline.liveNode(rowId);
    }

    /** What a document row holds before any command acts on it — see `ClipTimeline.baselineProps`. */
    baselineProps(rowId: string): Record<string, unknown> | undefined {
        return this._timeline.baselineProps(rowId);
    }

    /** Every document row's effective span, the root's excepted. */
    rowSpans(): NodeSpan[] {
        return [...this._rows.values()].map((row) => row.span);
    }

    /** One row's effective span — `undefined` for the root, which spans the clip, and for an id no row has. */
    rowSpan(id: string): NodeSpan | undefined {
        return this._rows.get(id)?.span;
    }

    /**
     * `node`'s owner key as {@link forEachOwner} spells it, mounted or not —
     * `undefined` for a node no row built.
     */
    ownerKeyOf(node: Node): string | undefined {
        let below = "";
        for (let current: Node = node; ;) {
            if (current === this.canvas || this._timeline.liveNode(current.id) === current) {
                const row = current === this.canvas ? ROOT_NODE_ID : current.id;
                return below === "" ? row : `${row}/${below}`;
            }
            const parent = current.parent;
            if (!parent) return undefined;
            const index = parent._allChildren.indexOf(current);
            below = below === "" ? String(index) : `${index}.${below}`;
            current = parent;
        }
    }

    /**
     * When `node` is in the tree, in clip seconds: its document row's effective
     * span, or the nearest row ancestor's for a node a composite built. The canvas
     * spans the clip. `undefined` for a node outside this tree.
     */
    spanOf(node: Node): NodeSpan | undefined {
        for (let current: Node | null = node; current; current = current.parent) {
            if (current === this.canvas) return { start: 0, end: this.duration };
            const span = this._rowSpan(current);
            if (span) return { ...span };
        }
        return undefined;
    }

    /**
     * Visit every mounted node, parents first, with its span, its structural path
     * and its **owner key** — the nearest row's id, plus the path below that row for
     * a node a composite built. A UUID changes on every build and a path from the
     * root changes whenever an earlier sibling enters or leaves; this does neither.
     */
    forEachOwner(visit: (node: Node, ownerKey: string, span: NodeSpan, path: string) => void): void {
        const walk = (node: Node, row: string, below: string, span: NodeSpan, path: string): void => {
            if (!node.mounted) return;
            const own = node === this.canvas ? undefined : this._rowSpan(node);
            if (own) {
                row = node.id;
                below = "";
                span = own;
            }
            visit(node, below === "" ? row : `${row}/${below}`, span, path);
            const children = node._allChildren;
            for (let i = 0; i < children.length; i++) {
                walk(children[i], row, below === "" ? String(i) : `${below}.${i}`, span, nodePath(path, i));
            }
        };
        walk(this.canvas, ROOT_NODE_ID, "", { start: 0, end: this.duration }, "");
    }

    dispose(): void {
        for (const child of this.canvas.children) child.dispose();
        this.canvas.dispose();
    }

    private _clip: ClipDocument;
    private _doc: VisualDocument;
    private _duration: number;
    private readonly _timeline: ClipTimeline;
    private readonly _rows = new Map<string, { parentId: string | null; span: NodeSpan }>();

    private _indexRows(): void {
        this._rows.clear();
        const spans = effectiveSpans(this._doc.nodes);
        for (const spec of this._doc.nodes) {
            if (spec.id === ROOT_NODE_ID) continue;
            this._rows.set(spec.id, { parentId: spec.parentId, span: spans.get(spec.id)! });
        }
    }

    /**
     * `node`'s row span when a document row built it. The parent is checked as well
     * as the id, because a composite can hand its own id down to a child it builds.
     */
    private _rowSpan(node: Node): NodeSpan | undefined {
        const row = this._rows.get(node.id);
        if (!row) return undefined;
        const parent = node.parent;
        const placed = row.parentId === null || row.parentId === ROOT_NODE_ID
            ? parent === this.canvas
            : parent !== null && parent.id === row.parentId;
        return placed ? row.span : undefined;
    }
}

function lowered(clip: ClipDocument): VisualDocument {
    return clipDocument(clip);
}
