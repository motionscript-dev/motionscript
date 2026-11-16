import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node, still } from "./document.fixtures";
import { createStillRenderer, type StillRenderer } from "../src/still";
import { snapshotPixels } from "./pixels.fixtures";

/**
 * A conic gradient's seam (its first stop) sits `startAngle` degrees clockwise
 * from the box's three o'clock, and the ramp runs a full turn from there. The
 * ramp is red → blue, so just past the seam is red and just before it is blue.
 */

const SIZE = 64;
let renderer: StillRenderer;

beforeAll(async () => {
    renderer = await createStillRenderer({ viewport: { width: SIZE, height: SIZE } });
});

afterAll(() => renderer?.dispose());

const conic = (startAngle: number) => still(node("r", "rect", {
    width: "fill",
    height: "fill",
    fill: { type: "conic-gradient", colors: ["#ff0000", "#0000ff"], startAngle },
}));

/** Red and blue of the pixel `deg` degrees clockwise from three o'clock, a quarter of the box from its centre. */
function at(deg: number): { r: number; b: number } {
    const { pixels, width, height } = snapshotPixels((renderer as any).renderContext);
    const a = (deg * Math.PI) / 180, radius = Math.min(width, height) / 4;
    const x = Math.floor(width / 2 + radius * Math.cos(a)), y = Math.floor(height / 2 + radius * Math.sin(a));
    const i = (y * width + x) * 4;
    return { r: pixels[i], b: pixels[i + 2] };
}

const isRed = ({ r, b }: { r: number; b: number }) => r > 200 && b < 55;
const isBlue = ({ r, b }: { r: number; b: number }) => b > 200 && r < 55;

describe("conic gradient startAngle", () => {
    it.each([
        { startAngle: 0, seam: 0 },
        { startAngle: 90, seam: 90 },
        { startAngle: 200, seam: 200 },
        { startAngle: -90, seam: 270 },
        { startAngle: 450, seam: 90 },
    ])("$startAngle puts the seam $seam° clockwise from three o'clock", async ({ startAngle, seam }) => {
        await renderer.render(conic(startAngle));

        expect(at(seam + 20), "just past the seam").toSatisfy(isRed);
        expect(at(seam - 20), "just before the seam").toSatisfy(isBlue);
        // Half a turn on, the ramp is halfway: the full turn is used, not squeezed.
        const half = at(seam + 180);
        expect(Math.abs(half.r - half.b), `half a turn on: ${JSON.stringify(half)}`).toBeLessThan(40);
    });
});
