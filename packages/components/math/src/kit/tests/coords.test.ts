import { describe, expect, it } from "vitest";
import type { Extents } from "@motionscript/sdk";
import { axisScale, cartesianMap, PIXEL_MAP, resolveInterval } from "../coords";
import { formatTick, ticksFor } from "../ticks";

const AREA: Extents = { minX: -400, minY: -200, maxX: 400, maxY: 200 };

describe("a coordinate map", () => {
    it("spreads each range over the plot area and back", () => {
        const map = cartesianMap({ xRange: [-4, 4], yRange: [0, 10], area: AREA });
        expect(map.toPoint(0, 0)).toEqual({ x: 0, y: -200 });
        expect(map.toPoint(4, 10)).toEqual({ x: 400, y: 200 });
        expect(map.toCoords(200, 0)).toEqual({ x: 2, y: 5 });
    });

    it("writes into the point it is handed", () => {
        const map = cartesianMap({ xRange: [0, 1], yRange: [0, 1], area: AREA });
        const out = { x: 0, y: 0 };
        expect(map.toPoint(1, 1, out)).toBe(out);
        expect(out).toEqual({ x: 400, y: 200 });
    });

    it("puts a decade the same distance apart on a log axis", () => {
        const scale = axisScale([1, 1000], 0, 300, "log");
        expect(scale.to(1)).toBeCloseTo(0, 9);
        expect(scale.to(10)).toBeCloseTo(100, 9);
        expect(scale.to(100)).toBeCloseTo(200, 9);
        expect(scale.from(250)).toBeCloseTo(10 ** 2.5, 6);
    });

    it("changes its revision when anything that moves a point does", () => {
        const base = { xRange: [-4, 4] as const, yRange: [-2, 2] as const, area: AREA };
        const revision = cartesianMap(base).revision;
        expect(cartesianMap(base).revision).toBe(revision);
        expect(cartesianMap({ ...base, xRange: [-4, 5] }).revision).not.toBe(revision);
        expect(cartesianMap({ ...base, yScaling: "log", yRange: [1, 2] }).revision).not.toBe(revision);
        expect(cartesianMap({ ...base, area: { ...AREA, maxX: 300 } }).revision).not.toBe(revision);
    });

    it("makes a range it can divide by out of whatever it is given", () => {
        expect(resolveInterval([3, -1])).toEqual([-1, 3]);
        expect(resolveInterval([2, 2])).toEqual([2, 3]);
        expect(resolveInterval([NaN, 4])).toEqual([0, 1]);
        expect(resolveInterval(undefined)).toEqual([0, 1]);
        expect(resolveInterval([-5, 100], "log")).toEqual([0.1, 100]);
        expect(resolveInterval([-5, -1], "log")).toEqual([0.01, 10]);
    });

    it("is pixels outside any system", () => {
        expect(PIXEL_MAP.toPoint(3, -7)).toEqual({ x: 3, y: -7 });
        expect(PIXEL_MAP.toCoords(3, -7)).toEqual({ x: 3, y: -7 });
    });
});

describe("ticks", () => {
    it("lands on multiples of the step, without float drift", () => {
        expect(ticksFor([-1, 1], 0.5, 400).values).toEqual([-1, -0.5, 0, 0.5, 1]);
        expect(ticksFor([0, 1], 0.1, 400).values[3]).toBe(0.30000000000000004);
        expect(formatTick(0.30000000000000004, 0.1)).toBe("0.3");
    });

    it("picks a tidy step for the axis's length when given none", () => {
        expect(ticksFor([-5, 5], 0, 800).step).toBe(1);
        expect(ticksFor([-5, 5], 0, 200).step).toBe(5);
        expect(ticksFor([0, 1], 0, 800).step).toBe(0.1);
        expect(ticksFor([0, 1000], 0, 400).step).toBe(200);
    });

    it("marks a log axis at the powers of ten", () => {
        const { values, step } = ticksFor([0.5, 2000], 0, 600, "log");
        expect(values).toEqual([1, 10, 100, 1000]);
        expect(step).toBe(0);
        expect(formatTick(1000, 0)).toBe("1000");
        expect(formatTick(1e9, 0)).toBe("1e9");
    });

    it("draws no ticks rather than a solid bar of them", () => {
        expect(ticksFor([0, 1000], 0.5, 400).values).toEqual([]);
        expect(ticksFor([3, 3], 1, 400).values).toEqual([]);
    });

    it("labels with the decimals the step needs", () => {
        expect(formatTick(2, 0.5)).toBe("2");
        expect(formatTick(2.5, 0.5)).toBe("2.5");
        expect(formatTick(0, 0.25)).toBe("0");
        expect(formatTick(-0.75, 0.25)).toBe("-0.75");
        expect(formatTick(3000000, 1000000)).toBe("3e6");
    });
});
