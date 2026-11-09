import {
    Canvas2D,
    ContextMap,
    Registry,
    type CommandSpec,
    type CompositionDocument,
    type Graphics2D,
    type GraphicsOp,
    type Node2D,
    type NodeSpec,
    type Size2D,
    type VariableSpec,
} from "@motionscript/sdk";
import { ClipTimeline, ManifestAssetCatalog, NullRenderContext, sampleTree } from "@motionscript/core";
import { NODES } from "../nodes";

export const STAGE = { width: 1000, height: 600 };

/** A render context that keeps what was drawn and measures text by the character. */
export class Recorder extends NullRenderContext {
    readonly drawn: Graphics2D[] = [];

    protected override drawGraphics(graphics: Graphics2D): void {
        this.drawn.push(graphics);
    }

    override measureText(...args: unknown[]): Size2D {
        const [text, fontSize] = args as [string, number];
        return { width: text.length * fontSize * 0.55, height: fontSize * 1.2 };
    }

    ops(): GraphicsOp[] {
        return this.drawn.flatMap((graphics) => [...graphics.ops()]);
    }
}

export type Row = Pick<NodeSpec, "id" | "type"> & { parentId?: string; props?: Record<string, unknown>; key?: string };
export type Step = Pick<CommandSpec, "type" | "targetId"> & Partial<Pick<CommandSpec, "at" | "duration" | "args">>;

/** A composition of `rows` under a stage, each a child of the one its `parentId` names or of the stage. */
export function scene(rows: Row[], steps: Step[] = [], variables: VariableSpec[] = []): CompositionDocument {
    return {
        kind: "composition",
        variables,
        nodes: [
            { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} },
            ...rows.map((row, i) => ({ parentId: "", layerOrder: i, props: {}, ...row })),
        ],
        commands: steps.map((step, i) => ({
            id: `c${i}`,
            at: 0,
            duration: 1,
            args: {},
            easing: { kind: "linear" },
            ...step,
        })),
    } as CompositionDocument;
}

export interface Played {
    /** The stage every row hangs from. */
    root: Canvas2D;
    /** The live node `id` names, at the frame last sought. */
    node<T extends Node2D>(id: string): T;
    /** Seek to `time`, lay out and draw; returns what was drawn. */
    at(time: number): Recorder;
}

/** Build `document` the way a host does and return a seek that draws a frame, however it is reached. */
export function play(document: CompositionDocument, nodes: readonly unknown[] = NODES): Played {
    const registry = new Registry({ nodes: nodes as typeof NODES });
    const canvas = new Canvas2D({ id: "", ...STAGE, flow: "freeform" } as never);
    const timeline = new ClipTimeline(document, registry, canvas);
    const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });
    const measurer = new Recorder();
    const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time });
    const layout = () => canvas.layout({ x: 0, y: 0, ...STAGE }, measurer);
    attach(0);
    timeline.build();
    layout();
    timeline.compile(() => {
        sampleTree(canvas);
        layout();
    });
    return {
        root: canvas,
        node: <T extends Node2D>(id: string) => timeline.liveNode(id) as T,
        at(time) {
            attach(time);
            timeline.syncPresence(time);
            timeline.evaluateAt(time);
            layout();
            const ctx = new Recorder();
            ctx.execute(() => canvas.render(ctx));
            return ctx;
        },
    };
}

/** A mark's ink in its system's pixels, y-up: where it is and how big. */
export function inkOf(node: Node2D): { x: number; y: number; width: number; height: number } {
    const { x, y, width, height } = node.layoutBounds;
    return { x, y: -y, width, height };
}

/** How many separate outlines the path ops in `ops` draw. */
export function contours(ops: readonly GraphicsOp[]): number {
    // A shape is drawn once for its fill and again for its stroke, from one outline.
    const seen = new Set<unknown>();
    let count = 0;
    for (const op of ops) {
        if (op.kind !== "path") continue;
        const data = (op.state as { data: unknown }).data;
        if (!Array.isArray(data) || seen.has(data)) continue;
        seen.add(data);
        count += data.filter((command: { type: string }) => command.type === "M").length;
    }
    return count;
}

export function count(ops: readonly GraphicsOp[], kind: string): number {
    return ops.filter((op) => op.kind === kind).length;
}
