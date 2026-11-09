import { describe, expect, it } from "vitest"

import {
  PATH_TEMPLATES,
  STAGGER_ORDERS,
  blendSlot,
  fibonacciPoint,
  focalLengthOf,
  normalizeOrder,
  orient,
  parseOrder,
  pathSlots,
  radialAngles,
  radialSlots,
  radialTurnToTop,
  rectangularCell,
  rectangularShape,
  rectangularSlots,
  slot,
  slotOfItem,
  slotsOf,
  sphereFaceForward,
  sphereSlots,
  spreadSlot,
  staggerProgress,
  staggerRanks,
  templatePath,
  wrapDegrees,
  type PathArrangement,
  type RadialArrangement,
  type RectangularArrangement,
  type SlotInput,
  type SphereArrangement,
} from "../kit"

/** The arrangements' own arithmetic, with no node in sight. */

const input = (count: number, size = 50): SlotInput => ({
  count,
  sizes: Array.from({ length: count }, () => ({ width: size, height: size })),
  box: { width: 600, height: 400 },
  time: 0,
})

const rect = (over: Partial<RectangularArrangement> = {}): RectangularArrangement => ({
  kind: "rectangular",
  columns: 3,
  fillDirection: "row",
  cellMode: "fit",
  cellWidth: 100,
  cellHeight: 100,
  columnGap: 10,
  rowGap: 10,
  lastLineAlign: "start",
  rowOffset: 0,
  columnOffset: 0,
  ...over,
})

const xy = (s: { x: number; y: number }) => [round(s.x), round(s.y)]
const round = (v: number) => Math.round(v * 1000) / 1000 + 0

describe("rectangular slots", () => {
  it("fills rows left to right, top down, centred on the grid", () => {
    const slots = rectangularSlots(rect(), input(6))
    expect(slots.map(xy)).toEqual([
      [-60, 30], [0, 30], [60, 30],
      [-60, -30], [0, -30], [60, -30],
    ])
    expect(slots[4].meta).toEqual({ kind: "rectangular", row: 1, column: 1 })
  })

  it("fills columns top down when asked, centred on the columns it uses", () => {
    const slots = rectangularSlots(rect({ fillDirection: "column" }), input(4))
    expect(slots.map(xy)).toEqual([[-30, 30], [-30, -30], [30, 30], [30, -30]])
  })

  it("centres or ends a short last row", () => {
    expect(rectangularSlots(rect({ lastLineAlign: "center" }), input(4))[3].x).toBe(0)
    expect(rectangularSlots(rect({ lastLineAlign: "end" }), input(4))[3].x).toBe(60)
  })

  it("shifts every other row for a brick bond and stays centred", () => {
    const slots = rectangularSlots(rect({ rowOffset: 0.5 }), input(6))
    expect(slots.map(xy)).toEqual([
      [-75, 30], [-15, 30], [45, 30],
      [-45, -30], [15, -30], [75, -30],
    ])
  })

  it("divides the box between the cells in fill mode, and uses its own size in fixed", () => {
    const fill = rectangularSlots(rect({ cellMode: "fill" }), input(6))
    expect(fill[1].x - fill[0].x).toBeCloseTo((600 - 20) / 3 + 10)
    const fixed = rectangularSlots(rect({ cellMode: "fixed", cellWidth: 200 }), input(2))
    expect(fixed[1].x - fixed[0].x).toBe(210)
  })
})

describe("radial slots", () => {
  const ring = (over: Partial<RadialArrangement> = {}): RadialArrangement => ({
    kind: "radial",
    radius: 100,
    startAngle: 0,
    sweep: 360,
    direction: "clockwise",
    rotateItems: false,
    spinSpeed: 0,
    ...over,
  })

  it("puts the first item at twelve o'clock and goes clockwise", () => {
    const slots = radialSlots(ring(), input(4))
    expect(slots.map(xy)).toEqual([[0, 100], [100, 0], [0, -100], [-100, 0]])
  })

  it("puts an item at each end of an arc", () => {
    const angles = radialAngles(ring({ sweep: 180 }), 5, 0)
    expect(angles[0]).toBe(0)
    expect(angles[4]).toBeCloseTo(180, 0)
  })

  it("closes an arc into an even ring without a jump", () => {
    const at = (sweep: number) => radialAngles(ring({ sweep }), 6, 0)[5]
    expect(at(360)).toBeCloseTo(300)
    expect(Math.abs(at(359.9) - at(360))).toBeLessThan(1)
  })

  it("turns items outward when asked, and spins on the clock", () => {
    expect(radialSlots(ring({ rotateItems: true }), input(4))[1].rotation).toBe(90)
    const spun = radialSlots(ring({ spinSpeed: 90 }), { ...input(4), time: 1 })
    expect(xy(spun[0])).toEqual([100, 0])
  })

  it("finds the shorter turn that brings an item to the top", () => {
    expect(radialTurnToTop(ring(), 4, 1)).toBe(-90)
    expect(radialTurnToTop(ring(), 4, 3)).toBe(90)
  })
})

