import { describe, expect, it } from "vitest"

import { Registry, fillOps } from "@motionscript/sdk"

import { FullWaveform } from "../full-waveform"
import { NODES } from "../../nodes"
import { VOICE_PALETTE } from "../shared"
import { play, step, waveform, type Batch } from "./harness"

/**
 * `FullWaveform` as a node: what a document makes of it, drawn into a recording
 * context. The arithmetic under it (`sampleEnvelope`, `layOutBars`, `paintBars`)
 * is pinned in `waveform.test.ts`; this is the part that decides which bars take
 * which paint, and when.
 */

const AHEAD = fillOps.resolve("#5b5b7a")
const PLAYED = fillOps.resolve("#6366f1")
const voice = (index: number) => fillOps.resolve(VOICE_PALETTE[index])

/** Four buckets over four seconds, two voices and a stretch of nobody. */
const ENVELOPE = { magnitude: [1, 0.5, 0.25, 0.75], duration: 4, speaker: [0, 0, 1, -1], speakers: 2 }

const BARS = { envelope: ENVELOPE, bars: 4, align: "bottom", gap: 0, floor: 0, radius: 0 }

/** The paints a draw used, with how many bars each took. */
function runs(batches: Batch[]) {
  return batches.map((batch) => ({ fill: batch.fill, count: batch.rects.length }))
}

/** The bar heights in a draw, left to right across every batch. */
function heights(batches: Batch[]) {
  return batches
    .flatMap((batch) => batch.rects)
    .sort((a, b) => a.x! - b.x!)
    .map((rect) => rect.height)
}

function drawn(props: Record<string, unknown> = {}, time = 0) {
  return play([waveform("fullWaveform", { ...BARS, ...props })]).draw(time).batches()
}

describe("fullWaveform: the played and ahead bars", () => {
  it("draws every bar in the ahead paint while nothing has played", () => {
    expect(runs(drawn())).toEqual([{ fill: AHEAD, count: 4 }])
  })

  it("draws every bar in the played paint once progress reaches 1", () => {
    expect(runs(drawn({ progress: 1 }))).toEqual([{ fill: PLAYED, count: 4 }])
  })

  it("splits at progress: the first `progress x bars` columns are played, the rest ahead", () => {
    expect(runs(drawn({ progress: 0.5 }))).toEqual([
      { fill: PLAYED, count: 2 },
      { fill: AHEAD, count: 2 },
    ])
  })

  it("counts a column as played while its index is below the edge, so a part-way edge rounds up", () => {
    // 0.3 x 4 = 1.2: columns 0 and 1 sit below it.
    expect(runs(drawn({ progress: 0.3 }))).toEqual([
      { fill: PLAYED, count: 2 },
      { fill: AHEAD, count: 2 },
    ])
    // 0.25 x 4 = 1: only column 0.
    expect(runs(drawn({ progress: 0.25 }))).toEqual([
      { fill: PLAYED, count: 1 },
      { fill: AHEAD, count: 3 },
    ])
  })

  it("clamps progress into 0..1", () => {
    expect(runs(drawn({ progress: -3 }))).toEqual([{ fill: AHEAD, count: 4 }])
    expect(runs(drawn({ progress: 7 }))).toEqual([{ fill: PLAYED, count: 4 }])
  })

  it("takes the played paint from `playedFill` and the ahead paint from `fill`", () => {
    const batches = drawn({ progress: 0.5, fill: "#ff0000", playedFill: "#00ff00" })
    expect(batches.map((batch) => batch.fill)).toEqual([fillOps.resolve("#00ff00"), fillOps.resolve("#ff0000")])
  })

  it("draws the played bars first, so the draw order is played then ahead", () => {
    const batches = drawn({ progress: 0.5 })
    expect(batches[0].fill).toEqual(PLAYED)
    expect(batches[0].rects.every((rect) => rect.x! < batches[1].rects[0].x!)).toBe(true)
  })
})

