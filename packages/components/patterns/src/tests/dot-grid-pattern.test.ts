import { describe, expect, it } from "vitest";

import { NullRenderContext } from "@motionscript/core";
import type { BoxBounds, Node2D } from "@motionscript/sdk";

import { addTiledLines } from "../kit";
import { DotGridPattern } from "../dot-grid-pattern";
import { LineGridPattern } from "../line-grid-pattern";
import { linesOf, mount, pathOf, render } from "./recorder.fixtures";

/** The tiling both grids use, collected — {@link addTiledLines} emits. */
function gridPositions(
    min: number,
    max: number,
    step: number,
    offset: number,
    subdivisions: number,
    overscan: number,
): { pos: number; isMajor: boolean }[] {
    const out: { pos: number; isMajor: boolean }[] = [];
    addTiledLines(min, max, step, offset, subdivisions, overscan, (pos, isMajor) => {
        out.push({ pos, isMajor });
    });
    return out;
}

/**
 * The dot grid, and the tiling it shares with the line grid.
 *
 * The pair is the point: a dot grid laid over a line grid with the same
 * `divisions`, `subdivisions` and `offset` puts its dots **on** the
 * intersections, and stays there as both are panned. Both call the same
 * function, so the correspondence is structural.
 */
interface RecordedOp {
    kind: string;
    state?: { x?: number; y?: number; width?: number; height?: number };
}

function laidOut<T extends Node2D>(node: T, width: number, height: number): T {
    mount(node);
    node.layout({ x: 0, y: 0, width, height }, new NullRenderContext());
    return node;
}

/** The dots a laid-out grid paints: the discs of the drawing that fills them. */
function dotsOf(node: DotGridPattern): RecordedOp[] {
    const filled = render(node).drawings.find((d) => d.kinds.at(-1) === "fill");
    return filled ? (filled.graphics.ops() as readonly RecordedOp[]).filter((op) => op.kind === "ellipse") : [];
}

describe("the tiling the two grids share", () => {
  it("centres the un-panned grid on zero", () => {
    const positions = gridPositions(-100, 100, 50, 0, 1, 0)
    expect(positions.map((p) => p.pos)).toEqual([-100, -50, 0, 50, 100])
  })

  it("classifies every nth mark as major", () => {
    // Four subdivisions per division: one major, then three minors, repeating.
    const positions = gridPositions(-40, 40, 10, 0, 4, 0)
    expect(positions.filter((p) => p.isMajor).map((p) => p.pos)).toEqual([
      -40, 0, 40,
    ])
  })

  it("keeps a mark's classification stable as the grid is panned", () => {
    // The whole reason the index is taken against the *un-panned* grid. Pan by a
    // whole step and each major must move by exactly that step rather than trade
    // places with a minor that was sitting between them.
    const still = gridPositions(-40, 40, 10, 0, 4, 0)
    const panned = gridPositions(-40, 40, 10, 10, 4, 0)
    const majorsPanned = panned.filter((p) => p.isMajor).map((p) => p.pos)
    for (const pos of still.filter((p) => p.isMajor).map((p) => p.pos)) {
      if (pos + 10 <= 40) expect(majorsPanned).toContain(pos + 10)
    }
  })

  it("classifies marks left of centre the same way as marks right of it", () => {
    // A plain `%` goes negative for negative indices, which would leave the left
    // half of every subdivided grid with its majors in the wrong places.
    const positions = gridPositions(-30, 30, 10, 0, 3, 0)
    expect(positions.filter((p) => p.isMajor).map((p) => p.pos)).toEqual([
      -30, 0, 30,
    ])
  })

  it("keeps a mark that lands exactly on an edge", () => {
    // The common case rather than the corner one: an even tile count at offset 0
    // puts a mark on each edge, and float-point error must not drop either.
    expect(gridPositions(-100, 100, 100, 0, 1, 0)).toHaveLength(3)
  })

  it("emits nothing for a degenerate step", () => {
    expect(gridPositions(-100, 100, 0, 0, 1, 0)).toEqual([])
    expect(gridPositions(-100, 100, Number.NaN, 0, 1, 0)).toEqual([])
  })
})

