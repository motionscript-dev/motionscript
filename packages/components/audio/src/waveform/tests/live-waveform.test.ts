import { describe, expect, it } from "vitest"

import { Registry, fillOps } from "@motionscript/sdk"

import { LiveWaveform } from "../live-waveform"
import { NODES } from "../../nodes"
import { VOICE_PALETTE } from "../shared"
import { play, waveform, type Batch } from "./harness"

/**
 * `LiveWaveform` as a node: a window of a baked envelope, centred on the node's
 * own playhead, drawn into a recording context. The sampling, filtering and
 * layout arithmetic is pinned in `waveform.test.ts`; this is the part that
 * decides where the window sits and what each bar is painted with.
 */

const FILL = fillOps.resolve("#6366f1")
const voice = (index: number) => fillOps.resolve(VOICE_PALETTE[index])

/** One bucket a second, rising by a tenth, and two voices: 0 for the first five seconds, 1 for the rest. */
const RISING = {
  magnitude: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
  duration: 10,
  speaker: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  speakers: 2,
}

/** Gain 1 and no floor, bottom-aligned, so a bar's height is the bucket's magnitude times the box. */
const PLAIN = { envelope: RISING, bars: 2, window: 2, offset: 5, playing: false, gain: 1, floor: 0, gap: 0, radius: 0, align: "bottom" }

/** The bar heights in a draw, left to right across every batch. */
function heights(batches: Batch[]) {
  return batches
    .flatMap((batch) => batch.rects)
    .sort((a, b) => a.x! - b.x!)
    .map((rect) => Math.round(rect.height * 1e6) / 1e6)
}

function widths(batches: Batch[]) {
  return batches.flatMap((batch) => batch.rects).map((rect) => Math.round(rect.width * 1e6) / 1e6)
}

function drawn(props: Record<string, unknown> = {}, time = 0) {
  return play([waveform("liveWaveform", { ...PLAIN, ...props })]).draw(time).batches()
}

describe("liveWaveform: the window", () => {
  it("is centred on the playhead: the bars run from half a window before it to half a window after", () => {
    // [4, 6) over two bars: buckets 4 and 5.
    expect(heights(drawn())).toEqual([50, 60])
    // Wider than the recording's grid: four bars over [3, 7).
    expect(heights(drawn({ bars: 4, window: 4 }))).toEqual([40, 50, 60, 70])
  })

  it("starts `offset` seconds into the file", () => {
    expect(heights(drawn({ offset: 1 }))).toEqual([10, 20])
    expect(heights(drawn({ offset: 8 }))).toEqual([80, 90])
  })

  it("advances with the node's clock while `playing`", () => {
    const seek = play([waveform("liveWaveform", { ...PLAIN, playing: true, offset: 1 })])
    expect(heights(seek.draw(0).batches())).toEqual([10, 20])
    expect(heights(seek.draw(1).batches())).toEqual([20, 30])
    expect(heights(seek.draw(3).batches())).toEqual([40, 50])
  })

  it("holds at `offset` when not `playing`, however far the clock has run", () => {
    const seek = play([waveform("liveWaveform", PLAIN)])
    const first = heights(seek.draw(0).batches())
    expect(heights(seek.draw(2.5).batches())).toEqual(first)
    expect(heights(seek.draw(7).batches())).toEqual(first)
  })

  it("is a frame of its time: a seek back gives the earlier frame again", () => {
    const seek = play([waveform("liveWaveform", { ...PLAIN, playing: true })])
    const early = heights(seek.draw(1).batches())
    seek.draw(3)
    expect(heights(seek.draw(1).batches())).toEqual(early)
  })

  it("draws silence where the window runs past either end of the file", () => {
    // [-1, 1): the first bar is before the start of the recording.
    expect(heights(drawn({ offset: 0 }))).toEqual([1, 10])
    // [9, 11): the second is past the end.
    expect(heights(drawn({ offset: 10 }))).toEqual([100, 1])
  })

  it("reads no wider than 0.05 s, so a window below that is the same row", () => {
    const narrowest = heights(drawn({ bars: 4, window: 0.05 }))
    // Centred on the boundary between buckets 4 and 5, two bars each side of it.
    expect(narrowest).toEqual([50, 50, 60, 60])
    for (const window of [0.01, 0, -3]) expect(heights(drawn({ bars: 4, window }))).toEqual(narrowest)
    expect(heights(drawn({ bars: 4, window: 4 }))).not.toEqual(narrowest)
  })

  it("rounds `bars` and draws at least one", () => {
    expect(heights(drawn({ bars: 2.4 }))).toHaveLength(2)
    expect(heights(drawn({ bars: 0 }))).toHaveLength(1)
  })

  it("draws nothing for a box with no room in it", () => {
    expect(drawn({ width: 0 })).toEqual([])
    expect(drawn({ height: 0 })).toEqual([])
  })

  it("draws a recording that has not decoded as a row of resting bars", () => {
    const empty = { magnitude: [], duration: 0, speaker: null, speakers: 0 }
    expect(heights(drawn({ envelope: empty, floor: 0.2, bars: 3 }))).toEqual([20, 20, 20])
  })
})

