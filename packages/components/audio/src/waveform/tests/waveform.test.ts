import { describe, expect, it } from "vitest"

import {
  EMPTY_ENVELOPE,
  forSpeaker,
  sampleEnvelope,
  type AudioEnvelope,
} from "../envelope"
import { fillOps } from "@motionscript/sdk"

import * as kit from "../../kit"
import { groupByPaint, layOutBars, livePaintKey, paintBars, voiceColor, VOICE_PALETTE, type BarBox } from "../shared"

/**
 * The arithmetic behind the two waveform nodes.
 *
 * Everything here is the part of them that has no renderer in it: turning a
 * decoded file into a row of columns, silencing the voices a filter excludes,
 * deciding where each bar sits in the node's box, and turning a run of boxes
 * into one draw. The nodes themselves — which bars take which paint, and when —
 * are read off a recording context in `full-waveform.test.ts` and
 * `live-waveform.test.ts`.
 */

/** A recording with one loud bucket per second, and two voices trading turns. */
function envelope(overrides: Partial<AudioEnvelope> = {}): AudioEnvelope {
  const magnitude = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.5, 0, 0])
  const speaker = new Int16Array([0, 0, 0, 0, 1, 1, -1, -1])
  return { magnitude, duration: 8, speaker, speakers: 2, ...overrides }
}

describe("sampleEnvelope", () => {
  it("returns one bar per column, over the window asked for", () => {
    const bars = sampleEnvelope(envelope(), 0, 8, 4)
    expect(bars).toHaveLength(4)
    // Peak-preserving, not averaging: each column keeps the louder of its two
    // buckets. Averaging would flatten every transient, which is the whole
    // difference between a waveform and a blur.
    expect(bars.map((b) => b.magnitude)).toEqual([0.25, 0.75, 1, 0])
  })

  it("attributes a column to whoever is loudest in it", () => {
    // Buckets 4 and 5 are voice 1; a column straddling the turn belongs to
    // whoever is actually audible in it.
    const bars = sampleEnvelope(envelope(), 0, 8, 4)
    expect(bars.map((b) => b.speaker)).toEqual([0, 0, 1, -1])
  })

  it("draws silence past either end rather than clamping", () => {
    // The live node is handed a window centred on the playhead, so the run-up
    // to a track's start must be quiet — not the first bucket smeared across it.
    const before = sampleEnvelope(envelope(), -4, 0, 4)
    expect(before.map((b) => b.magnitude)).toEqual([0, 0, 0, 0])
    expect(before.every((b) => b.speaker === -1)).toBe(true)
  })

  it("is a silent row for a recording that hasn't decoded", () => {
    const bars = sampleEnvelope(EMPTY_ENVELOPE, 0, 3, 5)
    expect(bars).toHaveLength(5)
    expect(bars.every((b) => b.magnitude === 0)).toBe(true)
  })

  it("keeps standing on a bucket when the window is finer than the grid", () => {
    // A window narrower than one bucket still draws the sample it is over,
    // rather than an empty band.
    const bars = sampleEnvelope(envelope(), 4.1, 4.2, 3)
    expect(bars.every((b) => b.magnitude === 1)).toBe(true)
  })
})

describe("forSpeaker", () => {
  const bars = sampleEnvelope(envelope(), 0, 8, 4)

  it("silences the other voices rather than dropping them", () => {
    // The point of the filter: a visualiser narrowed to one host goes quiet
    // while the other talks, instead of compressing their turn out of the
    // picture.
    const only = forSpeaker(bars, 0)
    expect(only).toHaveLength(bars.length)
    expect(only.map((b) => b.magnitude)).toEqual([0.25, 0.75, 0, 0])
  })

  it("passes everything through for no filter", () => {
    expect(forSpeaker(bars, null)).toBe(bars)
  })

  it("is a resting row for a voice the recording doesn't have", () => {
    // A picture of "this person never speaks here", which is true — where
    // falling back to the mix would be a silent lie about whose voice it is.
    expect(forSpeaker(bars, 7).every((b) => b.magnitude === 0)).toBe(true)
  })
})