describe("the DotGridPattern node", () => {
  it("puts a dot at every intersection of its divisions", () => {
    // Two cells per axis is a 3 x 3 lattice.
    const grid = laidOut(
      new DotGridPattern({ divisions: 2, subdivisions: 1, radius: 4 }),
      200,
      200
    )
    expect(dotsOf(grid)).toHaveLength(9)
  })

  it("draws nothing when its marks have no size", () => {
    const grid = laidOut(
      new DotGridPattern({ divisions: 2, radius: 0, subScale: 0 }),
      200,
      200
    )
    expect(dotsOf(grid)).toHaveLength(0)
  })

  it("draws a minor dot smaller than a major one", () => {
    const grid = laidOut(
      new DotGridPattern({ divisions: 1, subdivisions: 2, radius: 10, subScale: 0.5 }),
      200,
      200
    )
    expect(new Set(dotsOf(grid).map((op) => op.state?.width))).toEqual(
      new Set([20, 10])
    )
  })

  it("is major only where both axes are", () => {
    // A dot on a major column but a minor row is a *minor* dot: it sits on one
    // rule rather than at the crossing of two. Two divisions split twice is a
    // 5 x 5 lattice with three major positions per axis — so nine of the
    // twenty-five dots are major, and the sixteen others include the eight that
    // are major on exactly one axis.
    const grid = laidOut(
      new DotGridPattern({ divisions: 2, subdivisions: 2, radius: 10, subScale: 0.5 }),
      200,
      200
    )
    const dots = dotsOf(grid)
    expect(dots).toHaveLength(25)
    expect(dots.filter((op) => op.state?.width === 20)).toHaveLength(9)
  })

  it("holds its dots inside the box rather than straddling the edge", () => {
    const radius = 8
    const grid = laidOut(new DotGridPattern({ divisions: 2, radius }), 200, 200)
    for (const dot of dotsOf(grid)) {
      expect(Math.abs(dot.state?.x ?? 0)).toBeLessThanOrEqual(100 - radius + 1e-6)
      expect(Math.abs(dot.state?.y ?? 0)).toBeLessThanOrEqual(100 - radius + 1e-6)
    }
  })

  it("draws nothing in an empty box", () => {
    expect(dotsOf(laidOut(new DotGridPattern({ radius: 4 }), 0, 0))).toHaveLength(0)
  })

  it("grabs on its box, not on its dots", () => {
    // A backdrop clickable only where a dot happens to be would be close to
    // unclickable — see the class note on `clipSelf`.
    const grid = laidOut(new DotGridPattern({ divisions: 4, radius: 2 }), 200, 200)
    const clip = (
      grid as unknown as { clipSelf(): { isEmpty(): boolean } }
    ).clipSelf()
    expect(clip.isEmpty()).toBe(false)
    const hit = (
      grid as unknown as {
        _hitTestSelf(p: { x: number; y: number }, t: number): boolean
      }
    )._hitTestSelf({ x: 3, y: 3 }, 0)
    expect(hit).toBe(true)
  })
})

/** The distinct x of a laid-out grid's dots, left to right. */
function columnsOf(node: DotGridPattern): number[] {
    return [...new Set(dotsOf(node).map((op) => op.state?.x ?? 0))].sort((a, b) => a - b);
}

