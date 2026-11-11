import { describe, expect, it } from "vitest"

import type { DataRecord } from "@motionscript/sdk"

import { seriesPoints } from "./shared"
import { formatInstant, parseInstant, resolveXScale } from "./x-scale"

/**
 * What a line chart's x column is allowed to be.
 *
 * The bug this replaces was silent: a `Month` column of `Jan…Dec` went through
 * `num()`, which reads a non-numeric cell as `0`, so all twelve points landed
 * on one x and the chart drew a vertical line. No error, no empty plot — a
 * wrong picture. Hence the shape of these tests: every one of them checks that
 * distinct rows get *distinct, ordered* positions, because that single property
 * is what was lost.
 */

const rows = (field: string, values: unknown[]): DataRecord[] =>
  values.map((v, i) => ({ [field]: v, y: i })) as DataRecord[]

const xs = (data: DataRecord[], field: string): number[] => {
  const scale = resolveXScale(data, field)
  return data.map((_, i) => scale.at(i))
}

const strictlyRising = (values: number[]) =>
  values.every((v, i) => i === 0 || v > values[i - 1])

describe("parseInstant", () => {
  it("reads the date, month and week forms a spreadsheet holds", () => {
    expect(parseInstant("2026-03-14")).toBe(Date.UTC(2026, 2, 14))
    expect(parseInstant("2026/03/14")).toBe(Date.UTC(2026, 2, 14))
    expect(parseInstant("2026-03")).toBe(Date.UTC(2026, 2, 1))
    expect(parseInstant("Mar 2026")).toBe(Date.UTC(2026, 2, 1))
    expect(parseInstant("March 2026")).toBe(Date.UTC(2026, 2, 1))
    expect(parseInstant("2026 Mar")).toBe(Date.UTC(2026, 2, 1))
    expect(parseInstant("14 Mar 2026")).toBe(Date.UTC(2026, 2, 14))
    expect(parseInstant("Mar 14, 2026")).toBe(Date.UTC(2026, 2, 14))
  })

  it("takes any unambiguous abbreviation of a month", () => {
    for (const form of ["jan", "Jan", "JANUARY", "januar"]) {
      expect(parseInstant(form)).toBe(parseInstant("January"))
    }
    // Three letters is the floor, and a longer word still has to be the month.
    expect(parseInstant("ja")).toBeNull()
    expect(parseInstant("janitor")).toBeNull()
  })

  it("puts ISO weeks a week apart, starting on the Monday", () => {
    const w1 = parseInstant("2026-W01")
    const w2 = parseInstant("2026-W02")
    expect(w1).not.toBeNull()
    expect((w2 as number) - (w1 as number)).toBe(7 * 86_400_000)
    expect(new Date(w1 as number).getUTCDay()).toBe(1)
    // The looser spellings a person types.
    expect(parseInstant("2026 W1")).toBe(w1)
    expect(parseInstant("week 1")).toBe(parseInstant("W01"))
  })

  it("refuses what it cannot read unambiguously", () => {
    // Month-first or day-first? The answer depends on where the author lives,
    // so this is not a date as far as the chart is concerned.
    expect(parseInstant("03/04/2026")).toBeNull()
    expect(parseInstant("Q1")).toBeNull()
    expect(parseInstant("North")).toBeNull()
    expect(parseInstant("2026-13")).toBeNull()
    expect(parseInstant("2026-W54")).toBeNull()
    expect(parseInstant(2026)).toBeNull()
    expect(parseInstant("")).toBeNull()
  })
})