describe("liveWaveform: the speaker filter", () => {
  const FOUR = { bars: 4, window: 4 }

  it("silences the other voices' bars rather than dropping them", () => {
    // [3, 7): buckets 3 and 4 are voice 0, 5 and 6 are voice 1.
    expect(heights(drawn({ ...FOUR, speaker: 0 }))).toEqual([40, 50, 1, 1])
    expect(heights(drawn({ ...FOUR, speaker: 1 }))).toEqual([1, 1, 60, 70])
  })

  it("rounds a fractional voice to the nearest index", () => {
    expect(heights(drawn({ ...FOUR, speaker: 0.4 }))).toEqual(heights(drawn({ ...FOUR, speaker: 0 })))
    expect(heights(drawn({ ...FOUR, speaker: 0.6 }))).toEqual(heights(drawn({ ...FOUR, speaker: 1 })))
  })

  it("draws a voice the recording does not have as a resting row, not as the mix", () => {
    expect(heights(drawn({ ...FOUR, speaker: 5 }))).toEqual([1, 1, 1, 1])
  })

  it("treats any negative speaker as every voice", () => {
    expect(heights(drawn({ ...FOUR, speaker: -1 }))).toEqual([40, 50, 60, 70])
    expect(heights(drawn({ ...FOUR, speaker: -4 }))).toEqual([40, 50, 60, 70])
  })
})

describe("liveWaveform: paint", () => {
  const FOUR = { bars: 4, window: 4 }

  it("draws one batch in `fill` for the mix", () => {
    const batches = drawn(FOUR)
    expect(batches.map((batch) => [batch.fill, batch.rects.length])).toEqual([[FILL, 4]])
  })

  it("takes `fill` from the prop", () => {
    expect(drawn({ ...FOUR, fill: "#ff0000" })[0].fill).toEqual(fillOps.resolve("#ff0000"))
  })

  it("draws one batch per voice with `byVoice`, in the order the voices first appear", () => {
    const batches = drawn({ ...FOUR, byVoice: true })
    expect(batches.map((batch) => [batch.fill, batch.rects.length])).toEqual([
      [voice(0), 2],
      [voice(1), 2],
    ])
  })

  it("takes a voice's colour from `voiceColors`, then the palette", () => {
    const batches = drawn({ ...FOUR, byVoice: true, voiceColors: ["#00ff00"] })
    expect(batches.map((batch) => batch.fill)).toEqual([fillOps.resolve("#00ff00"), voice(1)])
  })

  it("paints an unattributed bar with `fill` under `byVoice`", () => {
    const unattributed = { ...RISING, speaker: [-1, -1, -1, -1, -1, 1, 1, 1, 1, 1] }
    const batches = drawn({ ...FOUR, envelope: unattributed, byVoice: true })
    expect(batches.map((batch) => batch.fill)).toEqual([FILL, voice(1)])
  })

  it("paints every bar in the filtered voice's colour, silenced ones included", () => {
    // `forSpeaker` zeroes the other voices' bars but leaves their attribution, so the
    // key is forced to the filtered voice: one batch, whoever the bar belonged to.
    const batches = drawn({ ...FOUR, speaker: 1, byVoice: true })
    expect(batches.map((batch) => [batch.fill, batch.rects.length])).toEqual([[voice(1), 4]])
  })

  it("paints a filtered voice in its own colour even without `byVoice`, not in `fill`", () => {
    const batches = drawn({ ...FOUR, speaker: 0, fill: "#ff0000" })
    expect(batches.map((batch) => [batch.fill, batch.rects.length])).toEqual([[voice(0), 4]])
  })
})

