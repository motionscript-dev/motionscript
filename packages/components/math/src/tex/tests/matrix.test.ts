import { describe, expect, it } from "vitest";
import { play, scene, type Row, type Step } from "../../tests/harness";
import type { LatexMatrix } from "../matrix";
import { latexPartBounds } from "../typeset";
import { buildLatexPath } from "../geometry";

const matrix = (props: Record<string, unknown> = {}): Row => ({ id: "m", type: "latexMatrix", props: { fontSize: 40, ...props } });

function run(props: Record<string, unknown> = {}, steps: Step[] = []) {
    return play(scene([matrix(props)], steps));
}

describe("a matrix", () => {
    it("is typeset from its entries, row by row, in the brackets it is given", () => {
        const played = run({ entries: [["1", "0"], ["0", "1"]] });
        const drawn = played.at(0).drawn.length;
        const formula = buildLatexPath("\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}", 40);
        expect(drawn).toBe(formula.tokens.length);
        expect(played.node("m").layoutBounds.width).toBeCloseTo(formula.width, 6);

        const round = run({ entries: [["1", "0"], ["0", "1"]], brackets: "round" });
        const bare = run({ entries: [["1", "0"], ["0", "1"]], brackets: "none" });
        round.at(0);
        // Without brackets it is only its four entries, and narrower for it.
        expect(bare.at(0).drawn).toHaveLength(4);
        expect(bare.node("m").layoutBounds.width).toBeLessThan(round.node("m").layoutBounds.width);
    });

    it("draws nothing with no entries", () => {
        expect(run({ entries: [] }).at(0).drawn).toHaveLength(0);
    });

    it("has each entry as a part, by its own source", () => {
        const played = run({ entries: [["x^2", "0"], ["0", "y"]] });
        played.at(0);
        const node = played.node<LatexMatrix>("m");
        const corner = latexPartBounds(node, "x^2")!;
        const other = latexPartBounds(node, "y")!;
        expect(corner.x).toBeLessThan(other.x);
        expect(corner.y).toBeGreaterThan(other.y);
        expect(latexPartBounds(node, "0", 2)).not.toBeNull();
        expect(latexPartBounds(node, "q")).toBeNull();
    });

    it("morphs to new entries with entriesTo, and seeks back to the old ones", () => {
        const played = run({ entries: [["a", "b"], ["c", "d"]] }, [
            { type: "entriesTo", targetId: "m", args: { entries: [["a", "b", "e"], ["c", "d", "f"]] } },
        ]);
        const before = played.at(0).drawn.length;
        const narrow = played.node("m").layoutBounds.width;
        played.at(0.5);
        expect(played.node("m").layoutBounds.width).toBeGreaterThan(narrow);
        const after = played.at(1).drawn.length;
        expect(after).toBe(before + 2);
        expect(played.node<LatexMatrix>("m").entries).toEqual([["a", "b", "e"], ["c", "d", "f"]]);
        expect(played.at(0).drawn).toHaveLength(before);
        expect(played.node<LatexMatrix>("m").entries).toEqual([["a", "b"], ["c", "d"]]);
    });
});
