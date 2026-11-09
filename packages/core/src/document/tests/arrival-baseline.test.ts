import { describe, expect, it } from "vitest";

import type { Text } from "@/components/builtins/text/text";
import { evaluatorFor, project, track, FPS } from "@/runtime/document.fixtures";
import type { StateEvaluator } from "@/runtime/state-evaluator";

import type { CompositionDocument, NodeSpec } from "../types";

/**
 * A baseline is the node as it stands once attached. A child can enter before
 * its parent does; its baseline must wait for the parent, or evaluation restores
 * the pre-attach values over what the child inherits from it.
 */

const row = (id: string, type: string, props: Record<string, unknown>, parentId: string | null, extra: object = {}): NodeSpec =>
    ({ id, type, parentId, layerOrder: 0, props, ...extra }) as NodeSpec;

const ROOT = row("", "canvas2d", {}, null);

/** `style` provides a font size from 3 s; the text under it enters at `textStart`. */
function doc(textStart: number): CompositionDocument {
    return {
        kind: "composition",
        nodes: [
            ROOT,
            row("style", "default-text-style", { fontSize: 40 }, "", { startAt: 3 }),
            row("label", "text", { text: "hi" }, "style", { startAt: textStart }),
        ],
        commands: [
            // A step between the child's start and its parent's: the walk syncs here, with the parent still out.
            { id: "c0", type: "to", targetId: null, at: 2, duration: 0.5, args: { opacity: 0.9 } },
            { id: "c1", type: "to", targetId: "label", at: 3.5, duration: 1, args: { opacity: 0.5 } },
        ],
        duration: 6,
    } as CompositionDocument;
}

const evaluatorOver = (d: CompositionDocument): StateEvaluator =>
    evaluatorFor(project([track("t", d)], { fps: FPS }));

function fontSizeAt(evaluator: StateEvaluator, seconds: number): number {
    evaluator.stateAt(Math.round(seconds * FPS));
    const find = (at: { children: readonly unknown[] }): Text | undefined => {
        for (const child of at.children as Array<{ id: string; children: readonly unknown[] }>) {
            if ((child as unknown as Text).text !== undefined && child.id === "label") return child as unknown as Text;
            const found = find(child);
            if (found) return found;
        }
        return undefined;
    };
    return find(evaluator.currentCanvas!)!.fontSize as number;
}

describe("a child that enters before its parent", () => {
    it("reads what it inherits once the parent is there, as one entering with it does", () => {
        const together = fontSizeAt(evaluatorOver(doc(3)), 4);
        expect(together).toBe(40);
        expect(fontSizeAt(evaluatorOver(doc(1)), 4)).toBe(together);
    });

    it("reads it the same on a seek back and forward", () => {
        const evaluator = evaluatorOver(doc(1));
        const first = fontSizeAt(evaluator, 4);
        fontSizeAt(evaluator, 5.5);
        fontSizeAt(evaluator, 3.2);
        expect(fontSizeAt(evaluator, 4)).toBe(first);
    });
});
