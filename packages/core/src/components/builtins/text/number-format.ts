/**
 * How a chart writes a number down.
 *
 * One formatter, driven by a **pattern**, and the named formats are patterns
 * too — `currency` is `$#,##0.00` and nothing more. That is the whole design:
 * a dropdown of four presets and a free-text pattern are otherwise two features
 * that drift, one of them gaining a thousands separator or a negative sign the
 * other never hears about. Here the preset *is* the custom case with the
 * pattern filled in, so there is one set of rules to get right.
 *
 * The grammar is the spreadsheet one, because that is where the numbers come
 * from and what an author already knows:
 *
 * | Pattern      | 1234.5    | 0.07   |
 * | ------------ | --------- | ------ |
 * | `#,##0.##`   | `1,234.5` | `0.07` |
 * | `0`          | `1235`    | `0`    |
 * | `$#,##0.00`  | `$1,234.50` | `$0.07` |
 * | `0.#%`       | `123450%` | `7%`   |
 * | `#,##0 kg`   | `1,235 kg` | `0 kg` |
 *
 * - `0` is a digit that is always written, `#` one that is written only when
 *   the number needs it. So `0.00` pads to two decimals and `0.##` trims.
 * - A `,` anywhere in the integer run turns grouping on; where it sits doesn't
 *   matter, since `#,##0` and `#,###,##0` mean the same thing to everyone who
 *   writes them.
 * - `%` scales by 100 as well as printing — that is what makes it a percent
 *   rather than a suffix, and it is why `0.07` under `0.#%` is `7%`. A column
 *   that is *already* in percent points wants `#,##0'%'`: quoted, so the sign
 *   is printed and nothing is scaled.
 * - Anything else is literal, before the digits or after them. Quote it to be
 *   sure — `'#'#,##0` prints a leading hash.
 *
 * Deliberately **not** `Intl.NumberFormat`. Its output is locale-dependent, and
 * a chart is a picture with a fixed layout: the same project rendering
 * `1,234.50` on the author's machine and `1.234,50` on the export box is a
 * silently different image, and the wider string can reflow an axis. What an
 * author wants here is the format they *typed*.
 */

/** The named formats the inspector offers, plus the escape hatch. */
export type NumberFormatName = "plain" | "number" | "currency" | "percent" | "custom"

/**
 * The pattern behind each named format.
 *
 * `plain` is the historic behaviour — integers bare, everything else to one
 * decimal — kept as the default so no existing chart re-labels itself. The rest
 * are the three formats a chart of money, counts or shares actually needs.
 */
export const NUMBER_PATTERNS: Record<Exclude<NumberFormatName, "custom">, string> = {
  // Ungrouped on purpose: this is what `formatMarker` did before there were
  // formats at all, and it is the default, so every chart already drawn keeps
  // the labels it has. Grouping is what the reader picks `number` for.
  plain: "#.#",
  number: "#,##0.##",
  currency: "$#,##0.00",
  percent: "#,##0.#%",
}

/** A pattern taken apart once, so formatting a tick is not a parse. */
interface ParsedPattern {
  prefix: string
  suffix: string
  grouped: boolean
  /** Digits always written left of the point — the count of `0`s there. */
  minInt: number
  /** Digits always written right of it. */
  minFrac: number
  /** The most that may be written right of it. */
  maxFrac: number
  /** Scale by 100 and print a `%`. */
  percent: boolean
}

/** What a pattern with no digits in it falls back to: the `plain` reading. */
const DEFAULT_PARSED: ParsedPattern = {
  prefix: "",
  suffix: "",
  grouped: false,
  minInt: 1,
  minFrac: 0,
  maxFrac: 1,
  percent: false,
}

/** Walk `text`, calling `visit` with each character and whether it is quoted. */
function scan(text: string, visit: (ch: string, quoted: boolean) => void): void {
  let quoted = false
  for (const ch of text) {
    if (ch === "'") {
      quoted = !quoted
      continue
    }
    visit(ch, quoted)
  }
}

/** Does `text` hold `ch` outside quotes? */
function hasBare(text: string, ch: string): boolean {
  let found = false
  scan(text, (c, quoted) => {
    if (c === ch && !quoted) found = true
  })
  return found
}

/** `text` with every unquoted `ch` dropped, quoting preserved. */
function removeBare(text: string, ch: string): string {
  let out = ""
  let quoted = false
  for (const c of text) {
    if (c === "'") {
      quoted = !quoted
      out += c
      continue
    }
    if (c === ch && !quoted) continue
    out += c
  }
  return out
}

/** `text` with its quotes taken off — what actually gets printed. */
function literal(text: string): string {
  let out = ""
  scan(text, (ch) => {
    out += ch
  })
  return out
}

