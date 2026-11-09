import { describe, expect, it } from "vitest";
import { PathBuilder } from "@/render/descriptors/path-builder";
import { pathOps } from "@/attributes/shape/path/ops";
import type { EllipseArc } from "@/render/descriptors/path-builder";

/**
 * `PathBuilder.arc` writes an open ellipse arc as quarter-turn `A` commands in
 * the y-up space a node's `x`/`y` live in (angles from 3 o'clock, positive
 * counter-clockwise), and `pathOps.sampler` walks the result by arc length. These
 * cases, which began as a probe that only printed, pin what that pairing gives for
 * the sweeps a document is likely to write: where the curve starts, where it is
 * half way and where it ends, and how long it is.
 */
interface Case {
    name: string;
    arc: EllipseArc;
    /** Pen position set with `moveTo` before the arc, if any. */
    from?: [number, number];
    /** `M` plus one `A` per started quarter turn (plus the joining `L` after a `moveTo`). */
    commands: number;
    length: number;
    start: [number, number];
    /** A quarter of the way along, by length. */
    quarter?: [number, number];
    middle: [number, number];
    end: [number, number];
}

const R = 300;
const ON45 = R * Math.SQRT1_2;

const CASES: Case[] = [
    {
        name: "180 -> 0 over the top (the document example)",
        arc: { width: 600, startAngle: 180, sweep: -180 },
        commands: 3, length: Math.PI * R,
        start: [-R, 0], quarter: [-ON45, ON45], middle: [0, R], end: [R, 0],
    },
    {
        name: "180 -> 360 under the bottom",
        arc: { width: 600, startAngle: 180, sweep: 180 },
        commands: 3, length: Math.PI * R,
        start: [-R, 0], quarter: [-ON45, -ON45], middle: [0, -R], end: [R, 0],
    },
    {
        name: "a full turn, counter-clockwise",
        arc: { width: 600 },
        commands: 5, length: 2 * Math.PI * R,
        start: [R, 0], quarter: [0, R], middle: [-R, 0], end: [R, 0],
    },
    {
        name: "a full turn, clockwise",
        arc: { width: 600, sweep: -360 },
        commands: 5, length: 2 * Math.PI * R,
        start: [R, 0], quarter: [0, -R], middle: [-R, 0], end: [R, 0],
    },
    {
        name: "a quarter turn up",
        arc: { width: 600, sweep: 90 },
        commands: 2, length: Math.PI * R / 2,
        start: [R, 0], middle: [ON45, ON45], end: [0, R],
    },
    {
        name: "a quarter turn down",
        arc: { width: 600, sweep: -90 },
        commands: 2, length: Math.PI * R / 2,
        start: [R, 0], middle: [ON45, -ON45], end: [0, -R],
    },
    {
        name: "100 degrees, split into two equal pieces",
        arc: { width: 600, sweep: 100 },
        commands: 3, length: R * 100 * Math.PI / 180,
        start: [R, 0],
        middle: [R * Math.cos(50 * Math.PI / 180), R * Math.sin(50 * Math.PI / 180)],
        end: [R * Math.cos(100 * Math.PI / 180), R * Math.sin(100 * Math.PI / 180)],
    },
    {
        name: "200 degrees, split into three equal pieces",
        arc: { width: 600, sweep: 200 },
        commands: 4, length: R * 200 * Math.PI / 180,
        start: [R, 0],
        middle: [R * Math.cos(100 * Math.PI / 180), R * Math.sin(100 * Math.PI / 180)],
        end: [R * Math.cos(200 * Math.PI / 180), R * Math.sin(200 * Math.PI / 180)],
    },
    {
        name: "45 -> -45 across 3 o'clock",
        arc: { width: 600, startAngle: 45, sweep: -90 },
        commands: 2, length: Math.PI * R / 2,
        start: [ON45, ON45], middle: [R, 0], end: [ON45, -ON45],
    },
    {
        name: "two full turns",
        arc: { width: 600, sweep: 720 },
        commands: 9, length: 4 * Math.PI * R,
        start: [R, 0], quarter: [-R, 0], middle: [R, 0], end: [R, 0],
    },
    {
        name: "an ellipse 800 x 200, 180 -> 0 over the top",
        arc: { width: 800, height: 200, startAngle: 180, sweep: -180 },
        commands: 3,
        // Half of Ramanujan's approximation of the perimeter, for semi-axes 400 and 100.
        length: Math.PI * (3 * 500 - Math.sqrt((3 * 400 + 100) * (400 + 3 * 100))) / 2,
        start: [-400, 0], middle: [0, 100], end: [400, 0],
    },
    {
        name: "a circle centred away from the origin",
        arc: { x: 100, y: 50, width: 600, startAngle: 180, sweep: -180 },
        commands: 3, length: Math.PI * R,
        start: [-200, 50], middle: [100, 350], end: [400, 50],
    },
];

