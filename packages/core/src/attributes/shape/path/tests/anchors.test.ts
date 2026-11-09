import { describe, expect, it } from "vitest";

import { PATH_UNIT_EXTENT, PATH_UNIT_HALF, UNIT_PATH_BOX } from "../anchors";
import { pathOps } from "../ops";

/**
 * First coverage the editable anchor model has ever had — it lived in
 * `vector-path.ts` (then under `nodes/geometry/`) with no test file at all, and was exercised
 * only indirectly through a node.
 */
describe("anchorsOf", () => {
    it("reads a line as two handle-free anchors", () => {
        const [subpath] = pathOps.anchors("M 0 0 L 10 0");
        expect(subpath.closed).toBe(false);
        expect(subpath.anchors).toEqual([
            { point: { x: 0, y: 0 }, inHandle: null, outHandle: null },
            { point: { x: 10, y: 0 }, inHandle: null, outHandle: null },
        ]);
    });

    it("hangs a cubic's controls off the anchors either side", () => {
        const [subpath] = pathOps.anchors("M 0 0 C 1 2 3 4 5 6");
        expect(subpath.anchors[0].outHandle).toEqual({ x: 1, y: 2 });
        expect(subpath.anchors[1].inHandle).toEqual({ x: 3, y: 4 });
        expect(subpath.anchors[1].point).toEqual({ x: 5, y: 6 });
    });

    it("folds the anchor a closing command duplicates", () => {
        // `… L 0 0 Z` names the start point twice. Left alone the round trip
        // grows an anchor every time the file is opened.
        const [subpath] = pathOps.anchors("M 0 0 L 10 0 L 10 10 L 0 0 Z");
        expect(subpath.closed).toBe(true);
        expect(subpath.anchors).toHaveLength(3);
    });

    it("keeps an arc, as cubics", () => {
        // The old parser had no `A` in its letter list, so it stopped at the
        // first arc and silently dropped everything after it.
        const withArc = pathOps.anchors("M 0 0 A 50 50 0 0 1 100 0 L 100 50");
        const anchors = withArc[0].anchors;
        expect(anchors.length).toBeGreaterThan(2);
        expect(anchors[anchors.length - 1].point).toEqual({ x: 100, y: 50 });
    });

    it("parses an arc-heavy icon without truncating it", () => {
        // A GitHub mark: real-world icons draw rounded joins with `A`.
        const icon = "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504"
            + ".5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703"
            + "A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337"
            + "C22 6.484 17.522 2 12 2z";
        const path = pathOps.anchors(icon);
        const box = pathOps.anchorBounds(path)!;
        // Truncating at the arc stopped the geometry at x=12. The box reaches
        // 18.46, not the 22 of the trailing cubic's control point, because these
        // bounds are the curve's own extrema rather than its handle hull.
        expect(box.maxX).toBeGreaterThan(18);
        expect(box.maxX).toBeLessThan(19);
        // And the run continues past the arc rather than ending at it.
        expect(path[0].closed).toBe(true);
    });

    it("has no anchors for an empty path", () => {
        expect(pathOps.anchors("")).toEqual([]);
        expect(pathOps.isEmpty(pathOps.anchors(""))).toBe(true);
    });
});

describe("anchors() hands out its own points", () => {
    it("does not let an edit reach the memoized contour", () => {
        const d = pathOps.commands("M 0 0 C 1 2 3 4 5 6 L 7 8");
        const first = pathOps.anchors(d);
        for (const anchor of first[0].anchors) {
            anchor.point.x = 999;
            if (anchor.inHandle) anchor.inHandle.y = 999;
            if (anchor.outHandle) anchor.outHandle.y = 999;
        }
        expect(pathOps.anchors(d)).toEqual([
            {
                closed: false,
                anchors: [
                    { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 1, y: 2 } },
                    { point: { x: 5, y: 6 }, inHandle: { x: 3, y: 4 }, outHandle: null },
                    { point: { x: 7, y: 8 }, inHandle: null, outHandle: null },
                ],
            },
        ]);
    });
});

