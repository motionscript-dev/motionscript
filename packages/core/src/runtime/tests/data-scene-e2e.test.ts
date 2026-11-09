import { describe, it, expect } from "vitest";
import { Registry } from "@/document/registry";
import { Rect } from "@/components/builtins/geometry/geometry";
import { Node2D, Node2DProps, NodeConfig } from "@/components/trees/2d/node2d";
import { Text } from "@/components/builtins/text/text";
import { comp, evaluatorFor, node, project, still, track } from "@/runtime/document.fixtures";
import { nodeAt } from "@/runtime/node-picking";
import type { StateEvaluator } from "@/runtime/state-evaluator";

/**
 * Mirrors the `data-scene` template showcase under the document model: a custom
 * composite node builds a `Text` child per record from a `stats` **prop**
 * (structure comes from props, so it's built in the constructor), nested under a
 * `DefaultTextStyle` (shared font) that flows *values* in through context. This
 * asserts both channels — structure-from-props children and inherited style —
 * hold through the evaluator, including seeks in both directions and a rebuild.
 */

interface Stat {
    label: string;
    value: string;
}

interface StatBoardProps extends Node2DProps {
    stats: Stat[];
}

/** Builds one Text child per stat taken from the `stats` prop — the scene's StatBoard. */
class StatBoard extends Node2D<StatBoardProps> {
    constructor(props: NodeConfig<StatBoard, StatBoardProps>) {
        super(props);
        const raw = props.stats;
        const stats = typeof raw === "function" ? raw() : raw ?? [];
        this.add(
            new Rect({
                flow: "vertical",
                children: stats.map((s) => new Text({ text: `${s.label}: ${s.value}` })),
            }),
        );
    }
}

const registry = () => new Registry({ nodes: { statBoard: StatBoard as never } });

function boardAt(ev: StateEvaluator, path: string): StatBoard {
    return nodeAt(ev.currentCanvas!, path) as StatBoard;
}

describe("data-scene — prop-built children + inherited style over the evaluator", () => {
    it("StatBoard builds its children from its prop and its Texts inherit the default font", () => {
        const stats: Stat[] = [
            { label: "Nodes", value: "1,204" },
            { label: "Frames", value: "3,600" },
            { label: "Scenes", value: "22" },
        ];
        const doc = still(
            node("style", "default-text-style", { fontSize: 44, fontFamily: "Pixelify Sans" }),
            node("board", "statBoard", { stats }, "style"),
        );

        const ev = evaluatorFor(project([track("a", doc)]), { registry: registry() });
        ev.stateAt(0);

        // Structure came from the prop: one Text per stat was built.
        const column = boardAt(ev, "0.0").children[0];
        const texts = column.children as Text[];
        expect(texts).toHaveLength(3);
        expect(texts.map((t) => t.text)).toEqual([
            "Nodes: 1,204",
            "Frames: 3,600",
            "Scenes: 22",
        ]);

        // Inherited style reached those Texts, though none set a font of their own.
        for (const t of texts) {
            expect(t.fontSize).toBe(44);
            expect(t.fontFamily).toBe("Pixelify Sans");
        }
    });

    it("seeking either way, or rebuilding, never accumulates children", () => {
        const doc = comp([node("board", "statBoard", { stats: [{ label: "A", value: "1" }, { label: "B", value: "2" }] })], [1]);
        const ev = evaluatorFor(project([track("a", doc)]), { registry: registry() });

        const expectOneBoardOfTwo = () => {
            expect(ev.currentCanvas!.children).toHaveLength(1);
            const board = boardAt(ev, "0");
            expect(board.children).toHaveLength(1);
            expect(board.children[0].children as Text[]).toHaveLength(2);
        };

        ev.stateAt(0);
        expectOneBoardOfTwo();

        ev.stateAt(9);
        ev.stateAt(0);
        expectOneBoardOfTwo();

        // A rebuild runs the constructor again, into a fresh tree.
        ev.rebuild();
        ev.stateAt(0);
        expectOneBoardOfTwo();
    });
});