describe("the DotGridPattern node — the lattice meets the edges", () => {
    const radius = 8;
    const columns = (divisions: number, extra: Record<string, unknown> = {}, width = 200) =>
        columnsOf(laidOut(new DotGridPattern({ divisions, radius, ...extra } as never), width, width));

    // The tiling was centred on 0, so the box edges were lattice positions only for an even count.
    it("puts a dot column on each edge of the box, inset by the radius, whatever the number of divisions", () => {
        expect(columns(1)).toEqual([-92, 92]);
        expect(columns(2)).toEqual([-92, 0, 92]);
        const three = columns(3);
        expect(three).toHaveLength(4);
        for (const [i, x] of three.entries()) expect(x).toBeCloseTo(-92 + (i * 184) / 3, 9);
    });

    it("puts a dot row on each edge of the box too", () => {
        const grid = laidOut(new DotGridPattern({ divisions: 3, radius } as never), 200, 120);
        const rows = [...new Set(dotsOf(grid).map((op) => op.state?.y ?? 0))].sort((a, b) => a - b);
        expect(rows).toHaveLength(4);
        expect(rows[0]).toBeCloseTo(-52, 9);
        expect(rows[3]).toBeCloseTo(52, 9);
    });

    it("draws a dot at every crossing of an odd number of divisions", () => {
        expect(dotsOf(laidOut(new DotGridPattern({ divisions: 3, radius } as never), 200, 200))).toHaveLength(16);
        expect(dotsOf(laidOut(new DotGridPattern({ divisions: 1, radius } as never), 200, 200))).toHaveLength(4);
    });

    it("makes a dot major only where both axes are on a division line, an edge crossing included", () => {
        const grid = laidOut(new DotGridPattern({ divisions: 1, subdivisions: 2, radius: 10, subScale: 0.5 } as never), 200, 200);
        const dots = dotsOf(grid);
        // Three columns by three rows; the four corners are the major dots.
        expect(dots).toHaveLength(9);
        const major = dots.filter((op) => op.state?.width === 20);
        expect(major.map((op) => [Math.abs(op.state?.x ?? 0), Math.abs(op.state?.y ?? 0)])).toEqual(Array(4).fill([90, 90]));
    });

    it("pans from the edge lattice, as the line grid does", () => {
        const panned = columns(3, { offset: { x: 10, y: 0 } });
        // Step 61.33 from -92, shifted 10: the column that left the far side is gone.
        expect(panned).toHaveLength(3);
        expect(panned[0]).toBeCloseTo(-82, 9);
    });

    it("leaves an even count where it was", () => {
        expect(columns(4)).toEqual([-92, -46, 0, 46, 92]);
        expect(columns(2, { subdivisions: 2 })).toEqual([-92, -46, 0, 46, 92]);
    });
});

describe("the pair, as geometry", () => {
  const SIZE = 240

  /** The x of every line a line grid draws, and of every column a dot grid draws, on the same numbers. */
  function pair(divisions: number, subdivisions: number, offset: number) {
    const line = new LineGridPattern({
      width: SIZE,
      height: SIZE,
      divisions,
      subdivisions,
      offset: { x: offset, y: 0 },
      // Half a weight is the line grid's inset and a dot's radius is the dot grid's: equal, so the two meet.
      stroke: { weight: 0.0002, fill: "white" },
    } as never)
    mount(line)
    line.layout({ x: 0, y: 0, width: SIZE, height: SIZE } as BoxBounds, new NullRenderContext())
    const lines = render(line).lineDrawings.flatMap((drawing) => linesOf(pathOf(drawing).data).vertical)

    const dots = laidOut(
      new DotGridPattern({ divisions, subdivisions, radius: 0.0001, offset: { x: offset, y: 0 } }),
      SIZE,
      SIZE
    )
    return { lines: lines.sort((a, b) => a - b), dots: columnsOf(dots) }
  }

  // The expectation was once the centred tiling itself, which for three divisions left the edges bare.
  for (const [divisions, subdivisions] of [[2, 1], [3, 1], [5, 1], [3, 2], [1, 3]]) {
    it(`puts a dot on every line-grid intersection, panned or not (${divisions} divisions, ${subdivisions} subdivisions)`, () => {
      for (const offset of [0, 17, -43.5]) {
        const { lines, dots } = pair(divisions, subdivisions, offset)
        expect(dots.length, `offset ${offset}`).toBe(lines.length)
        for (const [i, x] of dots.entries()) expect(x, `offset ${offset}`).toBeCloseTo(lines[i], 3)
      }
    })
  }

  it("has a line and a dot column on both edges of the box, for any number of divisions", () => {
    for (const divisions of [1, 2, 3, 4, 5]) {
      const { lines, dots } = pair(divisions, 1, 0)
      expect(lines[0]).toBeCloseTo(-SIZE / 2, 3)
      expect(lines[lines.length - 1]).toBeCloseTo(SIZE / 2, 3)
      expect(dots[0]).toBeCloseTo(-SIZE / 2, 3)
      expect(dots[dots.length - 1]).toBeCloseTo(SIZE / 2, 3)
    }
  })
})