/**
 * The `[start, end)` of the pattern's digit run — the first stretch of `#0,.`
 * outside quotes.
 *
 * Quote-aware, so `'#'#,##0` reads its leading hash as text and its run as the
 * three characters after it. Without that, a quoted `#` would be taken for the
 * number and the real digits for a suffix.
 */
function digitRun(pattern: string): [number, number] | null {
  let quoted = false
  let start = -1
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === "'") {
      quoted = !quoted
      if (start >= 0) return [start, i]
      continue
    }
    const isDigit = !quoted && "#0,.".includes(ch)
    if (isDigit && start < 0) start = i
    else if (!isDigit && start >= 0) return [start, i]
  }
  return start < 0 ? null : [start, pattern.length]
}

/**
 * Split `pattern` into its literal edges and its digit run.
 *
 * Everything before the run is a prefix and everything after it a suffix, which
 * is what lets `$#,##0.00`, `#,##0 kg` and `€ #,##0` all work without the
 * language needing a quoting rule for the parts that are only ever text.
 */
function parsePattern(pattern: string): ParsedPattern {
  const run = digitRun(pattern)
  if (!run) {
    // No digits at all is not a number format. Fall back rather than print the
    // literal for every tick, which would read as an axis of identical labels.
    return DEFAULT_PARSED
  }

  const digits = pattern.slice(run[0], run[1])
  const rawPrefix = pattern.slice(0, run[0])
  const rawSuffix = pattern.slice(run[1])

  // An **unquoted** `%` is the percent operator; a quoted one is a sign the
  // author wants printed over data that is already in percent points.
  const percent = hasBare(rawPrefix, "%") || hasBare(rawSuffix, "%")
  const prefix = literal(percent ? removeBare(rawPrefix, "%") : rawPrefix)
  const suffix = literal(percent ? removeBare(rawSuffix, "%") : rawSuffix)

  const point = digits.indexOf(".")
  const intPart = point < 0 ? digits : digits.slice(0, point)
  const fracPart = point < 0 ? "" : digits.slice(point + 1)

  const count = (s: string, ch: string) => s.split(ch).length - 1

  return {
    prefix,
    suffix: percent ? `${suffix}%` : suffix,
    grouped: intPart.includes(","),
    minInt: Math.max(1, count(intPart, "0")),
    minFrac: count(fracPart, "0"),
    maxFrac: fracPart.length,
    percent,
  }
}

/** Parsed patterns are reused across every tick of every frame. */
const cache = new Map<string, ParsedPattern>()

function parsed(pattern: string): ParsedPattern {
  const held = cache.get(pattern)
  if (held) return held
  const next = parsePattern(pattern)
  cache.set(pattern, next)
  return next
}

/** `1234567` → `1,234,567`. Only the integer run is grouped. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * `value` written the way `pattern` says.
 *
 * A non-finite value prints empty rather than `NaN`: a tick with no number
 * behind it is a tick that shouldn't caption itself, and `NaN` on an axis reads
 * as a broken chart rather than as missing data.
 */
export function formatNumber(value: number, pattern: string): string {
  if (!Number.isFinite(value)) return ""
  const p = parsed(pattern)

  const scaled = p.percent ? value * 100 : value
  const rounded = scaled.toFixed(p.maxFrac)
  // Rounding is what decides the sign, not the input: -0.001 at two decimals is
  // "0.00", and printing it as "-0.00" puts a minus sign on an axis's zero.
  const negative = rounded.startsWith("-")
  const [rawInt = "0", rawFrac = ""] = (
    negative ? rounded.slice(1) : rounded
  ).split(".")

  const intDigits = rawInt.padStart(p.minInt, "0")
  // `#` trims, `0` pads: drop trailing zeros down to the required minimum.
  let frac = rawFrac
  while (frac.length > p.minFrac && frac.endsWith("0")) frac = frac.slice(0, -1)

  const body = (p.grouped ? group(intDigits) : intDigits) + (frac ? `.${frac}` : "")
  const sign = negative && Number(rounded) !== 0 ? "-" : ""
  return `${sign}${p.prefix}${body}${p.suffix}`
}

/**
 * The pattern a `(format, custom)` pair names.
 *
 * A blank custom pattern falls back to the plain one rather than to the empty
 * string, so an axis switched to Custom is readable while it is being typed
 * into rather than a column of nothing.
 */
export function patternFor(
  format: NumberFormatName | undefined,
  custom: string | undefined
): string {
  if (format === "custom") {
    const trimmed = custom?.trim() ?? ""
    return trimmed === "" ? NUMBER_PATTERNS.plain : trimmed
  }
  return NUMBER_PATTERNS[format ?? "plain"] ?? NUMBER_PATTERNS.plain
}
