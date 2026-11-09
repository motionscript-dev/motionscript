import { describe, expect, it } from "vitest";

import { pathOps } from "../ops";
import type { PathCommand } from "@/render/descriptors/path";

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.freeze(value);
        for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
}

const VECTOR = () => [{
    closed: true,
    anchors: [
        { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 2, y: 4 } },
        { point: { x: 10, y: 5 }, inHandle: { x: 8, y: 9 }, outHandle: null },
        { point: { x: 4, y: 12 }, inHandle: null, outHandle: null },
    ],
}];

const SQUARE: () => PathCommand[] = () => [
    { type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 },
    { type: "L", x: 0, y: 10 }, { type: "Z" },
];
const CIRCLE: () => PathCommand[] = () => [
    { type: "M", x: 10, y: 0 },
    { type: "A", rx: 10, ry: 10, rotation: 0, largeArc: 1, sweep: 1, x: -10, y: 0 },
    { type: "A", rx: 10, ry: 10, rotation: 0, largeArc: 1, sweep: 1, x: 10, y: 0 },
    { type: "Z" },
];

describe("pathOps.resolve", () => {
    it("is the identity on a string, and on a command list by reference", () => {
        const d = "M 0 0 L 10 10";
        const list = SQUARE();
        expect(pathOps.resolve(d)).toBe(d);
        expect(pathOps.resolve(list)).toBe(list);
        expect(pathOps.resolve("")).toBe("");
    });
});

describe("pathOps never writes to its arguments", () => {
    // Every argument is deeply frozen, so a write throws (modules are strict) and
    // a method that copies, or only reads, is the only one that passes.
    it("reads a frozen command list in every way", () => {
        const list = deepFreeze(SQUARE());
        const curve = deepFreeze(CIRCLE());
        expect(() => {
            pathOps.commands(list);
            pathOps.contours(list);
            pathOps.cubics(list);
            pathOps.anchors(list);
            pathOps.bounds(list);
            pathOps.size(list);
            pathOps.length(list);
            pathOps.sampler(list).frameAt(15);
            pathOps.trim(list, 0.2, 0.8);
            pathOps.dash(list, [3, 2], 1);
            pathOps.plan(list, curve);
            pathOps.lerp(list, curve, 0.5);
            pathOps.lerp(curve, list, 0.5);
        }).not.toThrow();
    });

    it("reads a frozen pattern and contour description", () => {
        const pattern = deepFreeze([4, 2]);
        const contour = deepFreeze({ length: 100, closed: false });
        expect(() => pathOps.dashScale(pattern, contour, 100)).not.toThrow();
        expect(() => pathOps.dash("M 0 0 L 100 0", pattern, 1)).not.toThrow();
    });

    it("reads and returns a frozen plan", () => {
        const planned = pathOps.plan(SQUARE(), CIRCLE());
        const before = JSON.stringify(planned);
        deepFreeze(planned);
        expect(() => pathOps.sample(planned, 0.5)).not.toThrow();
        expect(JSON.stringify(planned)).toBe(before);
    });

    it("reads a frozen anchor path in every way", () => {
        const path = deepFreeze(VECTOR());
        const before = JSON.stringify(path);
        expect(() => {
            pathOps.fromAnchors(path);
            pathOps.anchorCommands(path);
            pathOps.anchorCommands(path, (p) => ({ x: p.x + 1, y: p.y + 1 }));
            pathOps.anchorBounds(path);
            pathOps.map(path, (p) => ({ x: p.x * 2, y: p.y * 2 }));
            pathOps.translate(path, { x: 1, y: 2 });
            pathOps.isEmpty(path);
            pathOps.normalize(path);
            pathOps.fitToBox(path, { minX: 0, minY: 0, maxX: 5, maxY: 5 });
            pathOps.pointOn(path[0].anchors[0], path[0].anchors[1], 0.5);
            pathOps.split(path[0].anchors[0], path[0].anchors[1], 0.5);
            pathOps.endFit({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 });
        }).not.toThrow();
        expect(JSON.stringify(path)).toBe(before);
    });

    it("leaves a command list's content as it was after being read", () => {
        const list = SQUARE();
        const before = JSON.stringify(list);
        pathOps.contours(list);
        pathOps.anchors(list);
        pathOps.trim(list, 0.1, 0.9);
        pathOps.lerp(list, CIRCLE(), 0.5);
        expect(JSON.stringify(list)).toBe(before);
    });
});

describe("the documented pass-throughs", () => {
    it("returns a command list from `commands` by reference, and nothing as an empty list", () => {
        const list = SQUARE();
        expect(pathOps.commands(list)).toBe(list);
        expect(pathOps.commands(null)).toEqual([]);
        expect(pathOps.commands(undefined)).toEqual([]);
    });

    it("returns the input of `trim` for the whole range and for a path with nothing to trim", () => {
        const list = SQUARE();
        expect(pathOps.trim(list, 0, 1)).toBe(list);
        expect(pathOps.trim(list, -3, 7)).toBe(list);
        const empty: PathCommand[] = [];
        expect(pathOps.trim(empty, 0.2, 0.8)).toBe(empty);
        expect(pathOps.trim("M 4 4", 0.2, 0.8)).toBe("M 4 4");
    });

    it("returns the endpoints of `lerp` verbatim, as the same object", () => {
        const from = SQUARE();
        const to = CIRCLE();
        expect(pathOps.lerp(from, to, 0)).toBe(from);
        expect(pathOps.lerp(from, to, -1)).toBe(from);
        expect(pathOps.lerp(from, to, 1)).toBe(to);
        expect(pathOps.lerp("M 0 0 L 1 1", "M 0 0 L 2 2", 1)).toBe("M 0 0 L 2 2");
    });

    it("returns the path of `normalize` by reference when there is nothing to fit", () => {
        const none: never[] = [];
        expect(pathOps.normalize(none).path).toBe(none);
    });

    it("returns the ends of `split` by identity for a straight segment", () => {
        const a = { point: { x: 0, y: 0 }, inHandle: null, outHandle: null };
        const b = { point: { x: 4, y: 0 }, inHandle: null, outHandle: null };
        const split = pathOps.split(a, b, 0.5);
        expect(split.from).toBe(a);
        expect(split.to).toBe(b);
    });

    it("hands the same contour list back for the same string, so a caller must not edit it", () => {
        const d = "M 0 0 L 123456 1";
        expect(pathOps.contours(d)).toBe(pathOps.contours(d));
    });

    it("hands a fresh anchor model back every time", () => {
        const d = "M 0 0 L 123457 1";
        expect(pathOps.anchors(d)).not.toBe(pathOps.anchors(d));
        expect(pathOps.anchors(d)).toEqual(pathOps.anchors(d));
    });

    it("holds the whole ops surface", () => {
        const names = [
            "resolve", "lerp", "commands", "contours", "cubics", "anchors", "bounds", "size", "length", "sampler",
            "trim", "dash", "dashScale", "plan", "sample", "fromAnchors", "anchorCommands", "anchorBounds", "map",
            "translate", "endFit", "isEmpty", "normalize", "fitToBox", "pointOn", "split",
        ];
        expect(Object.keys(pathOps).sort()).toEqual([...names].sort());
        for (const name of names) expect(pathOps[name as keyof typeof pathOps]).toBeTypeOf("function");
    });
});