describe("fullWaveform: follow", () => {
  it("ignores `progress` and plays from the node's own clock over the recording's length", () => {
    const seek = play([waveform("fullWaveform", { ...BARS, follow: true, progress: 1 })])
    // The node appears at 0, so elapsed is the scene time: 1 s of a 4 s file is one column.
    expect(runs(seek.draw(0).batches())).toEqual([{ fill: AHEAD, count: 4 }])
    expect(runs(seek.draw(1).batches())).toEqual([
      { fill: PLAYED, count: 1 },
      { fill: AHEAD, count: 3 },
    ])
    expect(runs(seek.draw(2).batches())).toEqual([
      { fill: PLAYED, count: 2 },
      { fill: AHEAD, count: 2 },
    ])
  })

  it("stops at the end of the file", () => {
    const seek = play([waveform("fullWaveform", { ...BARS, follow: true })])
    expect(runs(seek.draw(4).batches())).toEqual([{ fill: PLAYED, count: 4 }])
    expect(runs(seek.draw(40).batches())).toEqual([{ fill: PLAYED, count: 4 }])
  })

  it("is a frame of its time: a seek back gives the earlier frame again", () => {
    const seek = play([waveform("fullWaveform", { ...BARS, follow: true })])
    const early = runs(seek.draw(1).batches())
    seek.draw(3)
    expect(runs(seek.draw(1).batches())).toEqual(early)
  })

  it("plays nothing for a recording with no length", () => {
    const empty = { magnitude: [], duration: 0, speaker: null, speakers: 0 }
    const seek = play([waveform("fullWaveform", { ...BARS, envelope: empty, follow: true })])
    expect(runs(seek.draw(5).batches())).toEqual([{ fill: AHEAD, count: 4 }])
  })
})

describe("fullWaveform: byVoice", () => {
  it("colours each bar by its voice from the palette, and an unattributed bar with `fill`", () => {
    const batches = drawn({ byVoice: true })
    expect(runs(batches)).toEqual([
      { fill: voice(0), count: 2 },
      { fill: voice(1), count: 1 },
      { fill: AHEAD, count: 1 },
    ])
  })

  it("takes a colour from `voiceColors` where it has one, and the palette where it has not", () => {
    const batches = drawn({ byVoice: true, voiceColors: ["#ff0000"] })
    expect(batches.map((batch) => batch.fill)).toEqual([fillOps.resolve("#ff0000"), voice(1), AHEAD])
  })

  it("replaces the played and ahead split rather than combining with it", () => {
    const split = runs(drawn({ byVoice: true, progress: 0.5 }))
    expect(split).toEqual(runs(drawn({ byVoice: true, progress: 0 })))
    expect(split.map((run) => run.fill)).not.toContain(PLAYED)
  })

  it("keeps the bars in their columns whichever batch they are in", () => {
    const batches = drawn({ byVoice: true })
    expect(batches.map((batch) => batch.rects.map((rect) => rect.x))).toEqual([[-150, -50], [50], [150]])
  })
})

describe("fullWaveform: the bars it draws", () => {
  it("resamples the whole file into `bars` columns, each as tall as its loudest bucket", () => {
    expect(heights(drawn({ bars: 2 }))).toEqual([100, 75])
    expect(heights(drawn())).toEqual([100, 50, 25, 75])
  })

  it("scales a bar by `gain`, and clamps it into the box", () => {
    expect(heights(drawn({ gain: 2 }))).toEqual([100, 100, 50, 100])
  })

  it("rounds `bars` and draws at least one column", () => {
    expect(heights(drawn({ bars: 2.4 }))).toHaveLength(2)
    expect(heights(drawn({ bars: 0 }))).toHaveLength(1)
    expect(heights(drawn({ bars: -5 }))).toHaveLength(1)
  })

  it("draws a recording that has not decoded as a row of resting bars", () => {
    const empty = { magnitude: [], duration: 0, speaker: null, speakers: 0 }
    const batches = drawn({ envelope: empty, floor: 0.1 })
    expect(runs(batches)).toEqual([{ fill: AHEAD, count: 4 }])
    expect(heights(batches)).toEqual([10, 10, 10, 10])
  })

  it("draws a silent bar as a hairline, not as nothing", () => {
    expect(heights(drawn({ envelope: { ...ENVELOPE, magnitude: [0, 0, 0, 0] } }))).toEqual([1, 1, 1, 1])
  })

  it("draws nothing for a box with no room in it", () => {
    expect(drawn({ width: 0 })).toEqual([])
    expect(drawn({ height: 0 })).toEqual([])
  })
})

