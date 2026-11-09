import { describe, expect, it } from "vitest";
import type { Graphics2D } from "@motionscript/sdk";
import { play, scene, type Recorder, type Row, type Step } from "../../tests/harness";
import type { Latex } from "../node";
import { latexPartBounds } from "../typeset";

const RED = [1, 0, 0, 1];
const WHITE = [1, 1, 1, 1];

const formula = (props: Record<string, unknown> = {}): Row => ({
    id: "f",
    type: "latex",
    props: { latex: "a^2 + b", fontSize: 40, fill: "#ffffff", ...props },
});

type Solid = { color: number[]; opacity?: number };

/** Each drawn glyph's fill layers, in the order drawn. */
function fills(ctx: Recorder): Solid[][] {
    return ctx.drawn.flatMap((graphics: Graphics2D) =>
        graphics.ops().flatMap((op) => (op.kind === "fill" ? [(op as unknown as { fills: Solid[] }).fills] : [])),
    );
}

const colours = (ctx: Recorder) => fills(ctx).map((layers) => layers[layers.length - 1].color);

function run(props: Record<string, unknown>, steps: Step[] = []) {
    return play(scene([formula(props)], steps));
}

describe("a formula's part fills", () => {
    it("paint the glyphs of the part they name, and leave the rest the formula's own", () => {
        const played = run({ partFills: [{ part: "a^2", fill: "#ff0000" }] });
        expect(colours(played.at(0))).toEqual([RED, RED, WHITE, WHITE]);
    });

    it("paint every place a part is written, or the one that is asked for", () => {
        const all = run({ latex: "x + x", partFills: [{ part: "x", fill: "#ff0000" }] });
        expect(colours(all.at(0))).toEqual([RED, WHITE, RED]);
        const second = run({ latex: "x + x", partFills: [{ part: "x", fill: "#ff0000", occurrence: 2 }] });
        expect(colours(second.at(0))).toEqual([WHITE, WHITE, RED]);
    });

    it("keep an entry with no part yet, for an editor that just added it, and paint nothing by it", () => {
        const played = run({ partFills: [{ part: "", fill: "#ff0000" }, { part: "b", fill: "#ff0000" }] });
        expect(colours(played.at(0))).toEqual([WHITE, WHITE, WHITE, RED]);
        expect(played.node<Latex>("f").partFills).toHaveLength(2);
    });

    it("ignore a part the formula does not write", () => {
        const played = run({ partFills: [{ part: "q", fill: "#ff0000" }] });
        expect(colours(played.at(0))).toEqual([WHITE, WHITE, WHITE, WHITE]);
    });

    it("arrive over the formula's fill with partFillTo, and stay", () => {
        const played = run({}, [{ type: "partFillTo", targetId: "f", args: { part: "b", fill: "#ff0000" } }]);
        expect(colours(played.at(0))).toEqual([WHITE, WHITE, WHITE, WHITE]);
        const half = fills(played.at(0.5))[3];
        expect(half).toMatchObject([{ color: WHITE }, { color: RED, opacity: 0.5 }]);
        expect(colours(played.at(1))).toEqual([WHITE, WHITE, WHITE, RED]);
        expect(colours(played.at(3))).toEqual([WHITE, WHITE, WHITE, RED]);
    });

    it("add up across commands, each leaving the others' parts as they are", () => {
        const played = run({}, [
            { type: "partFillTo", targetId: "f", at: 0, args: { part: "b", fill: "#ff0000" } },
            { type: "partFillTo", targetId: "f", at: 1, args: { part: "+", fill: "#ff0000" } },
        ]);
        expect(colours(played.at(2))).toEqual([WHITE, WHITE, RED, RED]);
        // Reached by a seek, not by playing through.
        expect(colours(play(scene([formula()], [
            { type: "partFillTo", targetId: "f", at: 0, args: { part: "b", fill: "#ff0000" } },
            { type: "partFillTo", targetId: "f", at: 1, args: { part: "+", fill: "#ff0000" } },
        ])).at(2))).toEqual([WHITE, WHITE, RED, RED]);
        played.at(0.5);
        expect(colours(played.at(0))).toEqual([WHITE, WHITE, WHITE, WHITE]);
    });

    it("follow a part through a morph into a formula that still writes it", () => {
        const played = run({ partFills: [{ part: "b", fill: "#ff0000" }] }, [
            { type: "morphTo", targetId: "f", args: { latex: "b + a^2" } },
        ]);
        const mid = played.at(0.5);
        const reds = fills(mid).filter((layers) => layers[layers.length - 1].color.join() === RED.join());
        expect(reds).toHaveLength(1);
        expect(colours(played.at(1))).toEqual([RED, WHITE, WHITE, WHITE]);
    });
});