describe("path slots", () => {
  const along = (over: Partial<PathArrangement> = {}): PathArrangement => ({
    kind: "path",
    path: templatePath("line", { width: 400, height: 100 }),
    placement: { originX: 0, originY: 0, x: 0, y: 0, rotation: 0, scale: 1 },
    spacing: "distribute",
    spacingDistance: 50,
    offset: 0,
    flowSpeed: 0,
    trimStart: 0,
    trimEnd: 1,
    alignToPath: true,
    ...over,
  })

  it("puts an item at each end of an open path", () => {
    expect(pathSlots(along(), input(5)).map((s) => round(s.x))).toEqual([-200, -100, 0, 100, 200])
  })

  it("steps evenly round a closed path, and wraps an offset", () => {
    const square = along({ path: templatePath("square", { width: 400, height: 400 }) })
    const slots = pathSlots(square, input(4))
    expect(slots.map(xy)).toEqual([[-200, 200], [200, 200], [200, -200], [-200, -200]])
    const moved = pathSlots({ ...square, offset: 1.25 }, input(4))
    expect(xy(moved[0])).toEqual([200, 200])
  })

  it("hides an item pushed off the end of an open path", () => {
    const slots = pathSlots(along({ offset: 0.3 }), input(5))
    expect(slots.map((s) => s.opacity)).toEqual([1, 1, 1, 0, 0])
  })

  it("turns items to follow the path, clockwise", () => {
    // Mid-edge, where the square's direction is not a corner's either-or.
    const square = along({ path: templatePath("square", { width: 400, height: 400 }), offset: 0.125 })
    const slots = pathSlots(square, input(4))
    expect(slots.map((s) => round(wrapDegrees(s.rotation)))).toEqual([0, 90, 180, -90])
  })

  it("sets items a fixed distance apart", () => {
    const slots = pathSlots(along({ spacing: "fixed", spacingDistance: 30 }), input(3))
    expect(slots.map((s) => round(s.x))).toEqual([-200, -170, -140])
  })

  it("keeps to the trimmed part of the path", () => {
    const slots = pathSlots(along({ trimStart: 0.25, trimEnd: 0.75 }), input(3))
    expect(slots.map((s) => round(s.x))).toEqual([-100, 0, 100])
  })
})

describe("sphere slots", () => {
  const ball = (over: Partial<SphereArrangement> = {}): SphereArrangement => ({
    kind: "sphere",
    radius: 100,
    yaw: 0,
    pitch: 0,
    roll: 0,
    facing: "outward",
    focalLength: 800,
    depthFade: 0,
    cullBackfaces: false,
    spinSpeed: 0,
    ...over,
  })

  it("puts every item on the surface", () => {
    for (const s of sphereSlots(ball(), input(40))) {
      expect(Math.hypot(s.x, s.y, s.depth)).toBeCloseTo(100)
    }
  })

  it("tilts an outward item so its face points along the surface normal", () => {
    for (const s of sphereSlots(ball({ yaw: 30, pitch: -20 }), input(12))) {
      const a = (s.rotationX * Math.PI) / 180
      const b = (s.rotationY * Math.PI) / 180
      // The normal a node's own Rx·Ry turns (0, 0, 1) onto, y-up.
      const normal = [Math.sin(b), Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b)]
      expect(normal[0]).toBeCloseTo(s.x / 100)
      expect(normal[1]).toBeCloseTo(s.y / 100)
      expect(normal[2]).toBeCloseTo(s.depth / 100)
    }
  })

  it("fades the back and hides faces turned away when asked", () => {
    const slots = sphereSlots(ball({ depthFade: 1, cullBackfaces: true }), input(30))
    for (const s of slots) {
      if (s.depth < -40) expect(s.opacity).toBe(0)
      if (s.depth > 40) expect(s.opacity).toBeGreaterThan(0.5)
    }
  })

  it("brings a chosen point round to face the viewer", () => {
    for (const index of [0, 5, 17]) {
      const { yaw, pitch } = sphereFaceForward(24, index)
      const [x, y, z] = orient(fibonacciPoint(index, 24), yaw, pitch, 0)
      expect(x).toBeCloseTo(0)
      expect(y).toBeCloseTo(0)
      expect(z).toBeCloseTo(1)
    }
  })
})

