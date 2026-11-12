import { describe, expect, it } from "vitest"

import { lerpAxisDomain, resolveAxisDomain, type AxisDomainConfig } from "./shared"

/** An axis's data domain: merged field by field, and tweened numerically where both sides state a value. */

describe("resolveAxisDomain", () => {
  it("fills a domain that is stated in part: no caption is the empty caption, and the rest stays unset", () => {
    expect(resolveAxisDomain(undefined)).toEqual({ label: "", range: undefined, ticks: undefined, format: undefined })
    expect(resolveAxisDomain({ range: [0, 10] })).toEqual({ label: "", range: [0, 10], ticks: undefined, format: undefined })
  })

  it("merges a partial write onto the previous domain, each field on its own", () => {
    const first = resolveAxisDomain({ label: "Revenue", range: [0, 100] })
    const second = resolveAxisDomain({ ticks: [0, 50, 100], format: "$#,##0" }, first)
    expect(second).toEqual({ label: "Revenue", range: [0, 100], ticks: [0, 50, 100], format: "$#,##0" })
  })

  it("lets a later write replace a field it states", () => {
    const first = resolveAxisDomain({ label: "A", range: [0, 1] })
    expect(resolveAxisDomain({ label: "B" }, first)).toEqual({ label: "B", range: [0, 1], ticks: undefined, format: undefined })
  })
})

describe("lerpAxisDomain", () => {
  const A: AxisDomainConfig = { label: "A", range: [0, 10], ticks: [0, 5, 10], format: "0" }
  const B: AxisDomainConfig = { label: "B", range: [10, 30], ticks: [10, 20, 30], format: "0.0" }

  it("blends a range and its ticks numerically when both sides state them", () => {
    const mid = lerpAxisDomain(A, B, 0.5)
    expect(mid.range).toEqual([5, 20])
    expect(mid.ticks).toEqual([5, 12.5, 20])
  })

  it("steps the caption and the format at the midpoint", () => {
    expect(lerpAxisDomain(A, B, 0.49)).toMatchObject({ label: "A", format: "0" })
    expect(lerpAxisDomain(A, B, 0.5)).toMatchObject({ label: "B", format: "0.0" })
  })

  it("is each side at the ends", () => {
    expect(lerpAxisDomain(A, B, 0)).toEqual(A)
    expect(lerpAxisDomain(A, B, 1)).toEqual(B)
  })

  it("pairs ticks by index and holds the longer side's tail", () => {
    const longer: AxisDomainConfig = { label: "", range: [0, 10], ticks: [0, 2, 4, 6, 8, 10] }
    const shorter: AxisDomainConfig = { label: "", range: [0, 10], ticks: [0, 10] }
    const mid = lerpAxisDomain(shorter, longer, 0.5)
    expect(mid.ticks).toHaveLength(6)
    expect(mid.ticks![0]).toBe(0)
    expect(mid.ticks![1]).toBe(6)
    // Past the shorter side's end: the longer side's own values.
    expect(mid.ticks!.slice(2)).toEqual([4, 6, 8, 10])
  })

  it("steps a range that only one side states, rather than blending it from nothing", () => {
    const auto: AxisDomainConfig = { label: "" }
    const explicit: AxisDomainConfig = { label: "", range: [0, 40] }
    expect(lerpAxisDomain(auto, explicit, 0.3).range).toBeUndefined()
    expect(lerpAxisDomain(auto, explicit, 0.7).range).toEqual([0, 40])
    expect(lerpAxisDomain(explicit, auto, 0.3).range).toEqual([0, 40])
    expect(lerpAxisDomain(explicit, auto, 0.7).range).toBeUndefined()
  })

  it("steps the ticks of an auto side the same way", () => {
    const auto: AxisDomainConfig = { label: "" }
    const explicit: AxisDomainConfig = { label: "", ticks: [0, 10] }
    expect(lerpAxisDomain(auto, explicit, 0.3).ticks).toBeUndefined()
    expect(lerpAxisDomain(auto, explicit, 0.7).ticks).toEqual([0, 10])
  })

  it("stays auto when both sides are", () => {
    expect(lerpAxisDomain({ label: "" }, { label: "" }, 0.5)).toEqual({ label: "", range: undefined, ticks: undefined, format: undefined })
  })
})
