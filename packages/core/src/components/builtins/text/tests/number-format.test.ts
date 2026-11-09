import { describe, expect, it } from "vitest"

import {
  NUMBER_PATTERNS,
  formatNumber,
  patternFor,
} from "../number-format"

/**
 * The pattern language, and the four named formats built out of it.
 *
 * The named formats are asserted *through* `formatNumber` rather than by
 * comparing pattern strings, because a preset is only worth having if it prints
 * what its name says — and `plain` in particular has to keep printing exactly
 * what `formatMarker` printed before formats existed, or every chart already
 * drawn re-labels itself the moment this ships.
 */

const fmt = (value: number, pattern: string) => formatNumber(value, pattern)

describe("the named formats", () => {
  it("leaves `plain` reading as the axis always has", () => {
    const plain = (v: number) => fmt(v, NUMBER_PATTERNS.plain)
    // The old rule: integers bare, everything else to one decimal, no grouping.
    expect(plain(0)).toBe("0")
    expect(plain(5000)).toBe("5000")
    expect(plain(1234.5)).toBe("1234.5")
    expect(plain(1234.56)).toBe("1234.6")
    expect(plain(-42)).toBe("-42")
  })

  it("groups thousands and trims decimals for `number`", () => {
    const n = (v: number) => fmt(v, NUMBER_PATTERNS.number)
    expect(n(1234567)).toBe("1,234,567")
    expect(n(1234.5)).toBe("1,234.5")
    expect(n(1234.567)).toBe("1,234.57")
    expect(n(0.5)).toBe("0.5")
    expect(n(-1234.5)).toBe("-1,234.5")
  })

  it("pads `currency` to the cent", () => {
    const c = (v: number) => fmt(v, NUMBER_PATTERNS.currency)
    expect(c(1234.5)).toBe("$1,234.50")
    expect(c(0)).toBe("$0.00")
    expect(c(1e6)).toBe("$1,000,000.00")
    // The sign goes outside the symbol, where a reader expects it.
    expect(c(-99)).toBe("-$99.00")
  })

  it("reads `percent` as a share, the way a spreadsheet does", () => {
    const p = (v: number) => fmt(v, NUMBER_PATTERNS.percent)
    expect(p(0.07)).toBe("7%")
    expect(p(0.125)).toBe("12.5%")
    expect(p(1)).toBe("100%")
  })
})

describe("the pattern language", () => {
  it("writes a `0` always and a `#` only when needed", () => {
    expect(fmt(5, "0.00")).toBe("5.00")
    expect(fmt(5, "0.##")).toBe("5")
    expect(fmt(5.5, "0.##")).toBe("5.5")
    // A `0` left of the point pads the integer out.
    expect(fmt(7, "000")).toBe("007")
  })

  it("groups when the integer run holds a comma, and not otherwise", () => {
    expect(fmt(1234567, "#,##0")).toBe("1,234,567")
    expect(fmt(1234567, "0")).toBe("1234567")
  })

  it("takes anything outside the digits as literal text", () => {
    expect(fmt(1234, "#,##0 kg")).toBe("1,234 kg")
    expect(fmt(1234, "€#,##0")).toBe("€1,234")
    expect(fmt(2.5, "~0.0 units")).toBe("~2.5 units")
  })

  it("scales for a bare %, and prints a quoted one as it stands", () => {
    // The spreadsheet reading: the operator says "this column is a fraction".
    expect(fmt(0.42, "0%")).toBe("42%")
    // …and the escape for a column already counted in percent points.
    expect(fmt(42, "0'%'")).toBe("42%")
    expect(fmt(0.42, "0'%'")).toBe("0%")
  })

  it("keeps a quoted digit character out of the number", () => {
    expect(fmt(12, "'#'#,##0")).toBe("#12")
  })

  it("rounds before it decides the sign", () => {
    // -0.001 at two decimals is zero, and a minus sign on an axis's zero reads
    // as a data error rather than as rounding.
    expect(fmt(-0.001, "0.00")).toBe("0.00")
    expect(fmt(-0.02, "0.00")).toBe("-0.02")
  })

  it("prints nothing for a value that isn't one", () => {
    expect(fmt(NaN, "#,##0")).toBe("")
    expect(fmt(Infinity, "#,##0")).toBe("")
  })

  it("falls back rather than printing a literal for every tick", () => {
    // A pattern with no digits in it cannot be a number format; an axis of
    // identical labels is worse than ignoring it.
    expect(fmt(1234.5, "hello")).toBe("1234.5")
  })
})

describe("patternFor", () => {
  it("resolves a named format to its pattern", () => {
    expect(patternFor("currency", undefined)).toBe(NUMBER_PATTERNS.currency)
    expect(patternFor(undefined, undefined)).toBe(NUMBER_PATTERNS.plain)
  })

  it("uses the custom pattern only when custom is chosen", () => {
    expect(patternFor("custom", "0.000")).toBe("0.000")
    expect(patternFor("number", "0.000")).toBe(NUMBER_PATTERNS.number)
  })

  it("stays readable while a custom pattern is being typed into", () => {
    expect(patternFor("custom", "")).toBe(NUMBER_PATTERNS.plain)
    expect(patternFor("custom", "   ")).toBe(NUMBER_PATTERNS.plain)
  })
})
