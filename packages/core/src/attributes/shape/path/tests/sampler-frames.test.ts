import { pathOps } from "../ops";
import { describe, expect, it } from "vitest";

import { PathBuilder } from "@/render/descriptors/path-builder";

/**
 * Frames pinned to six decimal places, for the two paths that actually reach a
 * user through the sampler.
 *
 * Written *before* the sampler was rebuilt on the shared pen walk, and asserting
 * the old implementation's exact output, so it answers the one question a
 * refactor of this code cannot answer any other way: whether a glyph moved.
 * `text-on-path` shapes its run against `frameAt` and `moveTo({ path })` places
 * a node with it — neither has a unit test that would notice a sub-pixel drift,
 * and the pixel diff that would notice it costs ninety seconds.
 *
 * If a change here is deliberate, re-pin it in the same commit and say why.
 */
const TEXT_PATH = "M -320 80 Q 0 -260 320 80";

/** What `moveTo({ path })` walks: four `A` quarter-arcs, the arc-exactness guard. */
const ELLIPSE = new PathBuilder().ellipse({ width: 400 }).toCommands();

/** `-0` folded to `0`: the two are the same coordinate, and `toEqual` disagrees. */
const round = (value: number) => Number(value.toFixed(6)) + 0;

function framesOf(sampler: ReturnType<typeof pathOps.sampler>, count: number) {
    return Array.from({ length: count + 1 }, (_, i) => {
        const frame = sampler.frameAt((sampler.length * i) / count)!;
        return [round(frame.x), round(frame.y), round(frame.tx), round(frame.ty)];
    });
}

describe("sampler frames stay put", () => {
    it("text-on-path's quadratic", () => {
        const sampler = pathOps.sampler(TEXT_PATH);
        expect(Number(sampler.length.toFixed(6))).toBe(745.42516);
        expect(framesOf(sampler, 4)).toEqual([
            [-320, 80, 0.692676, -0.721249],
            [-176.680299, -38.133678, 0.867374, -0.497656],
            [0, -90, 0.999774, 0.021245],
            [176.680299, -38.133678, 0.867374, 0.497656],
            [320, 80, 0.692676, 0.721249],
        ]);
    });

    it("moveTo's arc-built ellipse", () => {
        const sampler = pathOps.sampler(ELLIPSE);
        // 2 pi r is 1256.637; the 0.05 shortfall is the 50-step flattening, and
        // pinning it is the point — a change here means the resolution moved.
        expect(Number(sampler.length.toFixed(6))).toBe(1256.585385);
        // The tangents are chord-derived, so the true (0, 1) at the seam reads as
        // (-0.0157, 0.9999) and flips sign at the wrap. Analytic tangents would be
        // better and would move every glyph on a path, so that is its own change.
        expect(framesOf(sampler, 8)).toEqual([
            [200, 0, -0.015707, 0.999877],
            [141.421356, 141.421356, -0.718126, 0.695913],
            [0, 200, -0.999877, -0.015707],
            [-141.421356, 141.421356, -0.695913, -0.718126],
            [-200, 0, 0.015707, -0.999877],
            [-141.421356, -141.421356, 0.718126, -0.695913],
            [0, -200, 0.999877, 0.015707],
            [141.421356, -141.421356, 0.695913, 0.718126],
            [200, 0, 0.015707, 0.999877],
        ]);
    });
});