describe("resolveXScale", () => {
  it("plots a numeric column by its numbers", () => {
    const data = rows("x", [0, 5, 40])
    const scale = resolveXScale(data, "x")
    expect(scale.kind).toBe("numeric")
    expect(xs(data, "x")).toEqual([0, 5, 40])
    expect(scale.extent).toEqual([0, 40])
    // Round numbers between the samples — a continuous axis is read by scale.
    expect(scale.ticks([0, 40], 4)).toEqual([0, 10, 20, 30, 40])
  })

  it("spaces a month column by month, and captions it as written", () => {
    const data = rows("Month", ["Jan", "Feb", "Mar", "Apr"])
    const scale = resolveXScale(data, "Month")

    expect(scale.kind).toBe("time")
    // Each month has its own x; none collapse onto 0.
    expect(strictlyRising(xs(data, "Month"))).toBe(true)
    // February is shorter than January, and the axis says so.
    const [jan, feb, mar] = xs(data, "Month")
    expect(mar - feb).toBeLessThan(feb - jan)
    // The tick says what the cell said, not the instant it parsed to.
    expect(scale.label(jan)).toBe("Jan")
  })

  it("spaces real dates by their real gaps", () => {
    const data = rows("day", ["2026-01-01", "2026-01-02", "2026-06-01"])
    const [a, b, c] = xs(data, "day")
    expect(b - a).toBe(86_400_000)
    // A five-month hole in the data reads as a five-month hole in the plot.
    expect(c - b).toBeGreaterThan(100 * 86_400_000)
  })

  it("ticks a time axis on rows rather than between them", () => {
    const data = rows(
      "Month",
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"]
    )
    const scale = resolveXScale(data, "Month")
    const ticks = scale.ticks(scale.extent, 4)
    const positions = xs(data, "Month")

    expect(ticks.length).toBeLessThanOrEqual(5)
    for (const tick of ticks) expect(positions).toContain(tick)
    // Ends included, so the axis spans what it says it spans.
    expect(ticks[0]).toBe(positions[0])
    expect(ticks[ticks.length - 1]).toBe(positions[positions.length - 1])
    // Every tick is captioned with a month the file actually names.
    expect(ticks.map((t) => scale.label(t))).toEqual([
      "Jan",
      "Mar",
      "May",
      "Jun",
      "Aug",
    ])
  })

  it("collapses a burst of rows too close together to caption", () => {
    // Three days in one week, a six-week hole, three in another. Taking every
    // nth sample would print five dates in two clusters, overlapping; the ticks
    // follow where an evenly spaced axis wanted them instead.
    const data = rows("day", [
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
    ])
    const scale = resolveXScale(data, "day")
    const labels = scale.ticks(scale.extent, 4).map((t) => scale.label(t))

    expect(labels).toEqual([
      "2026-01-05",
      "2026-01-19",
      "2026-03-02",
      "2026-03-16",
    ])
  })

  it("falls back to row order for a column that is neither", () => {
    const data = rows("region", ["North", "South", "East"])
    const scale = resolveXScale(data, "region")

    expect(scale.kind).toBe("ordinal")
    expect(xs(data, "region")).toEqual([0, 1, 2])
    // First and last rows sit on the plot's edges, which is where they're read.
    expect(scale.extent).toEqual([0, 2])
    expect(scale.label(1)).toBe("South")
  })

  it("takes one text cell as proof the column isn't numeric", () => {
    // Plotting the "n/a" row at 0 would drag the x scale out of shape.
    const data = rows("x", [10, "n/a", 30])
    expect(resolveXScale(data, "x").kind).toBe("ordinal")
  })

  it("keeps a blank x cell in its row's place", () => {
    const data = rows("Month", ["Jan", "", "Mar"])
    const scale = resolveXScale(data, "Month")
    expect(scale.kind).toBe("time")
    // Not the epoch, which would drag the scale back fifty years.
    expect(xs(data, "Month")[1]).toBe(xs(data, "Month")[0])
  })

  it("holds up with no column named and no rows", () => {
    expect(resolveXScale([], "").extent).toEqual([0, 1])
    expect(resolveXScale(rows("x", [1, 2]), "").kind).toBe("ordinal")
  })
})

describe("seriesPoints", () => {
  it("pairs each row's scale position with its own y column", () => {
    const data: DataRecord[] = [
      { Month: "Mar", sales: 3 },
      { Month: "Jan", sales: 1 },
      { Month: "Feb", sales: 2 },
    ]
    const scale = resolveXScale(data, "Month")
    const points = seriesPoints(data, scale, {
      field: "sales",
      label: "",
      fill: undefined,
    })

    // Sorted along x, so the polyline traces left-to-right whatever order the
    // rows arrived in — and the y values travel with their own rows.
    expect(points.map(([, y]) => y)).toEqual([1, 2, 3])
    expect(strictlyRising(points.map(([x]) => x))).toBe(true)
  })
})

describe("formatInstant", () => {
  const DAY = 86_400_000
  const mar14 = Date.UTC(2026, 2, 14)

  it("captions to the year when the axis spans more than four years", () => {
    expect(formatInstant(mar14, 5 * 365 * DAY)).toBe("2026")
    expect(formatInstant(mar14, 4 * 365 * DAY + 1)).toBe("2026")
  })

  it("captions to the month and the year across a span of more than sixty days", () => {
    expect(formatInstant(mar14, 4 * 365 * DAY)).toBe("Mar 2026")
    expect(formatInstant(mar14, 365 * DAY)).toBe("Mar 2026")
    expect(formatInstant(mar14, 61 * DAY)).toBe("Mar 2026")
  })

  it("captions to the day of the month across a span of sixty days or fewer", () => {
    expect(formatInstant(mar14, 60 * DAY)).toBe("Mar 14")
    expect(formatInstant(mar14, 2 * DAY)).toBe("Mar 14")
    expect(formatInstant(mar14, 0)).toBe("Mar 14")
  })

  it("names every month by its three-letter abbreviation, capitalised", () => {
    const names = Array.from({ length: 12 }, (_, month) => formatInstant(Date.UTC(2026, month, 1), 30 * DAY))
    expect(names).toEqual(["Jan 1", "Feb 1", "Mar 1", "Apr 1", "May 1", "Jun 1", "Jul 1", "Aug 1", "Sep 1", "Oct 1", "Nov 1", "Dec 1"])
  })

  it("reads the date in UTC, so the caption does not move with the host's time zone", () => {
    expect(formatInstant(Date.UTC(2026, 0, 1, 0, 0, 0), 30 * DAY)).toBe("Jan 1")
    expect(formatInstant(Date.UTC(2026, 0, 31, 23, 59, 59), 30 * DAY)).toBe("Jan 31")
  })
})