describe("anchorBounds of a one-anchor closed subpath", () => {
    it("ignores the self-loop the writers never draw", () => {
        const path = [{
            closed: true,
            anchors: [{ point: { x: 0, y: 0 }, inHandle: { x: -5, y: 8 }, outHandle: { x: 6, y: -9 } }],
        }];
        expect(pathOps.anchorBounds(path)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
        // Agrees with what is drawn: a lone anchor and its close.
        expect(pathOps.anchorCommands(path).map((c) => c.type)).toEqual(["M", "Z"]);
    });

    it("still includes the closing curve of two or more anchors", () => {
        const path = [{
            closed: true,
            anchors: [
                { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: -10 } },
                { point: { x: 10, y: 0 }, inHandle: null, outHandle: null },
            ],
        }];
        expect(pathOps.anchorBounds(path)!.minY).toBeLessThan(0);
    });
});

describe("round trip", () => {
    it("re-serializes to the same string", () => {
        const d = "M 0 0 C 1 2 3 4 5 6 L 8 8 Z";
        const once = pathOps.fromAnchors(pathOps.anchors(d));
        expect(pathOps.fromAnchors(pathOps.anchors(once))).toBe(once);
    });

    it("does not grow an anchor per load", () => {
        let d = "M 0 0 L 10 0 L 10 10 L 0 0 Z";
        const counts: number[] = [];
        for (let i = 0; i < 4; i++) {
            const path = pathOps.anchors(d);
            counts.push(path[0].anchors.length);
            d = pathOps.fromAnchors(path);
        }
        expect(new Set(counts).size).toBe(1);
    });

    it("emits commands and a `d` string that agree on line vs curve", () => {
        // The closing join here is straight — the last anchor has no out-handle
        // and the first has no in-handle — and a straight close is exactly what
        // `Z` draws, so neither format states it.
        const path = pathOps.anchors("M 0 0 L 10 0 C 12 0 14 2 14 4 Z");
        expect(pathOps.anchorCommands(path).map((c) => c.type)).toEqual(["M", "L", "C", "Z"]);
        expect(pathOps.fromAnchors(path)).toBe("M 0 0 L 10 0 C 12 0 14 2 14 4 Z");
    });

    it("states a curved close, which `Z` cannot draw", () => {
        const path = pathOps.anchors("M 0 0 L 10 0 C 12 0 14 2 14 4 C 10 8 4 4 0 0 Z");
        expect(pathOps.anchorCommands(path).map((c) => c.type)).toEqual(["M", "L", "C", "C", "Z"]);
    });

    it("folds a transform into the command pass", () => {
        const path = pathOps.anchors("M 1 2 L 3 4");
        const commands = pathOps.anchorCommands(path, (p) => ({ x: p.x * 10, y: -p.y }));
        expect(commands).toEqual([
            { type: "M", x: 10, y: -2 },
            { type: "L", x: 30, y: -4 },
        ]);
    });
});

describe("the mid-tween value a morph produces", () => {
    const DIAMOND = "M 0 -0.5 L 0.5 0 L 0 0.5 L -0.5 0 Z";
    const SQUARE = "M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z";

    it("is a command array, not a string", () => {
        expect(Array.isArray(pathOps.lerp(DIAMOND, SQUARE, 0.5))).toBe(true);
    });

    it("still reads as anchors", () => {
        // The bug this replaces: every caller narrowed to a string first
        // (`typeof data === "string" ? data : ""`), so a node animating its
        // `data` drew nothing at all for the whole tween.
        const mid = pathOps.lerp(DIAMOND, SQUARE, 0.5);
        const path = pathOps.anchors(mid);
        expect(pathOps.isEmpty(path)).toBe(false);
        expect(pathOps.anchorCommands(path).length).toBeGreaterThan(0);
    });
});

