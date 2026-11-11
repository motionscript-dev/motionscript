/** The Number node's format controls, resolved into the one pattern the app's formatter takes (`./number-format` is the single answer to "how is a number written down"; its docblock has the grammar). The controls compose a pattern rather than sitting beside one, so a Number node showing `$1,234.50` and an axis labelled `$#,##0.00` go through the same parser and round alike, which would drift if the node used `Intl.NumberFormat`. */

import { patternFor } from "./number-format";

/** How a Number node writes its figure: the chart's formats minus `plain`, which exists there only to keep pre-format charts labelling as they always did. */
export const NUMBER_NODE_FORMATS = [
  "number",
  "currency",
  "percent",
  "custom",
] as const

/** The most decimals the panel will let a figure carry. */
export const MAX_FRACTION_DIGITS = 10

export interface NumberFormatOptions {
  format: string
  /** The pattern typed by hand — read only when the format is `custom`. */
  customPattern: string
  fractionDigits: number
  grouped: boolean
  /** Printed before the figure when the format is `currency`. */
  currencySymbol: string
}

/** The pattern `options` names. `custom` goes straight to {@link patternFor}, so the escape hatch is the same language as the presets. Other formats are composed here, since decimals, grouping and symbol controls would otherwise need a preset duplicated per combination. */
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
  // Bare, so the parser reads it as the percent *operator* and scales by 100 (a stored 0.42 reads "42%"). A sign printed
  // over data already in percent points is a custom pattern with the sign quoted.
  if (options.format === "percent") return `${body}%`
  return body
}

/** `symbol` as a pattern literal, quoted because an unquoted `#`, `0`, `,`, `.` or `%` in a typed symbol would read as part of the number. The quote character itself is dropped: the grammar has no escape for it. */
function quoted(symbol: string): string {
  const literal = symbol.replaceAll("'", "")
  return literal === "" ? "" : `'${literal}'`
}