describe("layOutBars", () => {
  const bars = [
    { magnitude: 0, speaker: -1 },
    { magnitude: 1, speaker: -1 },
  ]
  const base = {
    width: 100,
    height: 40,
    gap: 0,
    align: "center" as const,
    gain: 1,
    floor: 0,
  }

  it("fills the box and centres the row on the origin", () => {
    const boxes = layOutBars(bars, base)
    expect(boxes).toHaveLength(2)
    expect(boxes[0].x).toBe(-50)
    expect(boxes[1].x).toBe(0)
    expect(boxes[0].width).toBe(50)
  })

  it("grows a centred bar both ways from the middle", () => {
    const boxes = layOutBars(bars, base)
    expect(boxes[1].y).toBe(-20)
    expect(boxes[1].height).toBe(40)
  })

  it("grows a bottom-aligned bar up from the baseline", () => {
    const boxes = layOutBars(bars, { ...base, align: "bottom" })
    expect(boxes[1].y).toBe(-20)
    expect(boxes[1].height).toBe(40)
    // …and a silent one rests on the floor rather than above it.
    expect(boxes[0].y + boxes[0].height).toBe(20)
  })

  /**
   * `layOutBars` states a box top-left, y down; the graphics a bar is drawn with
   * are centred, y up. The two only differ for a bar that is not symmetric about
   * the middle, which is why a centre-aligned row never showed it.
   */
  it("paints a bottom-aligned row standing on the floor, and a centred row about the middle", () => {
    const centres = (align: "center" | "bottom") => {
      const boxes = layOutBars(bars, { ...base, align })
      const graphics = paintBars(boxes, "#ffffff", 0)!
      return (graphics.ops().filter((op) => op.kind === "rect") as unknown as { state: { y: number; height: number } }[]).map(
        (op) => op.state
      )
    }

    // y up: the floor of a 40-high box is y = -20, its ceiling y = +20.
    const [silent, loud] = centres("bottom")
    expect(loud.y - loud.height / 2).toBeCloseTo(-20)
    expect(loud.y + loud.height / 2).toBeCloseTo(20)
    expect(silent.y - silent.height / 2).toBeCloseTo(-20)
    expect(silent.y).toBeLessThan(0)
    // The hairline stays inside the box, on the floor.
    expect(silent.height).toBe(1)

    for (const state of centres("center")) expect(state.y).toBeCloseTo(0)
  })

  it("draws silence as a hairline, never as nothing", () => {
    // A gap has to read as a quiet passage rather than as a hole in the picture.
    const boxes = layOutBars(bars, base)
    expect(boxes[0].height).toBeGreaterThan(0)
  })

  it("keeps the same rhythm at every density", () => {
    // The gap is a fraction of the pitch, so a bar count anyone can drag does
    // not turn into a solid block at one end and a picket fence at the other.
    const many = layOutBars(
      Array.from({ length: 50 }, () => ({ magnitude: 1, speaker: -1 })),
      { ...base, gap: 0.5 }
    )
    expect(many[0].width).toBe((100 / 50) * 0.5)
  })

  it("clamps a gained magnitude back into the box", () => {
    const boxes = layOutBars(bars, { ...base, gain: 10 })
    expect(boxes[1].height).toBe(40)
  })

  it("is empty for a box with no room in it", () => {
    expect(layOutBars(bars, { ...base, width: 0 })).toEqual([])
  })
})

describe("livePaintKey", () => {
  it("is one flat key for the filtered voice, whoever the bar itself belonged to", () => {
    // Bar 7's own attribution (someone else's turn, silenced by the filter)
    // must not leak through — every bar keys the same as the filter, byVoice
    // or not.
    expect(livePaintKey(7, false, 2)).toBe("voice:2")
    expect(livePaintKey(7, true, 2)).toBe("voice:2")
    expect(livePaintKey(2, true, 2)).toBe("voice:2")
  })

  it("falls back to byVoice's own per-bar key once nothing is filtered", () => {
    expect(livePaintKey(3, true, null)).toBe("voice:3")
    expect(livePaintKey(3, false, null)).toBe("all")
  })
})

describe("voiceColor", () => {
  it("wraps past the end of the palette rather than running out", () => {
    expect(voiceColor(0)).toBe(VOICE_PALETTE[0])
    expect(voiceColor(VOICE_PALETTE.length)).toBe(VOICE_PALETTE[0])
  })

  it("wraps a negative index backwards from the end", () => {
    expect(voiceColor(-1)).toBe(VOICE_PALETTE[VOICE_PALETTE.length - 1])
    expect(voiceColor(-VOICE_PALETTE.length)).toBe(VOICE_PALETTE[0])
    expect(voiceColor(-VOICE_PALETTE.length - 1)).toBe(VOICE_PALETTE[VOICE_PALETTE.length - 1])
  })

  it("has eight colours, each different", () => {
    expect(VOICE_PALETTE).toHaveLength(8)
    expect(new Set(VOICE_PALETTE).size).toBe(8)
  })
})