describe("endFit", () => {
    it("turns and scales about the start, carrying the end onto the target", () => {
        const fit = pathOps.endFit({ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 10, y: 60 });
        expect(fit({ x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
        const end = fit({ x: 110, y: 10 });
        expect(end.x).toBeCloseTo(10, 9);
        expect(end.y).toBeCloseTo(60, 9);
        // A handle a quarter along and 20 off the chord keeps its place relative to it.
        const handle = fit({ x: 35, y: 30 });
        expect(handle.x).toBeCloseTo(0, 9);
        expect(handle.y).toBeCloseTo(22.5, 9);
    });

    it("translates when the start and end coincide", () => {
        const fit = pathOps.endFit({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: -3 });
        expect(fit({ x: 2, y: 2 })).toEqual({ x: 7, y: -1 });
    });
});

// ── The unit box, transforms and measuring ──────────────────────────

type Anchor = { point: { x: number; y: number }; inHandle: { x: number; y: number } | null; outHandle: { x: number; y: number } | null };
const corner = (x: number, y: number): Anchor => ({ point: { x, y }, inHandle: null, outHandle: null });
const open = (...anchors: Anchor[]) => [{ anchors, closed: false }];

describe("normalize", () => {
    it("re-quotes the geometry against its own bounds, reporting the scale and the old centre", () => {
        const result = pathOps.normalize(open(corner(10, 20), corner(30, 60)));
        expect(result.scaleX).toBe(20);
        expect(result.scaleY).toBe(40);
        expect(result.centerX).toBe(20);
        expect(result.centerY).toBe(40);
        expect(result.path[0].anchors.map((a) => a.point)).toEqual([{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]);
    });

    it("fits the geometry's own tight bounds, not the handle polygon", () => {
        // The curve only reaches y = 7.5, though its handles reach 10.
        const hump: Anchor[] = [
            { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: 10 } },
            { point: { x: 10, y: 0 }, inHandle: { x: 10, y: 10 }, outHandle: null },
        ];
        const result = pathOps.normalize(open(...hump));
        expect(result.scaleY).toBeCloseTo(7.5, 9);
        expect(result.centerY).toBeCloseTo(3.75, 9);
    });

    it("scales the handles with the points", () => {
        const result = pathOps.normalize(open(
            { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 10, y: 0 } },
            { point: { x: 10, y: 10 }, inHandle: { x: 0, y: 10 }, outHandle: null },
        ));
        const [first, second] = result.path[0].anchors;
        expect(first.outHandle!.x).toBeCloseTo(0.5, 9);
        expect(second.inHandle!.y).toBeCloseTo(0.5, 9);
        expect(first.inHandle).toBeNull();
        expect(second.outHandle).toBeNull();
    });

    it("leaves a flat axis at scale 1 and centres it, rather than dividing by zero", () => {
        const result = pathOps.normalize(open(corner(0, 5), corner(10, 5)));
        expect(result.scaleX).toBe(10);
        expect(result.scaleY).toBe(1);
        expect(result.centerY).toBe(5);
        expect(result.path[0].anchors.map((a) => a.point)).toEqual([{ x: -0.5, y: 0 }, { x: 0.5, y: 0 }]);
    });

    it("leaves a single point at scale 1 on both axes, centred on it", () => {
        const result = pathOps.normalize(open(corner(7, -3)));
        expect([result.scaleX, result.scaleY, result.centerX, result.centerY]).toEqual([1, 1, 7, -3]);
        expect(result.path[0].anchors[0].point).toEqual({ x: 0, y: 0 });
    });

    it("hands an empty path back as it came, with an identity fit", () => {
        const empty: Anchor[][] = [];
        const result = pathOps.normalize([]);
        expect(result.path).toEqual(empty);
        expect(result).toMatchObject({ scaleX: 1, scaleY: 1, centerX: 0, centerY: 0 });
        const noAnchors = [{ anchors: [], closed: false }];
        expect(pathOps.normalize(noAnchors).path).toBe(noAnchors);
    });

    it("changes nothing for a path that already fills the unit box", () => {
        const unit = open(corner(-0.5, -0.5), corner(0.5, 0.5));
        const result = pathOps.normalize(unit);
        expect(result).toMatchObject({ scaleX: 1, scaleY: 1, centerX: 0, centerY: 0 });
        expect(result.path).toEqual(unit);
    });

    it("does not write to the path it is given", () => {
        const path = open(corner(10, 20), corner(30, 60));
        const before = JSON.stringify(path);
        pathOps.normalize(path);
        expect(JSON.stringify(path)).toBe(before);
    });
});

describe("fitToBox", () => {
    it("re-quotes against a stated box, which can be wider than the drawing", () => {
        const result = pathOps.fitToBox(open(corner(0, 0), corner(10, 10)), { minX: -10, minY: 0, maxX: 20, maxY: 10 });
        expect(result.scaleX).toBe(30);
        expect(result.scaleY).toBe(10);
        expect(result.centerX).toBe(5);
        expect(result.centerY).toBe(5);
        const [a, b] = result.path[0].anchors.map((anchor) => anchor.point);
        expect(a.x).toBeCloseTo(-5 / 30, 9);
        expect(b.x).toBeCloseTo(5 / 30, 9);
        expect(a.y).toBe(-0.5);
        expect(b.y).toBe(0.5);
    });

    it("treats an inverted box as degenerate on that axis: scale 1, centre at the midpoint", () => {
        const result = pathOps.fitToBox(open(corner(0, 0), corner(10, 10)), { minX: 10, minY: 0, maxX: 0, maxY: 10 });
        expect(result.scaleX).toBe(1);
        expect(result.centerX).toBe(5);
        expect(result.scaleY).toBe(10);
        expect(result.path[0].anchors[0].point.x).toBe(-5);
    });

    it("treats a box thinner than 1e-9 as flat", () => {
        const result = pathOps.fitToBox(open(corner(0, 0), corner(10, 10)), { minX: 0, minY: 0, maxX: 1e-10, maxY: 10 });
        expect(result.scaleX).toBe(1);
    });

    it("keeps the unit box itself a fixed point", () => {
        const unit = open(corner(-0.5, -0.5), corner(0.5, 0.5));
        expect(pathOps.fitToBox(unit, UNIT_PATH_BOX).path).toEqual(unit);
    });
});

describe("the unit box constants", () => {
    it("quotes the node's own frame, half a unit either side of the centre", () => {
        expect(PATH_UNIT_EXTENT).toBe(1);
        expect(PATH_UNIT_HALF).toBe(0.5);
        expect(UNIT_PATH_BOX).toEqual({ minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 });
    });

    it("is what normalize reports a path as filling", () => {
        const { path } = pathOps.normalize(open(corner(3, 9), corner(8, 40)));
        expect(pathOps.anchorBounds(path)).toEqual(UNIT_PATH_BOX);
    });
});

describe("translate and map", () => {
    const curve = [{
        closed: true,
        anchors: [
            { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 1, y: 2 } },
            { point: { x: 5, y: 5 }, inHandle: { x: 4, y: 6 }, outHandle: null },
        ],
    }];

    it("moves every point and handle by the same delta", () => {
        const [moved] = pathOps.translate(curve, { x: 10, y: -1 });
        expect(moved.anchors[0]).toEqual({ point: { x: 10, y: -1 }, inHandle: null, outHandle: { x: 11, y: 1 } });
        expect(moved.anchors[1]).toEqual({ point: { x: 15, y: 4 }, inHandle: { x: 14, y: 5 }, outHandle: null });
    });

    it("keeps null handles null and the closed flag as it was", () => {
        const [mapped] = pathOps.map(curve, (p) => ({ x: p.x * 2, y: p.y * 2 }));
        expect(mapped.closed).toBe(true);
        expect(mapped.anchors[0].inHandle).toBeNull();
        expect(mapped.anchors[1].outHandle).toBeNull();
        expect(pathOps.map(open(corner(0, 0)), (p) => p)[0].closed).toBe(false);
    });

    it("returns a new path and leaves the old one as it was", () => {
        const before = JSON.stringify(curve);
        const mapped = pathOps.map(curve, (p) => ({ x: p.x + 1, y: p.y + 1 }));
        expect(JSON.stringify(curve)).toBe(before);
        expect(mapped).not.toBe(curve);
        expect(mapped[0].anchors[0]).not.toBe(curve[0].anchors[0]);
    });

    it("calls the function once per point and once per present handle", () => {
        const seen: string[] = [];
        pathOps.map(curve, (p) => { seen.push(`${p.x},${p.y}`); return p; });
        expect(seen).toEqual(["0,0", "1,2", "5,5", "4,6"]);
    });

    it("maps an empty path to an empty path", () => {
        expect(pathOps.map([], (p) => p)).toEqual([]);
        expect(pathOps.translate([], { x: 1, y: 1 })).toEqual([]);
    });
});

describe("anchorBounds, when there is nothing to bound", () => {
    it("is null for an empty path, and for subpaths with no anchors", () => {
        expect(pathOps.anchorBounds([])).toBeNull();
        expect(pathOps.anchorBounds([{ anchors: [], closed: false }, { anchors: [], closed: true }])).toBeNull();
    });

    it("is the point itself for a single anchor", () => {
        expect(pathOps.anchorBounds(open(corner(3, 4)))).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
    });
});

// ── split and pointOn ───────────────────────────────────────────────

describe("pointOn", () => {
    it("is linear on a segment with no handles", () => {
        expect(pathOps.pointOn(corner(0, 0), corner(10, 20), 0.25)).toEqual({ x: 2.5, y: 5 });
    });

    it("is the segment's own end at t = 0 and t = 1", () => {
        const from: Anchor = { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: 10 } };
        const to: Anchor = { point: { x: 10, y: 0 }, inHandle: { x: 10, y: 10 }, outHandle: null };
        expect(pathOps.pointOn(from, to, 0)).toEqual({ x: 0, y: 0 });
        expect(pathOps.pointOn(from, to, 1)).toEqual({ x: 10, y: 0 });
    });

    it("follows the cubic: the middle of a symmetric hump is three quarters of its handle height", () => {
        const from: Anchor = { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: 10 } };
        const to: Anchor = { point: { x: 10, y: 0 }, inHandle: { x: 10, y: 10 }, outHandle: null };
        const mid = pathOps.pointOn(from, to, 0.5);
        expect(mid.x).toBeCloseTo(5, 9);
        expect(mid.y).toBeCloseTo(7.5, 9);
    });

    it("treats a missing handle as its own anchor", () => {
        const from: Anchor = { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: 12 } };
        const bare = pathOps.pointOn(from, corner(12, 0), 0.5);
        const explicit = pathOps.pointOn(from, { point: { x: 12, y: 0 }, inHandle: { x: 12, y: 0 }, outHandle: null }, 0.5);
        expect(bare).toEqual(explicit);
    });
});