describe("stagger", () => {
  const slots = rectangularSlots(rect(), input(6))

  it("ranks by index, row, column and distance from the centre", () => {
    expect(staggerRanks("index", slots, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(staggerRanks("row", slots, 1)).toEqual([0, 0, 0, 1, 1, 1])
    expect(staggerRanks("column", slots, 1)).toEqual([0, 0.5, 1, 0, 0.5, 1])
    const out = staggerRanks("centerOut", slots, 1)
    expect(out[1]).toBe(0)
    expect(out[0]).toBe(1)
  })

  it("deals a random order the same way for the same seed", () => {
    expect(staggerRanks("random", slots, 7)).toEqual(staggerRanks("random", slots, 7))
    expect([...staggerRanks("random", slots, 7)].sort()).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it("fits every item's run inside the command", () => {
    expect(staggerProgress(0, 0, 0.5)).toBe(0)
    expect(staggerProgress(1, 0.5, 0.5)).toBe(0)
    expect(staggerProgress(1, 1, 0.5)).toBe(1)
    expect(staggerProgress(0, 0.5, 0.5)).toBe(1)
  })
})

describe("order", () => {
  it("repairs any order into a permutation", () => {
    expect(normalizeOrder([2, 2, 9, 0], 4)).toEqual([2, 0, 1, 3])
    expect(normalizeOrder(undefined, 3)).toEqual([0, 1, 2])
  })

  it("inverts slot order into each item's slot, and reads a written list", () => {
    expect(slotOfItem([2, 0, 1])).toEqual([1, 2, 0])
    expect(parseOrder("2, 0 1")).toEqual([2, 0, 1])
  })
})

describe("blendSlot", () => {
  const from = {
    ...slot(0, 0, { kind: "radial", angle: 0 }),
    depth: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scale: 1,
    opacity: 1,
  }
  const to = {
    ...slot(100, -40, { kind: "path", t: 1 }),
    depth: 60,
    rotation: 90,
    rotationX: 20,
    rotationY: -10,
    scale: 3,
    opacity: 0,
  }

  it("is the slot it leaves at t <= 0, and the slot it arrives at at t >= 1, by identity", () => {
    expect(blendSlot(from, to, 0)).toBe(from)
    expect(blendSlot(from, to, -2)).toBe(from)
    expect(blendSlot(from, to, 1)).toBe(to)
    expect(blendSlot(from, to, 7)).toBe(to)
  })

  it("mixes every number between", () => {
    const mid = blendSlot(from, to, 0.25)
    expect(mid).toMatchObject({ x: 25, y: -10, depth: 15, rotation: 22.5, rotationX: 5, rotationY: -2.5, scale: 1.5, opacity: 0.75 })
  })

  it("switches the meta halfway, since an ordering cannot be half one thing", () => {
    expect(blendSlot(from, to, 0.49).meta).toBe(from.meta)
    expect(blendSlot(from, to, 0.5).meta).toBe(to.meta)
    expect(blendSlot(from, to, 0.99).meta).toBe(to.meta)
  })

  it("does not change either slot", () => {
    const before = JSON.stringify([from, to])
    blendSlot(from, to, 0.5)
    expect(JSON.stringify([from, to])).toBe(before)
  })
})

describe("spreadSlot", () => {
  const placed = { ...slot(40, -20, { kind: "radial", angle: 0 }), depth: 10, rotation: 30, scale: 2, opacity: 0.5 }

  it("is the slot itself at a spread of 1", () => {
    expect(spreadSlot(placed, 1)).toBe(placed)
  })

  it("scales the position and the depth from the centre, and nothing else", () => {
    expect(spreadSlot(placed, 2)).toMatchObject({ x: 80, y: -40, depth: 20, rotation: 30, scale: 2, opacity: 0.5 })
    expect(spreadSlot(placed, 0.5)).toMatchObject({ x: 20, y: -10, depth: 5 })
  })

  it("gathers every item at the centre at 0, and pushes through it below 0", () => {
    expect(spreadSlot(placed, 0)).toMatchObject({ x: 0, y: -0, depth: 0 })
    expect(spreadSlot(placed, -1)).toMatchObject({ x: -40, y: 20, depth: -10 })
  })

  it("does not change the slot it is given", () => {
    spreadSlot(placed, 3)
    expect(placed).toMatchObject({ x: 40, y: -20, depth: 10 })
  })
})

describe("rectangular shape and cell", () => {
  it("rounds the column count and keeps at least one column and one row", () => {
    expect(rectangularShape(rect({ columns: 2.6 }), 7)).toEqual({ rows: 3, columns: 3 })
    expect(rectangularShape(rect({ columns: 0 }), 4)).toEqual({ rows: 4, columns: 1 })
    expect(rectangularShape(rect({ columns: -3 }), 2)).toEqual({ rows: 2, columns: 1 })
    expect(rectangularShape(rect(), 0)).toEqual({ rows: 1, columns: 3 })
  })

  it("lets the rows follow from the count when filling by column, and trims a column the items never reach", () => {
    // Four items in three columns would be two rows with the last column empty: two columns centre better.
    expect(rectangularShape(rect({ fillDirection: "column" }), 4)).toEqual({ rows: 2, columns: 2 })
    expect(rectangularShape(rect({ fillDirection: "column" }), 5)).toEqual({ rows: 2, columns: 3 })
    expect(rectangularShape(rect({ fillDirection: "column" }), 7)).toEqual({ rows: 3, columns: 3 })
  })

  it("makes a cell the largest child in fit mode", () => {
    const sizes = [{ width: 40, height: 90 }, { width: 70, height: 20 }]
    expect(rectangularCell(rect(), 2, sizes, { width: 600, height: 400 })).toEqual({ width: 70, height: 90 })
  })

  it("makes a cell the size it is given in fixed mode, and never a negative one", () => {
    const fixed = rect({ cellMode: "fixed", cellWidth: 140, cellHeight: 30 })
    expect(rectangularCell(fixed, 2, [], { width: 600, height: 400 })).toEqual({ width: 140, height: 30 })
    expect(rectangularCell({ ...fixed, cellWidth: -5, cellHeight: -1 }, 2, [], { width: 600, height: 400 })).toEqual({ width: 0, height: 0 })
  })

  it("shares the box equally in fill mode, after the gaps, and never negative", () => {
    const fill = rect({ cellMode: "fill", columnGap: 10, rowGap: 20 })
    // Six items, three columns, two rows: (600 - 2 x 10) / 3 and (400 - 20) / 2.
    expect(rectangularCell(fill, 6, [], { width: 600, height: 400 })).toEqual({ width: 580 / 3, height: 190 })
    expect(rectangularCell(fill, 6, [], { width: 5, height: 5 })).toEqual({ width: 0, height: 0 })
  })
})

describe("rectangular slots: columns and offsets", () => {
  it("fills by column with a short last column, centred on the columns it uses", () => {
    // Five items down two rows: columns of two, two and one.
    const slots = rectangularSlots(rect({ fillDirection: "column" }), input(5))
    expect(slots.map(xy)).toEqual([[-60, 30], [-60, -30], [0, 30], [0, -30], [60, 30]])
    expect(slots.map((s) => s.meta)).toEqual([
      { kind: "rectangular", row: 0, column: 0 },
      { kind: "rectangular", row: 1, column: 0 },
      { kind: "rectangular", row: 0, column: 1 },
      { kind: "rectangular", row: 1, column: 1 },
      { kind: "rectangular", row: 0, column: 2 },
    ])
  })

  it("seats a short last column at its start, middle or end", () => {
    const at = (lastLineAlign: RectangularArrangement["lastLineAlign"]) =>
      rectangularSlots(rect({ fillDirection: "column", lastLineAlign }), input(5))[4]
    expect(xy(at("start"))).toEqual([60, 30])
    expect(xy(at("end"))).toEqual([60, -30])
    // Half way down: between two rows, the row it covers most is the lower.
    expect(xy(at("center"))).toEqual([60, 0])
    expect(at("center").meta).toEqual({ kind: "rectangular", row: 1, column: 2 })
  })

  it("shifts every other column down by a share of a row's pitch, and stays centred", () => {
    const slots = rectangularSlots(rect({ columnOffset: 0.5 }), input(6))
    // A pitch of 60 is shifted by 30; the block is pulled back up by half of that.
    expect(slots.map(xy)).toEqual([
      [-60, 45], [0, 15], [60, 45],
      [-60, -15], [0, -45], [60, -15],
    ])
  })

  it("shifts the other way for a negative offset", () => {
    const up = rectangularSlots(rect({ rowOffset: -0.5 }), input(6))
    expect(up.map(xy)).toEqual([
      [-45, 30], [15, 30], [75, 30],
      [-75, -30], [-15, -30], [45, -30],
    ])
  })

  it("is empty for no items", () => {
    expect(rectangularSlots(rect(), input(0))).toEqual([])
  })

  it("seats one item in the first cell of the block, or in the middle of it when the last line is centred", () => {
    expect(rectangularSlots(rect(), input(1)).map(xy)).toEqual([[-60, 0]])
    expect(rectangularSlots(rect({ lastLineAlign: "center" }), input(1)).map(xy)).toEqual([[0, 0]])
    expect(rectangularSlots(rect({ lastLineAlign: "end" }), input(1)).map(xy)).toEqual([[60, 0]])
  })
})

describe("radial slots: direction, sweep and the clock", () => {
  const ring = (over: Partial<RadialArrangement> = {}): RadialArrangement => ({
    kind: "radial",
    radius: 100,
    startAngle: 0,
    sweep: 360,
    direction: "clockwise",
    rotateItems: false,
    spinSpeed: 0,
    ...over,
  })

  it("goes the other way round when counterclockwise", () => {
    const slots = radialSlots(ring({ direction: "counterclockwise" }), input(4))
    expect(slots.map(xy)).toEqual([[0, 100], [-100, 0], [0, -100], [100, 0]])
    // The ordering still counts the way travelled, away from the first item.
    expect(slots.map((s) => s.meta)).toEqual([0, 90, 180, 270].map((angle) => ({ kind: "radial", angle })))
  })

  it("treats a negative sweep as the other direction", () => {
    expect(radialAngles(ring({ sweep: -90 }), 4, 0)).toEqual(radialAngles(ring({ sweep: 90, direction: "counterclockwise" }), 4, 0))
    expect(radialAngles(ring({ sweep: -90 }), 4, 0)[3]).toBeLessThan(0)
  })

  it("starts at startAngle, clockwise from twelve o'clock", () => {
    const slots = radialSlots(ring({ startAngle: 90 }), input(4))
    expect(slots.map(xy)).toEqual([[100, 0], [0, -100], [-100, 0], [0, 100]])
  })

  it("turns on its own at spinSpeed, from startAngle, with the clock", () => {
    const spinning = ring({ startAngle: 30, spinSpeed: 60 })
    expect(radialAngles(spinning, 3, 0)[0]).toBe(30)
    expect(radialAngles(spinning, 3, 2)[0]).toBe(150)
    // The whole ring turns together: the gaps stay as they were.
    const gaps = radialAngles(spinning, 3, 2).map((angle, i, all) => angle - (all[i - 1] ?? angle))
    expect(gaps.slice(1)).toEqual([120, 120])
  })

  it("is a frame of its time: the same time gives the same slots", () => {
    const spinning = ring({ spinSpeed: 45 })
    expect(radialSlots(spinning, { ...input(5), time: 3 })).toEqual(radialSlots(spinning, { ...input(5), time: 3 }))
  })

  it("puts a lone item at the start, and nothing for none", () => {
    expect(radialAngles(ring({ startAngle: 20 }), 1, 0)).toEqual([20])
    expect(radialSlots(ring(), input(0))).toEqual([])
  })

  it("spaces a full sweep evenly and an arc of 90 degrees from end to end", () => {
    expect(radialAngles(ring({ sweep: 360 }), 6, 0)).toEqual([0, 60, 120, 180, 240, 300])
    const arc = radialAngles(ring({ sweep: 90 }), 4, 0)
    expect(arc[0]).toBe(0)
    expect(arc[3]).toBeCloseTo(90, 2)
  })

  it("runs the spacing continuously from an arc into a ring, so a sweep animated to 360 lands without a jump", () => {
    const last = (sweep: number) => radialAngles(ring({ sweep }), 8, 0)[7]
    let previous = last(0)
    for (let sweep = 20; sweep <= 360; sweep += 20) {
      const angle = last(sweep)
      // Each step grows the span, never shrinks it, and by less than the sweep itself grows.
      expect(angle).toBeGreaterThanOrEqual(previous)
      previous = angle
    }
    expect(last(360)).toBeCloseTo(315)
    expect(last(359.99)).toBeCloseTo(last(360), 0)
  })

  it("turns items by their angle when asked, whichever way the ring runs", () => {
    const slots = radialSlots(ring({ rotateItems: true, direction: "counterclockwise" }), input(4))
    expect(slots.map((s) => s.rotation)).toEqual([0, -90, -180, -270])
  })

  it("turns an item to the top by the shorter way, from any start, and ignores the clock", () => {
    const spinning = ring({ startAngle: 30, spinSpeed: 500 })
    // Slot 1 of 4 sits at 120 degrees; slot 3 at 300.
    expect(radialTurnToTop(spinning, 4, 1)).toBe(-120)
    expect(radialTurnToTop(spinning, 4, 3)).toBe(60)
    expect(radialTurnToTop(spinning, 4, 0)).toBe(-30)
  })

  it("turns a counterclockwise ring the way its items go", () => {
    expect(radialTurnToTop(ring({ direction: "counterclockwise" }), 4, 1)).toBe(90)
  })

  it("turns by the start angle when the slot is not one of the ring's", () => {
    expect(radialTurnToTop(ring({ startAngle: 50 }), 4, 9)).toBe(-50)
  })
})

describe("wrapDegrees", () => {
  it("folds an angle into (-180, 180]", () => {
    expect(wrapDegrees(0)).toBe(0)
    expect(wrapDegrees(180)).toBe(180)
    expect(wrapDegrees(-180)).toBe(180)
    expect(wrapDegrees(190)).toBe(-170)
    expect(wrapDegrees(-190)).toBe(170)
    expect(wrapDegrees(360)).toBe(0)
    expect(wrapDegrees(720.5)).toBe(0.5)
    expect(wrapDegrees(-540)).toBe(180)
  })
})

describe("path templates", () => {
  const BOX = { width: 400, height: 200 }
  const CLOSED = ["circle", "square", "star", "heart", "infinity"]

  /** The end point of every command that has one. */
  const points = (path: ReturnType<typeof templatePath>) =>
    path.flatMap((command) => ("x" in command && "y" in command ? [{ x: command.x, y: command.y }] : []))

  /** Shoelace area, positive anticlockwise in y-up. */
  const area = (path: ReturnType<typeof templatePath>) => {
    const p = points(path)
    return p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length]
      return sum + (a.x * b.y - b.x * a.y) / 2
    }, 0)
  }

  it("lists nine templates", () => {
    expect([...PATH_TEMPLATES]).toEqual(["circle", "square", "star", "heart", "infinity", "wave", "spiral", "arc", "line"])
  })

  it.each([...PATH_TEMPLATES])("draws %s with finite coordinates, inside the box and across most of it", (template) => {
    const p = points(templatePath(template, BOX))
    expect(p.length).toBeGreaterThanOrEqual(2)
    for (const { x, y } of p) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(Math.abs(x)).toBeLessThanOrEqual(200 + 1e-9)
      expect(Math.abs(y)).toBeLessThanOrEqual(100 + 1e-9)
    }
    const xs = p.map((point) => point.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.8 * 400)
  })

  it.each(CLOSED)("closes %s", (template) => {
    const path = templatePath(template as (typeof PATH_TEMPLATES)[number], BOX)
    expect(path[0].type).toBe("M")
    expect(path[path.length - 1].type).toBe("Z")
    expect(path.filter((command) => command.type === "Z")).toHaveLength(1)
  })

  it.each(["wave", "spiral", "arc", "line"] as const)("leaves %s open", (template) => {
    const path = templatePath(template, BOX)
    expect(path[0].type).toBe("M")
    expect(path.some((command) => command.type === "Z")).toBe(false)
  })

  it.each(["circle", "square", "star", "heart"] as const)("runs %s clockwise", (template) => {
    // Clockwise in y-up is a negative signed area.
    expect(area(templatePath(template, BOX))).toBeLessThan(0)
  })

  it("starts the circle at the top, and the square at its top left", () => {
    expect(points(templatePath("circle", BOX))[0]).toEqual({ x: 0, y: 100 })
    expect(points(templatePath("square", BOX))[0]).toEqual({ x: -200, y: 100 })
  })

  it("runs the line, the wave and the arc left to right", () => {
    for (const template of ["line", "wave", "arc"] as const) {
      const p = points(templatePath(template, BOX))
      expect(p[0].x).toBeCloseTo(-200)
      expect(p[p.length - 1].x).toBeCloseTo(200)
    }
  })

  it("is the same array for the same template at the same size, and another for a different one", () => {
    expect(templatePath("star", BOX)).toBe(templatePath("star", { ...BOX }))
    expect(templatePath("star", BOX)).not.toBe(templatePath("star", { width: 400, height: 201 }))
    expect(templatePath("star", BOX)).not.toBe(templatePath("heart", BOX))
  })

  it("scales with the box", () => {
    const small = points(templatePath("square", { width: 100, height: 50 }))
    expect(small).toEqual([{ x: -50, y: 25 }, { x: 50, y: 25 }, { x: 50, y: -25 }, { x: -50, y: -25 }])
  })

  it("is drawn at 400 square where the grid has no box to fill", () => {
    expect(points(templatePath("square", { width: 0, height: 0 }))[0]).toEqual({ x: -200, y: 200 })
    expect(points(templatePath("square", { width: -5, height: 100 }))[0]).toEqual({ x: -200, y: 50 })
  })

  it.each([...PATH_TEMPLATES])("places items on %s: finite, inside the box and shown", (template) => {
    const path = templatePath(template, BOX)
    const arrangement: PathArrangement = {
      kind: "path",
      path,
      placement: { originX: 0, originY: 0, x: 0, y: 0, rotation: 0, scale: 1 },
      spacing: "distribute",
      spacingDistance: 50,
      offset: 0,
      flowSpeed: 0,
      trimStart: 0,
      trimEnd: 1,
      alignToPath: true,
    }
    const slots = pathSlots(arrangement, input(8))
    expect(slots).toHaveLength(8)
    for (const s of slots) {
      expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.rotation)).toBe(true)
      expect(Math.abs(s.x)).toBeLessThanOrEqual(200 + 1e-6)
      expect(Math.abs(s.y)).toBeLessThanOrEqual(100 + 1e-6)
      expect(s.opacity).toBe(1)
    }
    // An open path gives both ends an item; a closed one comes round without repeating its start.
    const p = points(path)
    const first = slots[0]
    const last = slots[7]
    expect(Math.hypot(first.x - p[0].x, first.y - p[0].y)).toBeLessThan(1)
    if (CLOSED.includes(template)) {
      expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(1)
    } else {
      expect(Math.hypot(last.x - p[p.length - 1].x, last.y - p[p.length - 1].y)).toBeLessThan(1)
    }
  })
})