describe("paintBars", () => {
  const boxes: BarBox[] = [
    { x: -50, y: -10, width: 20, height: 30 },
    { x: 0, y: -10, width: 4, height: 40 },
  ]
  const rects = (graphics: NonNullable<ReturnType<typeof paintBars>>) =>
    graphics
      .ops()
      .flatMap((op) => (op.kind === "rect" ? [op.state as { x: number; y: number; width: number; height: number; cornerRadius: number }] : []))

  it("chains every box into one graphics and fills it once", () => {
    const graphics = paintBars(boxes, "#ff0000", 0)!
    const kinds = graphics.ops().map((op) => op.kind)
    expect(kinds).toEqual(["rect", "rect", "fill"])
    // The paint goes through unresolved: resolving it is the renderer's step.
    expect(graphics.ops().find((op) => op.kind === "fill")).toMatchObject({ fills: "#ff0000" })
  })

  it("centres each rect on its box, flipping the y-down layout to the y-up rect", () => {
    const [first, second] = rects(paintBars(boxes, "#ffffff", 0)!)
    expect(first).toMatchObject({ x: -40, y: -5, width: 20, height: 30 })
    expect(second).toMatchObject({ x: 2, y: -10, width: 4, height: 40 })
  })

  it("rounds a corner to the radius, never past half the bar's width or height", () => {
    const [wide, thin] = rects(paintBars(boxes, "#ffffff", 8)!)
    // 20 wide x 30 tall: the radius fits.
    expect(wide.cornerRadius).toBe(8)
    // 4 wide: half the width, or the bar becomes a lozenge whose ends taper to nothing.
    expect(thin.cornerRadius).toBe(2)

    const flat = rects(paintBars([{ x: 0, y: 0, width: 50, height: 2 }], "#ffffff", 8)!)
    expect(flat[0].cornerRadius).toBe(1)
  })

  it("draws a square corner for a radius of 0", () => {
    for (const rect of rects(paintBars(boxes, "#ffffff", 0)!)) expect(rect.cornerRadius).toBe(0)
  })

  it("is null for no boxes", () => {
    expect(paintBars([], "#ff0000", 4)).toBeNull()
  })

  it("is null for a fill with no layers in it", () => {
    expect(paintBars(boxes, [], 4)).toBeNull()
  })

  it("takes a resolved fill as it is", () => {
    const fill = fillOps.resolve("#00ff00")
    expect(paintBars(boxes, fill, 0)!.ops().find((op) => op.kind === "fill")).toMatchObject({ fills: fill })
  })
})

describe("groupByPaint", () => {
  const boxes: BarBox[] = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0, width: 1, height: 1 }))

  it("groups boxes by key, keeping their order inside each group", () => {
    const groups = groupByPaint(boxes, (i) => (i % 3 === 0 ? "a" : "b"))
    expect([...groups.keys()]).toEqual(["a", "b"])
    expect(groups.get("a")!.map((box) => box.x)).toEqual([0, 3])
    expect(groups.get("b")!.map((box) => box.x)).toEqual([1, 2, 4, 5])
  })

  it("lists the groups in the order their keys first appear", () => {
    const groups = groupByPaint(boxes, (i) => (i < 2 ? "late" : "early"))
    expect([...groups.keys()]).toEqual(["late", "early"])
  })

  it("asks for the key of each box by its index", () => {
    const asked: number[] = []
    groupByPaint(boxes, (i) => (asked.push(i), "all"))
    expect(asked).toEqual([0, 1, 2, 3, 4, 5])
  })

  it("makes one group for one key, holding the same boxes", () => {
    const groups = groupByPaint(boxes, () => "all")
    expect(groups.size).toBe(1)
    expect(groups.get("all")).toEqual(boxes)
  })

  it("keys by anything comparable, not only strings", () => {
    const groups = groupByPaint(boxes, (i) => i % 2)
    expect([...groups.keys()]).toEqual([0, 1])
  })

  it("is empty for no boxes", () => {
    expect(groupByPaint([], () => "all").size).toBe(0)
  })
})

describe("the ./kit surface", () => {
  // What a registry item copies beside its node, and what a fork that keeps only
  // its node file imports instead. Renaming or dropping one breaks a copy that
  // no test in this package would otherwise notice.
  it("exports the envelope and bar helpers, and no node", () => {
    expect(Object.keys(kit).sort()).toEqual([
      "EMPTY_ENVELOPE",
      "VOICE_PALETTE",
      "WAVEFORM_ALIGNMENTS",
      "WAVEFORM_STYLES",
      "clamp01",
      "forSpeaker",
      "groupByPaint",
      "layOutBars",
      "livePaintKey",
      "paintBars",
      "sampleEnvelope",
      "voiceColor",
    ])
  })

  it("exports the same functions the nodes draw with", () => {
    expect(kit.paintBars).toBe(paintBars)
    expect(kit.groupByPaint).toBe(groupByPaint)
    expect(kit.layOutBars).toBe(layOutBars)
    expect(kit.livePaintKey).toBe(livePaintKey)
    expect(kit.voiceColor).toBe(voiceColor)
    expect(kit.sampleEnvelope).toBe(sampleEnvelope)
    expect(kit.forSpeaker).toBe(forSpeaker)
    expect(kit.EMPTY_ENVELOPE).toBe(EMPTY_ENVELOPE)
  })

  it("clamps into 0..1", () => {
    expect(kit.clamp01(-0.5)).toBe(0)
    expect(kit.clamp01(0.25)).toBe(0.25)
    expect(kit.clamp01(3)).toBe(1)
  })

  it("lists the two alignments and the three styles the nodes accept", () => {
    expect(kit.WAVEFORM_ALIGNMENTS).toEqual(["center", "bottom"])
    expect(kit.WAVEFORM_STYLES).toEqual(["bars", "line", "blocks"])
  })
})