describe("a time axis' ticks that are not samples", () => {
  const data = rows("when", ["2026-01-01", "2026-01-15", "2026-03-01", "2026-12-31"])

  it("captions a sample with the cell the author wrote", () => {
    const scale = resolveXScale(data, "when")
    expect(scale.label(scale.at(1))).toBe("2026-01-15")
  })

  it("captions a tick that is not a row with the date it falls on, at the granularity the span can tell apart", () => {
    const scale = resolveXScale(data, "when")
    const between = (scale.at(1) + scale.at(2)) / 2
    // A year of data: months and years.
    expect(scale.label(between)).toMatch(/^[A-Z][a-z]{2} 2026$/)
  })

  it("captions a short span with the day", () => {
    const short = resolveXScale(rows("when", ["2026-03-01", "2026-03-10"]), "when")
    expect(short.label((short.at(0) + short.at(1)) / 2)).toBe("Mar 5")
  })

  it("places its ticks on samples, whatever range it is asked for", () => {
    const scale = resolveXScale(data, "when")
    const ticks = scale.ticks([scale.at(0), scale.at(3)], 4)
    const samples = data.map((_, i) => scale.at(i))
    for (const tick of ticks) expect(samples).toContain(tick)
  })

  it("falls back to evenly spaced values when no sample is inside the range it is asked for", () => {
    const scale = resolveXScale(data, "when")
    const lo = scale.at(1) + 1
    const hi = scale.at(2) - 1
    const ticks = scale.ticks([lo, hi], 2)
    expect(ticks).toHaveLength(3)
    expect(ticks[0]).toBe(lo)
    expect(ticks[2]).toBe(hi)
  })
})

describe("an ordinal axis' ticks", () => {
  it("captions a tick that is not a row with nothing", () => {
    const scale = resolveXScale(rows("k", ["a", "b", "c"]), "k")
    expect(scale.label(-5)).toBe("")
    expect(scale.label(99)).toBe("")
  })

  it("captions a tick by the row it rounds to", () => {
    const scale = resolveXScale(rows("k", ["a", "b", "c"]), "k")
    expect(scale.label(0.4)).toBe("a")
    expect(scale.label(1.6)).toBe("c")
  })

  it("ticks on rows: a range between two rows holds neither", () => {
    const scale = resolveXScale(rows("k", ["a", "b", "c", "d"]), "k")
    expect(scale.ticks([0.2, 0.8], 2)).toHaveLength(3)
  })
})

describe("the number-format pattern on a numeric x axis", () => {
  const data = rows("n", [1234.5, 2345.25, 9999])

  it("writes each tick with the pattern", () => {
    const scale = resolveXScale(data, "n", "#,##0.00")
    expect(scale.label(1234.5)).toBe("1,234.50")
    expect(scale.label(9999)).toBe("9,999.00")
  })

  it("applies a prefix", () => {
    expect(resolveXScale(data, "n", "$#,##0").label(2345.25)).toBe("$2,345")
  })

  it("writes the plain marker format with no pattern", () => {
    const scale = resolveXScale(data, "n")
    expect(scale.label(2)).toBe("2")
    expect(scale.label(2.5)).toBe("2.5")
  })

  it("is ignored by a column that is not numeric: a tick there is the cell the author wrote", () => {
    const quarters = resolveXScale(rows("q", ["Q1", "Q2"]), "q", "#,##0.00")
    expect(quarters.kind).toBe("ordinal")
    expect(quarters.label(0)).toBe("Q1")
    const dates = resolveXScale(rows("d", ["2026-01-01", "2026-02-01"]), "d", "#,##0.00")
    expect(dates.kind).toBe("time")
    expect(dates.label(dates.at(0))).toBe("2026-01-01")
  })

  it("ticks a numeric axis at evenly spaced round values, not on rows", () => {
    const scale = resolveXScale(data, "n", "#,##0")
    expect(scale.ticks([0, 100], 4)).toEqual([0, 25, 50, 75, 100])
  })
})

