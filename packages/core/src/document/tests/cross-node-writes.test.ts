import { describe, expect, it } from "vitest";

import { declareMembers, property } from "@/attributes/properties/decorator";
import { Node2D, type Node2DProps, type NodeConfig } from "@/components/trees/2d/node2d";
import type { Node } from "@/components/trees/node/node";
import { evaluatorFor } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";
import { driveCommand, type Command, type CommandArgs } from "@/tween/command";
import { command } from "@/tween/command-decorator";

import { node } from "../node-decorator";
import { asProjectDocument } from "../project";
import { Registry } from "../registry";
import type { CompositionDocument, NodeSpec } from "../types";

/**
 * A command is free to write a node other than its target — `Cursor.click`
 * names a control and throws it. What that costs the timeline is a baseline:
 * a node no command *targets* was never restored, so it kept whatever the last
 * evaluation left and the frame stopped being a pure function of its time.
 * These cover `ClipTimeline._touch` reaching the written node through
 * `PlacedCommand.writes`.
 */

const FPS = 30;
/** `stateAt` takes a frame, not seconds. */
const frame = (seconds: number) => Math.round(seconds * FPS);

interface DialProps extends Node2DProps { level: number }

class Dial extends Node2D<DialProps> {
    declare level: number;

    constructor(props?: NodeConfig<Dial, DialProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }
}

declareMembers(Dial, {
    level: property({ default: 0 }),
});
node("test-dial")(Dial);

interface DriverProps extends Node2DProps { reach: number }

class Driver extends Node2D<DriverProps> {
    declare reach: number;

    constructor(props?: NodeConfig<Driver, DriverProps>) {
        super(props as NodeConfig<Node2D, Node2DProps>);
    }

    /** Drives *another* node's `level`, resolved by document id off the live tree. */
    driveOther(
        args: CommandArgs<{ target?: string }> & { duration: number },
    ): Command<DriverProps> {
        const dial = findById(this, args.data?.target);
        return driveCommand(args.duration, (t) => {
            this.set({ reach: t } as Partial<DriverProps>);
            dial?.set({ level: t } as Partial<DialProps>);
        }) as unknown as Command<DriverProps>;
    }
}

declareMembers(Driver, {
    reach: property({ default: 0 }),

    driveOther: command({ args: [{ key: "target", kind: "nodeRef" }] }),
});
node("test-driver")(Driver);

/** The node `id` names, from the root of whatever tree `from` sits in. */
function findById(from: Node, id: string | undefined): Dial | undefined {
    if (id === undefined) return undefined;
    let root: Node = from;
    while (root.parent) root = root.parent;
    const walk = (at: Node): Dial | undefined => {
        if (at.id === id) return at instanceof Dial ? at : undefined;
        for (const child of at._allChildren) {
            const found = walk(child);
            if (found) return found;
        }
        return undefined;
    };
    return walk(root);
}

const registry = new Registry({ nodes: [Dial, Driver] });

function row(id: string, type: string, props: Record<string, unknown> = {}): NodeSpec {
    return { id, type, parentId: null, layerOrder: 0, props };
}

const doc: CompositionDocument = {
    kind: "composition",
    nodes: [
        { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} },
        row("dial", "test-dial", { level: 0 }),
        row("driver", "test-driver", {}),
    ],
    commands: [
        { id: "c1", type: "driveOther", targetId: "driver", at: 1, duration: 1, args: { target: "dial" } },
    ],
};

const evaluatorOver = (d: CompositionDocument): StateEvaluator =>
    evaluatorFor(asProjectDocument(d, { fps: FPS, viewport: { width: 200, height: 200 } }), {
        registry,
    });

/** The dial's `level` and the driver's `reach` as the frame at `seconds` leaves them. */
function readAt(evaluator: StateEvaluator, seconds: number): { level: number; reach: number } {
    evaluator.stateAt(frame(seconds));
    const children = evaluator.currentCanvas!.children;
    const dial = children.find((c): c is Dial => c instanceof Dial)!;
    const driver = children.find((c): c is Driver => c instanceof Driver)!;
    return { level: dial.level, reach: driver.reach };
}

describe("a command that writes a node it does not target", () => {
    it("holds the written node at its baseline before the command starts", () => {
        expect(readAt(evaluatorOver(doc), 0)).toEqual({ level: 0, reach: 0 });
    });

    it("drives it alongside the command's own target", () => {
        const evaluator = evaluatorOver(doc);
        expect(readAt(evaluator, 1.5).level).toBeCloseTo(0.5, 5);
        expect(readAt(evaluator, 2).level).toBeCloseTo(1, 5);
    });

    it("answers the same frame however the playhead reached it", () => {
        const evaluator = evaluatorOver(doc);
        const forward = readAt(evaluator, 1.5).level;
        readAt(evaluator, 2.5);
        expect(readAt(evaluator, 1.5).level).toBe(forward);
    });

    it("restores it on a seek back past the command", () => {
        const evaluator = evaluatorOver(doc);
        readAt(evaluator, 2.5);
        expect(readAt(evaluator, 0)).toEqual({ level: 0, reach: 0 });
    });
});