describe("path slots: spacing, flow and alignment", () => {
  const along = (over: Partial<PathArrangement> = {}): PathArrangement => ({
    kind: "path",
    path: templatePath("line", { width: 400, height: 100 }),
    placement: { originX: 0, originY: 0, x: 0, y: 0, rotation: 0, scale: 1 },
    spacing: "distribute",
    spacingDistance: 50,
    offset: 0,
    flowSpeed: 0,
    trimStart: 0,
    trimEnd: 1,
    alignToPath: true,
    ...over,
  })

  it("moves items along the path with the clock at flowSpeed, on top of the offset", () => {
    // A share of 0.1 a second on a 400 px line is 40 px a second.
    const slots = (time: number) => pathSlots(along({ flowSpeed: 0.1, offset: 0.05 }), { ...input(3), time })
    expect(slots(0).slice(0, 2).map((s) => round(s.x))).toEqual([-180, 20])
    expect(slots(1).slice(0, 2).map((s) => round(s.x))).toEqual([-140, 60])
    // The last item has been pushed off the end of the line from the start.
    expect(slots(0).map((s) => s.opacity)).toEqual([1, 1, 0])
  })

  it("hides an item pushed off either end of an open path", () => {
    const slots = pathSlots(along({ offset: -0.3 }), input(5))
    expect(slots.map((s) => s.opacity)).toEqual([0, 0, 1, 1, 1])
  })

  it("wraps a flow round a closed path, so it never hides an item", () => {
    const circle = along({ path: templatePath("circle", { width: 200, height: 200 }) })
    for (const time of [0, 0.3, 1.7, 5]) {
      const slots = pathSlots({ ...circle, flowSpeed: 0.37 }, { ...input(6), time })
      expect(slots.every((s) => s.opacity === 1)).toBe(true)
    }
  })

  it("steps a fixed distance apart, however many items", () => {
    const slots = pathSlots(along({ spacing: "fixed", spacingDistance: 25 }), input(4))
    expect(slots.map((s) => round(s.x))).toEqual([-200, -175, -150, -125])
  })

  it("hides items a fixed distance takes past the end of an open path", () => {
    const slots = pathSlots(along({ spacing: "fixed", spacingDistance: 150 }), input(4))
    expect(slots.map((s) => s.opacity)).toEqual([1, 1, 1, 0])
  })

  it("leaves items upright when alignToPath is off, and turns them to the path when on", () => {
    const circle = templatePath("circle", { width: 200, height: 200 })
    const on = pathSlots(along({ path: circle }), input(4))
    const off = pathSlots(along({ path: circle, alignToPath: false }), input(4))
    expect(off.map((s) => s.rotation)).toEqual([0, 0, 0, 0])
    // At the top the clockwise path runs right, so an item's own right is the path's way: no turn.
    expect(Math.abs(wrapDegrees(on[0].rotation))).toBeLessThan(2)
    // At the right it runs down: a quarter turn clockwise.
    expect(Math.abs(wrapDegrees(on[1].rotation) - 90)).toBeLessThan(2)
  })

  it("places the path where its placement says: turned, scaled and moved, y-up", () => {
    const placed = pathSlots(
      along({ placement: { originX: 0, originY: 0, x: 10, y: -20, rotation: 90, scale: 0.5 } }),
      input(2),
    )
    // The line from (-200, 0) to (200, 0), scaled to half, turned a quarter clockwise, then moved.
    expect(placed.map(xy)).toEqual([[10, 80], [10, -120]])
  })

  it("measures from the placement's origin and can flip a y-down path", () => {
    const flipped = pathSlots(
      along({
        path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 0, y: 100 }],
        placement: { originX: 0, originY: 0, x: 0, y: 0, rotation: 0, scale: 1, flipY: true },
      }),
      input(2),
    )
    expect(flipped.map(xy)).toEqual([[0, 0], [0, -100]])
  })

  it("is empty for no items, and one item sits half way", () => {
    expect(pathSlots(along(), input(0))).toEqual([])
    expect(pathSlots(along(), input(1)).map((s) => round(s.x))).toEqual([0])
  })
})

