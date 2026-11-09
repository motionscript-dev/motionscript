/**
 * The Number node's format controls, resolved into the one pattern the app's
 * formatter takes.
 *
 * There is already exactly one answer in this package to "how is a number
 * written down" — `./number-format`, whose docblock has the grammar and
 * the argument for it. This module adds no second one. What it adds is the
 * *panel's* half: a figure on the canvas is set up by picking a format and
 * saying how many decimals, where a chart axis is set up by picking a preset,
 * and those two are the same statement typed differently.
 *
 * So the controls compose a pattern rather than being honoured beside one. A
 * Number node showing `$1,234.50` and an axis labelled `$#,##0.00` go through
 * the same parser and round the same way, which is the thing that would drift
 * if the node reached for `Intl.NumberFormat` instead.
 */

import { patternFor } from "./number-format";

/**
 * How a Number node writes its figure.
 *
 * The chart's five minus `plain`, which exists there only to keep charts drawn
 * before there were formats labelling themselves the way they always have. A
 * node has no such history, and "plain" beside "number" is a distinction
 * nobody browsing a dropdown can make.
 */
export const NUMBER_NODE_FORMATS = [
  "number",
  "currency",
  "percent",
  "custom",
] as const

export type NumberNodeFormat = (typeof NUMBER_NODE_FORMATS)[number]

/** The most decimals the panel will let a figure carry. */
export const MAX_FRACTION_DIGITS = 10

/** The Number node's format controls, as the class holds them. */
export interface NumberFormatOptions {
  /** How the figure is written — see {@link NumberNode.format}. */
  format: string
  /** The pattern typed by hand — read only when the format is `custom`. */
  customPattern: string
  fractionDigits: number
  grouped: boolean
  /** Printed before the figure when the format is `currency`. */
  currencySymbol: string
}

/**
 * The pattern `options` names.
 *
 * `custom` hands the typed pattern straight to {@link patternFor}, which is what
 * makes the escape hatch the *same* language the presets are written in rather
 * than a second one. Every other format is composed here, because the three
 * controls beside the dropdown — decimals, grouping, the symbol — are what a
 * preset would otherwise have to be duplicated for (`#,##0.00` and `#,##0.000`
 * and `0.00` and…).
 */
export function numberNodePattern(options: NumberFormatOptions): string {
  if (options.format === "custom") {
    return patternFor("custom", options.customPattern)
  }

  const digits = Math.min(
    MAX_FRACTION_DIGITS,
    Math.max(0, Math.round(options.fractionDigits))
  )
  const integer = options.grouped ? "#,##0" : "0"
  const fraction = digits > 0 ? `.${"0".repeat(digits)}` : ""
  const body = `${integer}${fraction}`

  if (options.format === "currency") {
    return `${quoted(options.currencySymbol)}${body}`
  }
  // Bare, so the parser reads it as the percent *operator* and scales by 100 —
  // which is what makes a stored 0.42 read as "42%". A symbol an author wants
  // printed over data that is already in percent points is a custom pattern
  // with the sign quoted, exactly as it is on an axis.
  if (options.format === "percent") return `${body}%`
  return body
}

/**
 * `symbol` as a pattern literal.
 *
 * Quoted rather than concatenated, because the two most likely symbols after `$`
 * are `€` and `£` and the two after those are whatever an author types — and an
 * unquoted `#`, `0`, `,`, `.` or `%` in there would be read as part of the
 * number. The quote character itself is dropped rather than escaped: the grammar
 * has no escape for it, and a currency symbol containing an apostrophe is not a
 * thing anyone has.
 */
function quoted(symbol: string): string {
  const literal = symbol.replaceAll("'", "")
  return literal === "" ? "" : `'${literal}'`
}
