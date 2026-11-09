import { describe, expect, it } from "vitest";

import { declareMembers, property } from "@/attributes/properties/decorator";
import { Node2D, type Node2DProps, type NodeConfig } from "@/components/trees/2d/node2d";
import { evaluatorFor } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";
import { driveCommand, type Command, type CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";

import { node } from "../node-decorator";
import { asProjectDocument } from "../project";
import { Registry } from "../registry";
import type { CompositionDocument, NodeSpec } from "../types";

/**
 * A composite builds parts for itself, and its commands may write them. A part
 * is no document row, so it has no baseline of its own: without one it kept
 * whatever the last evaluation left, and a seek before the command (or back
 * past it) drew a frame that depended on how the playhead arrived.
 */

const FPS = 30;
const frame = (seconds: number) => Math.round(seconds * FPS);

interface GaugeProps extends Node2DProps { level: number }

class Gauge extends Node2D<GaugeProps> {
    declare level: number;

    constructor(props?: NodeConfig<Gauge, GaugeProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }
}

declareMembers(Gauge, {
    level: property({ default: 1 }),
});
node("test-gauge")(Gauge);

class Shell extends Node2D<Node2DProps> {
    /** A part this node builds for itself: no document row names it. */
    readonly inner = new Gauge({ level: 1 });

    constructor(props?: NodeConfig<Shell, Node2DProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
        this.add(this.inner);
    }

    /** Fades the part from its authored level to 0. */
    dim(args: CommandArgs<Record<string, never>> & { duration: number }): Command<Node2DProps> {
        return driveCommand(args.duration, (t) => {
            this.inner.set({ level: 1 - t });
        }) as unknown as Command<Node2DProps>;
    }

    /** Primes the part when the command is built, like a chart's `arm()` in `enter`. */
    primedDim(args: CommandArgs<Record<string, never>> & { duration: number }): Command<Node2DProps> {
        this.inner.set({ level: 0 });
        return driveCommand(args.duration, (t) => {
            this.inner.set({ level: 1 - t });
        }) as unknown as Command<Node2DProps>;
    }
}

declareMembers(Shell, {
    dim: command(),
    primedDim: command(),
});
node("test-shell")(Shell);

const registry = new Registry({ nodes: [Gauge, Shell] });

const row = (id: string, type: string, props: Record<string, unknown> = {}, extra: Partial<NodeSpec> = {}): NodeSpec =>
    ({ id, type, parentId: null, layerOrder: 0, props, ...extra }) as NodeSpec;

const ROOT = row("", "canvas2d");

function docWith(type: string, nodeExtra: Partial<NodeSpec> = {}): CompositionDocument {
    return {
        kind: "composition",
        nodes: [ROOT, row("shell", "test-shell", {}, nodeExtra)],
        commands: [{ id: "c1", type, targetId: "shell", at: 1, duration: 1, args: {} }],
    } as CompositionDocument;
}

const evaluatorOver = (d: CompositionDocument): StateEvaluator =>
    evaluatorFor(asProjectDocument(d, { fps: FPS, viewport: { width: 200, height: 200 } }), { registry });

/** The part's level as the frame at `seconds` leaves it. */
function levelAt(evaluator: StateEvaluator, seconds: number): number {
    evaluator.stateAt(frame(seconds));
    const shell = evaluator.currentCanvas!.children.find((c): c is Shell => c instanceof Shell)!;
    return shell.inner.level;
}

describe.each([["dim"], ["primedDim"]])("a part a %s command writes", (type) => {
    it("holds its authored value before the command starts", () => {
        expect(levelAt(evaluatorOver(docWith(type)), 0)).toBe(1);
        expect(levelAt(evaluatorOver(docWith(type)), 0.5)).toBe(1);
    });

    it("is driven by the command, and held at its end", () => {
        const evaluator = evaluatorOver(docWith(type));
        expect(levelAt(evaluator, 1.5)).toBeCloseTo(0.5, 5);
        expect(levelAt(evaluator, 2.5)).toBeCloseTo(0, 5);
    });

    it("answers the same frame however the playhead reached it", () => {
        const evaluator = evaluatorOver(docWith(type));
        const forward = levelAt(evaluator, 1.5);
        levelAt(evaluator, 2.5);
        expect(levelAt(evaluator, 1.5)).toBe(forward);
    });

    it("restores it on a seek back past the command", () => {
        const evaluator = evaluatorOver(docWith(type));
        levelAt(evaluator, 2.5);
        expect(levelAt(evaluator, 0)).toBe(1);
    });
});

describe("a part of a node that enters after the command's document starts", () => {
    it("keeps its authored value until the command, then follows it", () => {
        const evaluator = evaluatorOver({
            ...docWith("dim", { startAt: 0.5 } as Partial<NodeSpec>),
        });
        // Absent at 0.25, present from 0.5: read the part off the row's node.
        evaluator.stateAt(frame(2.5));
        expect(levelAt(evaluator, 0.75)).toBe(1);
        expect(levelAt(evaluator, 1.5)).toBeCloseTo(0.5, 5);
    });
});
