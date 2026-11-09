/**
 * The Number node, at the two seams where it would fail quietly.
 *
 * The first is the **derived string**: the node formats its value on every
 * measure and every draw, rather than caching one. If that ever stopped being read fresh, a figure would keep
 * drawing the value it was constructed with while `value` tweened underneath
 * it — and a format change would land on the next unrelated re-render or not
 * at all, which is exactly the kind of wrong nobody catches by looking.
 *
 * The second is that `value` is a plain numeric prop and therefore tweenable,
 * which is the whole reason the node stores a number rather than a string. Count
 * To has no builder step and no generator: if this stopped being true it would
 * present as a command that runs for its duration and changes nothing.
 */

import { describe, expect, it } from "vitest"

import type { Node2D } from "@/components/trees/2d/node2d"
import { laidOut, recorded } from "@/components/trees/tests/recording-context.fixtures"
import { NumberNode } from "@/components/builtins/text/text";
import { textStateOf } from "@/components/modules/text-layout"
import { numberNodePattern } from "@/components/builtins/text/number-pattern";

/** The string the node is currently drawing. */
const shown = (node: NumberNode): string => {
  recorded(node as unknown as Node2D)
  return textStateOf(node as unknown as Node2D)!.text!
}

const built = (props: Record<string, unknown>): NumberNode => laidOut(new NumberNode(props as never) as unknown as Node2D) as unknown as NumberNode

describe("the format controls, as a pattern", () => {
  it("groups and pads a plain number", () => {
    expect(
      numberNodePattern({
        format: "number",
        customPattern: "",
        fractionDigits: 2,
        grouped: true,
        currencySymbol: "$",
      })
    ).toBe("#,##0.00")
  })

  it("quotes the currency symbol, so a symbol is never read as digits", () => {
    // The failure this guards is a symbol containing one of `#0,.%` — rare for
    // the three everyone uses, entirely possible for anything typed by hand.
    expect(
      numberNodePattern({
        format: "currency",
        customPattern: "",
        fractionDigits: 2,
        grouped: true,
        currencySymbol: "%",
      })
    ).toBe("'%'#,##0.00")
  })

  it("leaves the percent sign bare, so it scales as well as prints", () => {
    expect(
      numberNodePattern({
        format: "percent",
        customPattern: "",
        fractionDigits: 0,
        grouped: false,
        currencySymbol: "$",
      })
    ).toBe("0%")
  })

  it("hands a custom pattern over untouched", () => {
    expect(
      numberNodePattern({
        format: "custom",
        customPattern: "#,##0 kg",
        fractionDigits: 4,
        grouped: false,
        currencySymbol: "€",
      })
    ).toBe("#,##0 kg")
  })
})

describe("what the node draws", () => {
  it("formats through the override rather than the engine's Intl path", () => {
    const node = built({
      value: 1299.99,
      format: "currency",
      fractionDigits: 2,
    })
    expect(shown(node)).toBe("$1,299.99")
  })

  it("reformats when a format control changes", () => {
    const node = built({ value: 0.42, format: "percent" })
    expect(shown(node)).toBe("42%")

    node.set({ fractionDigits: 1 })
    expect(shown(node)).toBe("42.0%")
  })

  it("counts: the value is an ordinary tweenable prop", () => {
    const node = built({ value: 0, fractionDigits: 0 })
    expect(shown(node)).toBe("0")

    node.set({ value: 1234 })
    expect(shown(node)).toBe("1,234")
  })
})