describe("liveWaveform: style", () => {
  /** Twenty loud buckets, so every bar of a ten-bar row is as tall as the box. */
  const LOUD = { magnitude: Array.from({ length: 20 }, () => 1), duration: 20, speaker: null, speakers: 0 }
  const TEN = { envelope: LOUD, bars: 10, window: 10, offset: 10 }

  it("draws `bars` as the envelope says", () => {
    expect(heights(drawn({ ...TEN, style: "bars" }))).toEqual(Array.from({ length: 10 }, () => 100))
  })

  it("rolls the outer fifth of a `line` off toward silence", () => {
    // Two bars of ten on each side: a zero weight at the end, half a weight beside it.
    expect(heights(drawn({ ...TEN, style: "line" }))).toEqual([1, 50, 100, 100, 100, 100, 100, 100, 50, 1])
  })

  it("leaves a `line` row of fewer than three bars as it is", () => {
    expect(heights(drawn({ ...TEN, bars: 2, style: "line" }))).toEqual([100, 100])
  })

  it("lays `blocks` out with its own gap of 0.12, whatever `gap` says", () => {
    // Ten bars across 400: a pitch of 40.
    expect(new Set(widths(drawn({ ...TEN, gap: 0.5, style: "bars" })))).toEqual(new Set([20]))
    expect(new Set(widths(drawn({ ...TEN, gap: 0.5, style: "blocks" })))).toEqual(new Set([35.2]))
    expect(new Set(widths(drawn({ ...TEN, gap: 0, style: "blocks" })))).toEqual(new Set([35.2]))
  })

  it("draws `blocks` and `bars` with the same heights", () => {
    expect(heights(drawn({ ...TEN, style: "blocks" }))).toEqual(heights(drawn({ ...TEN, style: "bars" })))
  })
})

describe("liveWaveform: what it publishes", () => {
  const registry = new Registry({ nodes: NODES })

  // Where a host shelves it, how it lays out and the box it seeds are the host's to keep.
  it("registers under its key, as a 2D node", () => {
    // A component registers as the node class it generated.
    expect(registry.node("liveWaveform")?.ctor).toBe(LiveWaveform.node)
    expect(registry.describe("liveWaveform")).toMatchObject({ key: "liveWaveform", dimension: "2d" })
  })

  it("defines no command of its own", () => {
    const full = registry.commandKeys("fullWaveform")
    expect(registry.commandKeys("liveWaveform")).not.toContain("sweep")
    expect(full).toContain("sweep")
  })

  it("defaults to a three-second window of 48 bars on the first frame of the file", () => {
    const props = registry.describe("liveWaveform")!.properties!
    expect(props.bars.default).toBe(48)
    expect(props.window.default).toBe(3)
    expect(props.offset.default).toBe(0)
    expect(props.playing.default).toBe(true)
    expect(props.speaker.default).toBe(-1)
    expect(props.style.default).toBe("bars")
    expect(props.gain.default).toBe(1.4)
    expect(props.floor.default).toBe(0.04)
    expect(props.gap.default).toBe(0.35)
    expect(props.radius.default).toBe(4)
  })
})