describe("where a part of a formula is", () => {
    it("is a box inside the formula, in the order the parts are written", () => {
        const played = run({});
        played.at(0);
        const node = played.node<Latex>("f");
        const term = latexPartBounds(node, "a^2")!;
        const plus = latexPartBounds(node, "+")!;
        const last = latexPartBounds(node, "b")!;
        expect(term.x).toBeLessThan(plus.x);
        expect(plus.x).toBeLessThan(last.x);
        const { width, height } = node.layoutBounds;
        for (const box of [term, plus, last]) {
            expect(Math.abs(box.x) + box.width / 2).toBeLessThanOrEqual(width / 2 + 1e-6);
            expect(Math.abs(box.y) + box.height / 2).toBeLessThanOrEqual(height / 2 + 1e-6);
        }
        // The exponent sits above the baseline, so the term reaches higher than the plain letter.
        expect(term.y + term.height / 2).toBeGreaterThan(last.y + last.height / 2 - 1e-6);
    });

    it("is nowhere for a part the formula does not write, or an occurrence past the last", () => {
        const played = run({});
        played.at(0);
        const node = played.node<Latex>("f");
        expect(latexPartBounds(node, "q")).toBeNull();
        expect(latexPartBounds(node, "b", 2)).toBeNull();
    });
});

describe("writing a formula on", () => {
    const ends = (ctx: Recorder) =>
        ctx.drawn.map((graphics: Graphics2D) => {
            const ops = graphics.ops();
            const path = ops.find((op) => op.kind === "path")!.state as { end: number };
            return { end: path.end, fills: ops.some((op) => op.kind === "fill"), strokes: ops.some((op) => op.kind === "stroke") };
        });

    it("draws nothing at 0 and the whole formula at 1", () => {
        expect(run({ written: 0 }).at(0).drawn).toHaveLength(0);
        const done = ends(run({ written: 1 }).at(0));
        expect(done).toHaveLength(4);
        expect(done.every((glyph) => glyph.end === 1 && glyph.fills)).toBe(true);
    });

    it("writes the glyphs one after another, each outlined before it is filled", () => {
        const half = ends(run({ written: 0.5 }).at(0));
        const filled = half.filter((glyph) => glyph.fills);
        const outlined = half.filter((glyph) => !glyph.fills);
        // The first glyphs are filled in, a later one is still only a line, the last is not begun.
        expect(filled.length).toBeGreaterThan(0);
        expect(outlined.some((glyph) => glyph.end > 0 && glyph.end < 1)).toBe(true);
        expect(half.length).toBeLessThan(8);
    });

    it("animates with writeTo, and seeks to any point of it", () => {
        const played = run({ written: 0 }, [{ type: "writeTo", targetId: "f", args: { written: 1 } }]);
        expect(played.at(0).drawn).toHaveLength(0);
        expect(played.at(0.5).drawn.length).toBeGreaterThan(0);
        expect(ends(played.at(1)).every((glyph) => glyph.end === 1 && glyph.fills)).toBe(true);
        expect(played.node<Latex>("f").written).toBe(1);
        expect(played.at(0).drawn).toHaveLength(0);
    });
});

describe("a morph between formulas that share terms", () => {
    it("carries each term's glyphs together, so an exponent follows its letter", () => {
        const played = play(scene([formula({ latex: "a^2 + b^2", partFills: [{ part: "a^2", fill: "#ff0000" }] })], [
            { type: "morphTo", targetId: "f", args: { latex: "b^2 + a^2" } },
        ]));
        // Mid-morph the two red glyphs are the `a` and its own `2`, still side by side.
        const mid = played.at(0.5);
        const xs = mid.drawn.flatMap((graphics: Graphics2D) => {
            const ops = graphics.ops();
            const fill = ops.find((op) => op.kind === "fill") as unknown as { fills: Solid[] } | undefined;
            if (!fill || fill.fills[fill.fills.length - 1].color.join() !== RED.join()) return [];
            const data = (ops.find((op) => op.kind === "path")!.state as { data: string }).data;
            const first = /M\s*(-?[\d.]+)/.exec(data);
            return first ? [Number(first[1])] : [];
        });
        expect(xs).toHaveLength(2);
        expect(Math.abs(xs[0] - xs[1])).toBeLessThan(60);
    });
});