describe("sphere slots: facing, culling and fade", () => {
  const ball = (over: Partial<SphereArrangement> = {}): SphereArrangement => ({
    kind: "sphere",
    radius: 100,
    yaw: 0,
    pitch: 0,
    roll: 0,
    facing: "outward",
    focalLength: 800,
    depthFade: 0,
    cullBackfaces: false,
    spinSpeed: 0,
    ...over,
  })

  it("keeps a billboard item facing the viewer: no tilt at all", () => {
    for (const s of sphereSlots(ball({ facing: "billboard", yaw: 40, pitch: 25 }), input(24))) {
      expect(s.rotationX).toBe(0)
      expect(s.rotationY).toBe(0)
    }
  })

  it("puts a billboard on the same place as an outward item", () => {
    const outward = sphereSlots(ball(), input(24))
    const billboard = sphereSlots(ball({ facing: "billboard" }), input(24))
    expect(billboard.map(xy)).toEqual(outward.map(xy))
  })

  it("never hides a billboard, whatever cullBackfaces says", () => {
    const slots = sphereSlots(ball({ facing: "billboard", cullBackfaces: true }), input(40))
    expect(slots.every((s) => s.opacity === 1)).toBe(true)
  })

  it("hides every face that turns away from a viewer an infinite way off, when there is no focal length", () => {
    const slots = sphereSlots(ball({ cullBackfaces: true, focalLength: 0 }), input(60))
    for (const s of slots) expect(s.opacity === 0).toBe(s.depth < 0)
    expect(slots.some((s) => s.opacity === 0)).toBe(true)
    expect(slots.some((s) => s.opacity === 1)).toBe(true)
  })

  it("hides more than the back half to a viewer close in: a camera 200 px away sees less than half of a sphere of 100", () => {
    // A face turns away once its normal's z drops below radius / focal length.
    const slots = sphereSlots(ball({ cullBackfaces: true, focalLength: 200 }), input(80))
    for (const s of slots) expect(s.opacity === 0, `depth ${s.depth}`).toBe(s.depth < 100 / 200 * 100)
    const half = sphereSlots(ball({ cullBackfaces: true, focalLength: 0 }), input(80)).filter((s) => s.opacity === 0).length
    expect(slots.filter((s) => s.opacity === 0).length).toBeGreaterThan(half)
  })

  it("hides fewer faces as the camera pulls back", () => {
    const hidden = (focalLength: number) => sphereSlots(ball({ cullBackfaces: true, focalLength }), input(80)).filter((s) => s.opacity === 0).length
    expect(hidden(150)).toBeGreaterThan(hidden(300))
    expect(hidden(300)).toBeGreaterThan(hidden(5000))
  })

  it("fades the back by depthFade: full at the front, 1 - depthFade at the back", () => {
    for (const depthFade of [0, 0.5, 1]) {
      for (const s of sphereSlots(ball({ depthFade }), input(30))) {
        const front = (s.meta.kind === "sphere" ? s.meta.depth : 0) + 1
        expect(s.opacity).toBeCloseTo(1 - depthFade * (1 - front / 2))
      }
    }
  })

  it("draws the front item opaque and the back item at 1 - depthFade", () => {
    const slots = sphereSlots(ball({ depthFade: 1 }), input(61))
    const front = slots.reduce((a, b) => (b.depth > a.depth ? b : a))
    const back = slots.reduce((a, b) => (b.depth < a.depth ? b : a))
    expect(front.opacity).toBeGreaterThan(0.99)
    expect(back.opacity).toBeLessThan(0.01)
  })

  it("turns with the clock about the vertical axis, as yaw does", () => {
    const spun = sphereSlots(ball({ spinSpeed: 90 }), { ...input(12), time: 1 })
    const turned = sphereSlots(ball({ yaw: 90 }), input(12))
    expect(spun.map(xy)).toEqual(turned.map(xy))
  })

  it("rolls about the view axis: positions turn clockwise and depth is untouched", () => {
    const flat = sphereSlots(ball(), input(12))
    const rolled = sphereSlots(ball({ roll: 90 }), input(12))
    flat.forEach((s, i) => {
      expect(rolled[i].depth).toBeCloseTo(s.depth)
      expect(rolled[i].x).toBeCloseTo(s.y)
      expect(rolled[i].y).toBeCloseTo(-s.x)
    })
  })

  it("puts a lone item at the front", () => {
    const [only] = sphereSlots(ball(), input(1))
    expect([only.x, only.y, only.depth]).toEqual([0, 0, 100])
  })

  it("lays the lattice from near the top to near the bottom", () => {
    const ys = Array.from({ length: 10 }, (_, k) => fibonacciPoint(k, 10)[1])
    expect(ys).toEqual([...ys].sort((a, b) => b - a))
    expect(ys[0]).toBeCloseTo(0.9)
    expect(ys[9]).toBeCloseTo(-0.9)
    expect(fibonacciPoint(0, 1)).toEqual([0, 0, 1])
  })
})