describe("split", () => {
    const hump = (): { from: Anchor; to: Anchor } => ({
        from: { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: 10 } },
        to: { point: { x: 10, y: 0 }, inHandle: { x: 10, y: 10 }, outHandle: null },
    });

    it("puts the new anchor on the curve at t", () => {
        const { from, to } = hump();
        const { middle } = pathOps.split(from, to, 0.3);
        const at = pathOps.pointOn(from, to, 0.3);
        expect(middle.point.x).toBeCloseTo(at.x, 9);
        expect(middle.point.y).toBeCloseTo(at.y, 9);
    });

    it("does not move the curve: the two halves trace the same points as the whole", () => {
        const { from, to } = hump();
        const t = 0.3;
        const split = pathOps.split(from, to, t);
        for (const s of [0, 0.25, 0.5, 0.75, 1]) {
            const left = pathOps.pointOn(split.from, split.middle, s);
            const whole = pathOps.pointOn(from, to, s * t);
            expect(left.x).toBeCloseTo(whole.x, 9);
            expect(left.y).toBeCloseTo(whole.y, 9);
            const right = pathOps.pointOn(split.middle, split.to, s);
            const wholeRight = pathOps.pointOn(from, to, t + s * (1 - t));
            expect(right.x).toBeCloseTo(wholeRight.x, 9);
            expect(right.y).toBeCloseTo(wholeRight.y, 9);
        }
    });

    it("keeps the outer handles' other sides, and shortens the facing ones", () => {
        const { from, to } = hump();
        const split = pathOps.split(from, to, 0.5);
        expect(split.from.inHandle).toBeNull();
        expect(split.to.outHandle).toBeNull();
        expect(split.from.point).toEqual({ x: 0, y: 0 });
        expect(split.to.point).toEqual({ x: 10, y: 0 });
        expect(split.from.outHandle).toEqual({ x: 0, y: 5 });
        expect(split.to.inHandle).toEqual({ x: 10, y: 5 });
        expect(split.middle.inHandle).toEqual({ x: 2.5, y: 7.5 });
        expect(split.middle.outHandle).toEqual({ x: 7.5, y: 7.5 });
    });

    it("gives the new anchor handles that are collinear with the point, so the join is smooth", () => {
        const { from, to } = hump();
        const { middle } = pathOps.split(from, to, 0.3);
        const a = { x: middle.inHandle!.x - middle.point.x, y: middle.inHandle!.y - middle.point.y };
        const b = { x: middle.outHandle!.x - middle.point.x, y: middle.outHandle!.y - middle.point.y };
        expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 9);
        expect(a.x * b.x + a.y * b.y).toBeLessThan(0);
    });

    it("splits a straight segment into two straight segments, leaving the ends as they were", () => {
        const a = corner(0, 0);
        const b = corner(10, 0);
        const split = pathOps.split(a, b, 0.4);
        expect(split.from).toBe(a);
        expect(split.to).toBe(b);
        expect(split.middle).toEqual({ point: { x: 4, y: 0 }, inHandle: null, outHandle: null });
    });

    it("splits a half-curved segment as a cubic with the missing handle on its anchor", () => {
        const from: Anchor = { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 0, y: 12 } };
        const to = corner(12, 0);
        const split = pathOps.split(from, to, 0.5);
        // The curve is unchanged ...
        for (const s of [0, 0.25, 0.5, 0.75, 1]) {
            const left = pathOps.pointOn(split.from, split.middle, s);
            const whole = pathOps.pointOn(from, to, s * 0.5);
            expect(left.x).toBeCloseTo(whole.x, 9);
            expect(left.y).toBeCloseTo(whole.y, 9);
        }
        // ... and the end that had no handle now holds one lying on its own point.
        expect(split.to.inHandle).toEqual({ x: 12, y: 0 });
        expect(split.to.outHandle).toBeNull();
    });

    it("does not write to the anchors it is given", () => {
        const { from, to } = hump();
        const before = JSON.stringify([from, to]);
        pathOps.split(from, to, 0.5);
        expect(JSON.stringify([from, to])).toBe(before);
    });
});