function builderFor(c: Case): PathBuilder {
    const builder = new PathBuilder();
    if (c.from) builder.moveTo(c.from[0], c.from[1]);
    return builder.arc(c.arc);
}

function expectPoint(frame: { x: number; y: number } | null, expected: [number, number]) {
    expect(frame).not.toBeNull();
    expect(frame!.x).toBeCloseTo(expected[0], 2);
    expect(frame!.y).toBeCloseTo(expected[1], 2);
}

describe("PathBuilder.arc, walked by the sampler", () => {
    for (const c of CASES) {
        it(c.name, () => {
            const commands = builderFor(c).toCommands();
            expect(commands.map((cmd) => cmd.type)).toEqual(["M", ...Array(c.commands - 1).fill("A")]);

            const sampler = pathOps.sampler(commands);
            // Each arc is flattened to 50 chords, so the length is the true one to within a tenth of a percent.
            expect(Math.abs(sampler.length / c.length - 1)).toBeLessThan(1e-3);

            expectPoint(sampler.frameAt(0), c.start);
            if (c.quarter) expectPoint(sampler.frameAt(sampler.length / 4), c.quarter);
            expectPoint(sampler.frameAt(sampler.length / 2), c.middle);
            expectPoint(sampler.frameAt(sampler.length), c.end);
        });
    }

    it("joins a pen that is elsewhere to the arc's start with a straight line, not a new subpath", () => {
        const commands = new PathBuilder().moveTo(-500, 0).arc({ width: 600, startAngle: 180, sweep: -180 }).toCommands();
        expect(commands.map((c) => c.type)).toEqual(["M", "L", "A", "A"]);
        expect(commands[1]).toMatchObject({ type: "L", x: -300 });

        const sampler = pathOps.sampler(commands);
        // 200 of line, then the semicircle.
        expect(Math.abs(sampler.length / (200 + Math.PI * R) - 1)).toBeLessThan(1e-3);
        expectPoint(sampler.frameAt(0), [-500, 0]);
        expectPoint(sampler.frameAt(200), [-300, 0]);
        expectPoint(sampler.frameAt(sampler.length), [R, 0]);
        expect(pathOps.contours(commands)).toHaveLength(1);
    });

    it("does not draw a join when the pen is already at the arc's start", () => {
        const commands = new PathBuilder().moveTo(300, 0).arc({ width: 600, sweep: 90 }).toCommands();
        expect(commands.map((c) => c.type)).toEqual(["M", "A"]);
    });

    it("draws nothing past the opening move for a sweep of 0", () => {
        const commands = new PathBuilder().arc({ width: 600, sweep: 0 }).toCommands();
        expect(commands).toEqual([{ type: "M", x: 300, y: 0 }]);
        const sampler = pathOps.sampler(commands);
        expect(sampler.length).toBe(0);
        expect(sampler.frameAt(0)).toBeNull();
    });

    it("reads a negative sweep as clockwise: the arc's sweep flag is 0, a positive one is 1", () => {
        const flags = (sweep: number) => (new PathBuilder().arc({ width: 600, sweep }).toCommands()[1] as { sweep: number }).sweep;
        expect(flags(-90)).toBe(0);
        expect(flags(90)).toBe(1);
    });

    it("emits quarter-turn arcs that each stay a minor arc", () => {
        const commands = new PathBuilder().arc({ width: 600, sweep: 270 }).toCommands();
        const arcs = commands.filter((c) => c.type === "A");
        expect(arcs).toHaveLength(3);
        for (const arc of arcs) expect(arc).toMatchObject({ rx: 300, ry: 300, rotation: 0, largeArc: 0 });
    });
});
