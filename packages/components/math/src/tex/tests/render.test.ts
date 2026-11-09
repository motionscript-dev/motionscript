import { describe, expect, it } from "vitest";
import type { GraphicsOp } from "@motionscript/sdk";

import { play, scene, type Step } from "../../tests/harness";

/** The ops each glyph of the formula `x` is drawn with, in order, at `time`. */
function opsFor(props: Record<string, unknown>, steps: Step[] = [], time = 0): GraphicsOp[][] {
    const played = play(scene([{ id: "f", type: "latex", props: { latex: "x", fontSize: 100, ...props } }], steps));
    return played.at(time).drawn.map((graphics) => [...graphics.ops()]);
}

const SHADOW = { blur: 4, offset: { x: 0, y: 2 }, fill: "#000000" };

describe("a formula's paint", () => {
    /**
     * The regression this file exists for. A shadow op is not drawn where it
     * appears — the renderer stores it and the *next* fill or stroke casts it —
     * so a shadow appended after both painted nothing at all, silently.
     */
    it("records the shadow before the paint that casts it", () => {
        const [glyph] = opsFor({ fill: "#ffffff", shadow: SHADOW });
        const kinds = glyph.map((op) => op.kind);
        expect(kinds.indexOf("shadow")).toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf("shadow")).toBeLessThan(kinds.indexOf("fill"));
    });

    /** A transparent formula still casts one: the stroke picks up the pending shadow. */
    it("records the shadow before the stroke on a fill-less formula", () => {
        const [glyph] = opsFor({ fill: "transparent", stroke: { weight: 2, fill: "#ffffff" }, shadow: SHADOW });
        const kinds = glyph.map((op) => op.kind);
        expect(kinds.indexOf("shadow")).toBeLessThan(kinds.indexOf("stroke"));
    });

    /** A morphing token fades, and its shadow fades with it — as its fill does. */
    it("scales the shadow's paints by the token's opacity", () => {
        // Into a formula with no `x`, which fades out over the morph's first half.
        const glyphs = opsFor({ fill: "#ffffff", shadow: SHADOW }, [{ type: "morphTo", targetId: "f", args: { latex: "y" } }], 0.25);
        expect(glyphs).toHaveLength(1);
        const shadow = glyphs[0].find((op) => op.kind === "shadow") as unknown as { shadows: { fill: { opacity: number }[] }[] };
        expect(shadow.shadows[0].fill[0].opacity).toBeCloseTo(0.5);
    });
});
