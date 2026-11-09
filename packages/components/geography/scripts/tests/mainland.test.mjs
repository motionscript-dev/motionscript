import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { boundsDiagonal, boundsGap, boundsIntersect, mainlandParts } from "../lib/mainland.mjs"

// `geoBounds` boxes: [[west, south], [east, north]].
const box = (west, south, east, north) => [
  [west, south],
  [east, north],
]
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)
const cosDeg = (degrees) => Math.cos((degrees * Math.PI) / 180)

describe("boundsGap", () => {
  test("is 0 for boxes that overlap or touch", () => {
    assert.equal(boundsGap(box(0, 0, 10, 10), box(5, 5, 15, 15)), 0)
    assert.equal(boundsGap(box(0, 0, 10, 10), box(10, 0, 20, 10)), 0)
  })

  test("is the latitude gap when the boxes share longitudes", () => {
    near(boundsGap(box(0, 0, 10, 10), box(0, 30, 10, 40)), 20)
  })

  test("scales the longitude gap by the cosine of the latitude between them", () => {
    near(boundsGap(box(0, 0, 10, 10), box(20, 0, 30, 10)), 10 * cosDeg(5))
  })

  test("never scales the longitude gap below a fifth, so a polar gap does not vanish", () => {
    // Mid latitude 82.5 has a cosine of about 0.13, under the floor.
    near(boundsGap(box(0, 80, 10, 85), box(90, 80, 100, 85)), 80 * 0.2)
  })

  test("combines both gaps", () => {
    near(boundsGap(box(0, 0, 10, 10), box(20, 30, 30, 40)), Math.hypot(10 * cosDeg(20), 20))
  })

  test("sees two boxes either side of the antimeridian as touching", () => {
    assert.equal(boundsGap(box(170, 0, 180, 10), box(-180, 0, -170, 10)), 0)
  })

  test("takes the short way round the globe", () => {
    // 170..175 and -175..-170 are 10 degrees apart across the antimeridian, not 340 the other way.
    near(boundsGap(box(170, 0, 175, 1), box(-175, 0, -170, 1)), 10 * cosDeg(0.5))
  })
})

describe("boundsDiagonal", () => {
  test("is the width and height of a box centred on the equator", () => {
    near(boundsDiagonal(box(0, -1, 3, 1)), Math.hypot(3, 2))
  })

  test("scales the width by the cosine of the middle latitude", () => {
    near(boundsDiagonal(box(0, 0, 3, 4)), Math.hypot(3 * cosDeg(2), 4))
    near(boundsDiagonal(box(0, 60, 3, 64)), Math.hypot(3 * cosDeg(62), 4))
  })

  test("measures a box that crosses the antimeridian by its width across it", () => {
    near(boundsDiagonal(box(170, 0, -170, 10)), Math.hypot(20 * cosDeg(5), 10))
  })
})

describe("boundsIntersect", () => {
  test("holds for boxes that overlap", () => {
    assert.equal(boundsIntersect(box(0, 0, 10, 10), box(5, 5, 15, 15)), true)
  })

  test("allows half a degree of tolerance by default, and the one it is given", () => {
    assert.equal(boundsIntersect(box(0, 0, 10, 10), box(10.4, 0, 20, 10)), true)
    assert.equal(boundsIntersect(box(0, 0, 10, 10), box(10.6, 0, 20, 10)), false)
    assert.equal(boundsIntersect(box(0, 0, 10, 10), box(11.5, 0, 20, 10), 2), true)
  })

  test("looks at latitude too", () => {
    assert.equal(boundsIntersect(box(0, 0, 10, 10), box(0, 10.4, 10, 20)), true)
    assert.equal(boundsIntersect(box(0, 0, 10, 10), box(0, 10.6, 10, 20)), false)
  })

  test("holds across the antimeridian", () => {
    assert.equal(boundsIntersect(box(170, 0, 180, 10), box(-180, 0, -170, 10)), true)
  })
})

describe("mainlandParts", () => {
  const part = (area, bounds, centroid) => ({ area, bounds, centroid })

  test("has nothing to cut from a region of one part, or none", () => {
    assert.equal(mainlandParts("XX", [part(1, box(0, 0, 10, 10), [5, 5])]), null)
    assert.equal(mainlandParts("XX", []), null)
  })

  test("keeps the largest part, one a tenth of its size, and one close by, and drops one far away", () => {
    const big = part(1, box(0, 0, 10, 10), [5, 5])
    const large = part(0.2, box(50, 0, 60, 10), [55, 5])
    const close = part(0.001, box(11, 0, 12, 1), [11.5, 0.5])
    const remote = part(0.001, box(100, 50, 101, 51), [100.5, 50.5])
    assert.deepEqual(mainlandParts("XX", [big, large, close, remote]), [0, 1, 2])
  })

  test("reaches at least two degrees, and three quarters of the largest part's diagonal when that is more", () => {
    const small = part(1, box(0, 0, 1, 1), [0.5, 0.5])
    const withinTwo = part(0.001, box(2.5, 0, 3, 1), [2.75, 0.5])
    const beyondTwo = part(0.001, box(3.5, 0, 4, 1), [3.75, 0.5])
    assert.deepEqual(mainlandParts("XX", [small, withinTwo, beyondTwo]), [0, 1])

    const wide = part(1, box(0, 0, 40, 0.1), [20, 0])
    // The diagonal is about 40, so the reach is about 30.
    const twentyFiveOut = part(0.001, box(65, 0, 66, 0.1), [65.5, 0])
    const fiftyOut = part(0.001, box(90, 0, 91, 0.1), [90.5, 0])
    assert.deepEqual(mainlandParts("XX", [wide, twentyFiveOut, fiftyOut]), [0, 1])
  })

  test("returns null when every part is mainland", () => {
    const a = part(1, box(0, 0, 10, 10), [5, 5])
    const b = part(0.5, box(11, 0, 20, 10), [15, 5])
    assert.equal(mainlandParts("XX", [a, b]), null)
  })

  test("uses a country's own box where it has one, whatever the sizes", () => {
    const lower48 = part(10, box(-125, 25, -67, 49), [-98, 39])
    const alaska = part(100, box(-170, 52, -130, 71), [-150, 64])
    const hawaii = part(0.01, box(-160, 18, -154, 22), [-157, 20])
    // Alaska is the largest part and the country's own box still rules it remote.
    assert.deepEqual(mainlandParts("US", [lower48, alaska, hawaii]), [0])
  })

  test("keeps the largest part when no part is inside the country's box", () => {
    const a = part(1, box(0, 0, 1, 1), [0, 0])
    const b = part(5, box(10, 10, 11, 11), [10, 10])
    assert.deepEqual(mainlandParts("FR", [a, b]), [1])
  })

  test("returns null when every part is inside the country's box", () => {
    const a = part(1, box(0, 45, 1, 46), [0.5, 45.5])
    const b = part(1, box(2, 45, 3, 46), [2.5, 45.5])
    assert.equal(mainlandParts("FR", [a, b]), null)
  })
})