describe("fullWaveform: sweep", () => {
  it("fills the waveform left to right over the command's slot", () => {
    const seek = play(
      [waveform("fullWaveform", BARS)],
      [step("c", "sweep", "wave", 1, 2)],
    )
    seek.seek(0.5)
    const node = seek.node<FullWaveform>()
    expect(node.progress).toBe(0)
    // Eased in-out unless the row says otherwise, so the middle of the slot is the middle of the fill
    // and a quarter in is less than a quarter.
    seek.seek(2)
    expect(node.progress).toBeCloseTo(0.5)
    seek.seek(1.5)
    expect(node.progress).toBeGreaterThan(0)
    expect(node.progress).toBeLessThan(0.25)
    seek.seek(3)
    expect(node.progress).toBe(1)
    seek.seek(10)
    expect(node.progress).toBe(1)
  })

  it("eases linearly when the row says so", () => {
    const seek = play(
      [waveform("fullWaveform", BARS)],
      [step("c", "sweep", "wave", 1, 2, {}, { kind: "linear" })],
    )
    const node = seek.node<FullWaveform>()
    seek.seek(1.5)
    expect(node.progress).toBeCloseTo(0.25)
  })

  it("starts from the progress the node already has", () => {
    const seek = play(
      [waveform("fullWaveform", { ...BARS, progress: 0.5 })],
      [step("c", "sweep", "wave", 1, 2)],
    )
    const node = seek.node<FullWaveform>()
    seek.seek(0)
    expect(node.progress).toBe(0.5)
    seek.seek(2)
    expect(node.progress).toBeCloseTo(0.75)
    seek.seek(3)
    expect(node.progress).toBe(1)
  })

  it("draws the bars it has played at each time", () => {
    const seek = play(
      [waveform("fullWaveform", BARS)],
      [step("c", "sweep", "wave", 0, 4)],
    )
    expect(runs(seek.draw(0).batches())).toEqual([{ fill: AHEAD, count: 4 }])
    expect(runs(seek.draw(2).batches())).toEqual([
      { fill: PLAYED, count: 2 },
      { fill: AHEAD, count: 2 },
    ])
    expect(runs(seek.draw(4).batches())).toEqual([{ fill: PLAYED, count: 4 }])
  })

  it("is the node's only command of its own", () => {
    const registry = new Registry({ nodes: NODES })
    const live = registry.commandKeys("liveWaveform")
    expect(registry.commandKeys("fullWaveform").filter((key) => !live.includes(key))).toEqual(["sweep"])
    expect(live.filter((key) => !registry.commandKeys("fullWaveform").includes(key))).toEqual([])
  })
})

describe("fullWaveform: what it publishes", () => {
  const registry = new Registry({ nodes: NODES })

  // Where a host shelves it, how it lays out and the box it seeds are the host's to keep.
  it("registers under its key, as a 2D node", () => {
    // A component registers as the node class it generated.
    expect(registry.node("fullWaveform")?.ctor).toBe(FullWaveform.node)
    expect(registry.describe("fullWaveform")).toMatchObject({ key: "fullWaveform", dimension: "2d" })
  })
})