// ── Round trips ─────────────────────────────────────────────────────

describe("what survives a round trip through a `d` string", () => {
    type Handle = { x: number; y: number } | null;
    /** Corner, smooth (mirrored), asymmetric (opposed, unequal) or half-curved, from the handles alone. */
    function kindOf(anchor: { point: { x: number; y: number }; inHandle: Handle; outHandle: Handle }): string {
        const offset = (h: Handle) => (h ? { x: h.x - anchor.point.x, y: h.y - anchor.point.y } : { x: 0, y: 0 });
        const i = offset(anchor.inHandle);
        const o = offset(anchor.outHandle);
        const iLen = Math.hypot(i.x, i.y);
        const oLen = Math.hypot(o.x, o.y);
        if (iLen === 0 && oLen === 0) return "corner";
        if (iLen === 0 || oLen === 0) return "half";
        const opposed = Math.abs(i.x * o.y - i.y * o.x) < 1e-9 && i.x * o.x + i.y * o.y < 0;
        if (!opposed) return "kinked";
        return Math.abs(iLen - oLen) < 1e-9 ? "smooth" : "asymmetric";
    }

    const path = [{
        closed: true,
        anchors: [
            { point: { x: 0, y: 0 }, inHandle: null, outHandle: null },
            { point: { x: 20, y: 0 }, inHandle: { x: 17, y: -4 }, outHandle: { x: 23, y: 4 } },
            { point: { x: 20, y: 20 }, inHandle: { x: 22, y: 25 }, outHandle: { x: 19, y: 17.5 } },
            { point: { x: 0, y: 20 }, inHandle: null, outHandle: null },
        ],
    }];

    it("keeps a smooth point's handles exactly", () => {
        const back = pathOps.anchors(pathOps.fromAnchors(path))[0].anchors;
        expect(back[1].inHandle).toEqual({ x: 17, y: -4 });
        expect(back[1].outHandle).toEqual({ x: 23, y: 4 });
        expect(kindOf(back[1])).toBe("smooth");
    });

    it("keeps an asymmetric point's two lengths", () => {
        const back = pathOps.anchors(pathOps.fromAnchors(path))[0].anchors;
        expect(back[2].inHandle).toEqual({ x: 22, y: 25 });
        expect(back[2].outHandle).toEqual({ x: 19, y: 17.5 });
        expect(kindOf(back[2])).toBe("asymmetric");
    });

    it("keeps a corner a corner, though a curved neighbour pulls its handle onto the point", () => {
        const back = pathOps.anchors(pathOps.fromAnchors(path))[0].anchors;
        expect(back).toHaveLength(4);
        expect(kindOf(back[0])).toBe("corner");
        expect(kindOf(back[3])).toBe("corner");
        // The handle a corner lacks beside a curve comes back lying on its own point.
        expect(back[3].inHandle).toEqual({ x: 0, y: 20 });
        expect(back[0].outHandle).toEqual({ x: 0, y: 0 });
    });

    it("is stable from the second write on", () => {
        const once = pathOps.fromAnchors(path);
        const twice = pathOps.fromAnchors(pathOps.anchors(once));
        expect(twice).toBe(once);
    });

    it("keeps an all-straight corner polygon free of handles", () => {
        const back = pathOps.anchors(pathOps.fromAnchors([{
            closed: true, anchors: [corner(0, 0), corner(10, 0), corner(10, 10)],
        }]))[0];
        expect(back.anchors.every((a) => a.inHandle === null && a.outHandle === null)).toBe(true);
        expect(back.closed).toBe(true);
    });
});