describe("arrangements: slotsOf and focalLengthOf", () => {
  it("lays out each kind of arrangement through its own function", () => {
    const rectangular = rect()
    expect(slotsOf(rectangular, input(4))).toEqual(rectangularSlots(rectangular, input(4)))
    const ring: RadialArrangement = { kind: "radial", radius: 100, startAngle: 0, sweep: 360, direction: "clockwise", rotateItems: false, spinSpeed: 0 }
    expect(slotsOf(ring, input(4))).toEqual(radialSlots(ring, input(4)))
  })

  it("sees a sphere through a camera of its focal length, at least 1, and a flat arrangement through none", () => {
    const sphere: SphereArrangement = {
      kind: "sphere", radius: 100, yaw: 0, pitch: 0, roll: 0, facing: "outward", focalLength: 900, depthFade: 0, cullBackfaces: false, spinSpeed: 0,
    }
    expect(focalLengthOf(sphere)).toBe(900)
    expect(focalLengthOf({ ...sphere, focalLength: 0 })).toBe(1)
    expect(focalLengthOf({ ...sphere, focalLength: -50 })).toBe(1)
    expect(focalLengthOf(rect())).toBe(0)
  })
})

describe("stagger: every order", () => {
  const six = rectangularSlots(rect(), input(6))
  const ring = radialSlots(
    { kind: "radial", radius: 100, startAngle: 0, sweep: 360, direction: "clockwise", rotateItems: false, spinSpeed: 0 },
    input(4),
  )
  const line = pathSlots(
    {
      kind: "path",
      path: templatePath("line", { width: 400, height: 100 }),
      placement: { originX: 0, originY: 0, x: 0, y: 0, rotation: 0, scale: 1 },
      spacing: "distribute",
      spacingDistance: 50,
      offset: 0,
      flowSpeed: 0,
      trimStart: 0,
      trimEnd: 1,
      alignToPath: true,
    },
    input(5),
  )
  const ball = sphereSlots(
    { kind: "sphere", radius: 100, yaw: 0, pitch: 0, roll: 0, facing: "outward", focalLength: 800, depthFade: 0, cullBackfaces: false, spinSpeed: 0 },
    input(20),
  )
  /** The items in the order they go. */
  const sequence = (ranks: readonly number[]) => ranks.map((rank, item) => [rank, item]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, item]) => item)

  it("has ten orders", () => {
    expect([...STAGGER_ORDERS]).toEqual(["index", "reverse", "random", "centerOut", "edgesIn", "row", "column", "angle", "path", "depth"])
  })

  it("goes last item first for reverse", () => {
    expect(staggerRanks("reverse", six, 1)).toEqual([1, 0.8, 0.6, 0.4, 0.2, 0])
  })

  it("goes from the outermost items in for edgesIn, with the corners first", () => {
    const ranks = staggerRanks("edgesIn", six, 1)
    expect(ranks).toEqual([0, 1, 0, 0, 1, 0])
  })

  it("goes clockwise from twelve o'clock round a ring for angle", () => {
    expect(staggerRanks("angle", ring, 1)).toEqual([0, 1 / 3, 2 / 3, 1])
  })

  it("goes clockwise from twelve o'clock for angle on a rectangular grid or a sphere too", () => {
    // Top middle, then round to the right, and down to the left, back up to the top left.
    expect(sequence(staggerRanks("angle", six, 1))).toEqual([1, 2, 5, 4, 3, 0])
    const around = staggerRanks("angle", ball, 1)
    expect(around).toHaveLength(20)
    expect(Math.min(...around)).toBe(0)
    expect(Math.max(...around)).toBe(1)
  })

  it("falls back to item order for angle on a path", () => {
    expect(staggerRanks("angle", line, 1)).toEqual(staggerRanks("index", line, 1))
  })

  it("goes along the path for path, and follows item order elsewhere", () => {
    expect(staggerRanks("path", line, 1)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(staggerRanks("path", six, 1)).toEqual(staggerRanks("index", six, 1))
    expect(staggerRanks("path", ball, 1)).toEqual(staggerRanks("index", ball, 1))
  })

  it("goes front to back of a sphere for depth, and follows item order elsewhere", () => {
    const ranks = staggerRanks("depth", ball, 1)
    const frontmost = ball.reduce((best, s, i) => (s.depth > ball[best].depth ? i : best), 0)
    const backmost = ball.reduce((best, s, i) => (s.depth < ball[best].depth ? i : best), 0)
    expect(ranks[frontmost]).toBe(0)
    expect(ranks[backmost]).toBe(1)
    expect(staggerRanks("depth", six, 1)).toEqual(staggerRanks("index", six, 1))
    expect(staggerRanks("depth", ring, 1)).toEqual(staggerRanks("index", ring, 1))
  })

  it("goes top to bottom for row on anything that is not a rectangular grid", () => {
    // A ring's items sit at y = 100, 0, -100, 0: the two at the sides tie.
    expect(staggerRanks("row", ring, 1)).toEqual([0, 0.5, 1, 0.5])
  })

  it("goes left to right for column on anything that is not a rectangular grid", () => {
    expect(staggerRanks("column", ring, 1)).toEqual([0.5, 1, 0.5, 0])
  })

  it("sends a ring out from its centre all at once, since its items tie", () => {
    expect(staggerRanks("centerOut", ring, 1)).toEqual([0, 0, 0, 0])
    expect(staggerRanks("edgesIn", ring, 1)).toEqual([0, 0, 0, 0])
  })

  it("deals a random order from the seed, a different one for another", () => {
    const deal = (seed: number) => staggerRanks("random", six, seed)
    expect(deal(7)).toEqual(deal(7))
    expect(deal(7)).not.toEqual(deal(8))
    expect([...deal(8)].sort()).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it("ranks nothing for no items, and everything 0 for one", () => {
    for (const order of STAGGER_ORDERS) {
      expect(staggerRanks(order, [], 1)).toEqual([])
      expect(staggerRanks(order, six.slice(0, 1), 1)).toEqual([0])
    }
  })

  it("gives every rank in 0..1 for every order on every arrangement", () => {
    for (const order of STAGGER_ORDERS) {
      for (const slots of [six, ring, line, ball]) {
        for (const rank of staggerRanks(order, slots, 3)) {
          expect(rank).toBeGreaterThanOrEqual(0)
          expect(rank).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe("staggerProgress: a stagger inside the command", () => {
  it("finishes every item with the command, even at the largest stagger", () => {
    for (const rank of [0, 0.01, 0.25, 0.5, 0.99, 1]) {
      expect(staggerProgress(rank, 1, 0.95)).toBe(1)
    }
  })

  it("starts the last item at 95% of the command at the largest stagger, and the first at once", () => {
    expect(staggerProgress(1, 0.95, 0.95)).toBe(0)
    expect(staggerProgress(1, 0.975, 0.95)).toBeCloseTo(0.5)
    expect(staggerProgress(0, 0.025, 0.95)).toBeCloseTo(0.5)
    expect(staggerProgress(0, 0.05, 0.95)).toBeCloseTo(1, 12)
  })

  it("holds the stagger to 0.95, so a larger one reads the same", () => {
    for (const rank of [0, 0.3, 1]) {
      for (const t of [0, 0.4, 0.97, 1]) {
        expect(staggerProgress(rank, t, 3)).toBe(staggerProgress(rank, t, 0.95))
      }
    }
  })

  it("has no stagger below 0: every item runs the whole command", () => {
    for (const rank of [0, 0.5, 1]) {
      expect(staggerProgress(rank, 0.4, -1)).toBe(0.4)
      expect(staggerProgress(rank, 0.4, 0)).toBe(0.4)
    }
  })

  it("is clamped to 0..1 whatever the time", () => {
    expect(staggerProgress(0.5, -3, 0.5)).toBe(0)
    expect(staggerProgress(0.5, 3, 0.5)).toBe(1)
  })

  it("makes the time the offsets take a share of the command, not of the items: more items fit the same length", () => {
    const lastStart = (items: number) => {
      const slots = rectangularSlots(rect({ columns: 4 }), input(items))
      const ranks = staggerRanks("index", slots, 1)
      // The first t at which the last item has begun.
      let t = 0
      while (staggerProgress(ranks[items - 1], t, 0.5) === 0) t += 0.001
      return Math.round(t * 100) / 100
    }
    expect(lastStart(4)).toBe(lastStart(400))
  })
})