describe("fromAnchors – formatting", () => {
    const write = (...points: Array<[number, number]>) =>
        pathOps.fromAnchors(open(...points.map(([x, y]) => corner(x, y))));

    it("rounds a coordinate to five decimals", () => {
        expect(write([1 / 3, 2 / 3])).toBe("M 0.33333 0.66667");
        expect(write([0.123456789, -0.123454])).toBe("M 0.12346 -0.12345");
    });

    it("writes a whole number without a decimal point", () => {
        expect(write([1, -2.5])).toBe("M 1 -2.5");
    });

    it("writes negative zero, and a value that rounds to it, as 0", () => {
        expect(write([-0, 0])).toBe("M 0 0");
        expect(write([-0.000001, 0.000004])).toBe("M 0 0");
        expect(write([-0.000001, 0.000004])).not.toContain("-");
    });

    it("writes a non-finite coordinate as 0", () => {
        expect(write([NaN, Infinity])).toBe("M 0 0");
        expect(write([-Infinity, 5])).toBe("M 0 5");
        expect(write([0, 0], [NaN, 1])).toBe("M 0 0 L 0 1");
    });

    it("writes handles with the same rounding", () => {
        const d = pathOps.fromAnchors(open(
            { point: { x: 0, y: 0 }, inHandle: null, outHandle: { x: 1 / 3, y: -0 } },
            { point: { x: 1, y: 1 }, inHandle: { x: NaN, y: 0.5 }, outHandle: null },
        ));
        expect(d).toBe("M 0 0 C 0.33333 0 0 0.5 1 1");
    });

    it("skips a subpath with no anchors, and gives an empty string for no path at all", () => {
        expect(pathOps.fromAnchors([])).toBe("");
        expect(pathOps.fromAnchors([{ anchors: [], closed: false }])).toBe("");
        expect(pathOps.fromAnchors([{ anchors: [], closed: true }, ...open(corner(1, 1))])).toBe("M 1 1");
    });

    it("writes a lone closed anchor as a move and a close", () => {
        expect(pathOps.fromAnchors([{ anchors: [corner(2, 3)], closed: true }])).toBe("M 2 3 Z");
    });

    it("writes several subpaths one after the other", () => {
        expect(pathOps.fromAnchors([...open(corner(0, 0), corner(1, 0)), ...open(corner(5, 5), corner(6, 5))]))
            .toBe("M 0 0 L 1 0 M 5 5 L 6 5");
    });
});
