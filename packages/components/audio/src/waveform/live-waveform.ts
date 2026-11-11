import {
  Types,
  clamp,
  component2d,
  fillOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  type RenderContext,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import {
  EMPTY_ENVELOPE,
  forSpeaker,
  sampleEnvelope,
  type AudioEnvelope,
  type EnvelopeBar,
} from "./envelope"
import {
  groupByPaint,
  layOutBars,
  livePaintKey,
  paintBars,
  voiceFill,
  type WaveformAlignment,
  type WaveformStyle,
} from "./shared"

/**
 * A visualiser whose bars move with the recording: a picture of this moment
 * where {@link FullWaveform} is of the file. The bars are sampled from a baked
 * envelope at the node's own elapsed time, so a frame is a pure function of time
 * and an export, which has no playback to analyse and may render out of order,
 * draws what the preview drew.
 *
 * `speaker` narrows the node to one voice of a diarized recording; it silences
 * the other voices (see {@link forSpeaker}) so the quiet host visibly stops. A
 * voice the recording does not have draws a resting row, not the unfiltered mix,
 * which would be a silent lie about whose voice you are watching.
 */
export const LiveWaveform = component2d({
  key: "liveWaveform",
  state: {
    /** The baked recording; see {@link AudioEnvelope}. */
    envelope: Types.custom<AudioEnvelope>(EMPTY_ENVELOPE),
    bars: 48,
    /** Space between bars as a fraction of the pitch. */
    gap: 0.35,
    radius: 4,
    /** Seconds of audio on screen at once. */
    window: 3,
    /** Seconds into the file the first frame shows. */
    offset: 0,
    /** Advance with the scene clock; off freezes the picture at `offset`. */
    playing: true,
    gain: 1.4,
    /** The share of the box a silent bar still occupies, `0`-`1`. */
    floor: 0.04,
    align: Types.custom<WaveformAlignment>("center"),
    style: Types.custom<WaveformStyle>("bars"),
    /** Show only this voice, by index into the recording's own numbering; `-1` is every voice. */
    speaker: -1,
    /** Colour each bar by whoever is speaking in it. */
    byVoice: false,
    /** A colour per voice index; short or empty falls back to the palette. */
    voiceColors: Types.custom<string[]>([]),
    fill: Types.custom<Fill, FillResolved[]>("#6366f1", { resolve: fillOps.resolve, lerp: fillOps.lerp }),
  },
  load: (loader, state) => loader.fill(state.fill),
  render: (ctx, state) => {
    drawBars(ctx, state)
    ctx.children()
  },
})

export type LiveWaveform = NodeOf<typeof LiveWaveform>

interface LiveState {
  readonly envelope: AudioEnvelope
  readonly bars: number
  readonly gap: number
  readonly radius: number
  readonly window: number
  readonly offset: number
  readonly playing: boolean
  readonly gain: number
  readonly floor: number
  readonly align: WaveformAlignment
  readonly style: WaveformStyle
  readonly speaker: number
  readonly byVoice: boolean
  readonly voiceColors: string[]
  readonly fill: FillResolved[]
}

/** The second of the recording on show, off the node's own clock (as `Video`'s is), so a node entering halfway through a clip starts its recording at its entrance. */
function at(ctx: RenderContext, s: LiveState): number {
  return s.offset + (s.playing ? Math.max(0, ctx.time.elapsed) : 0)
}

function drawBars(ctx: RenderContext, s: LiveState): void {
  const { width, height } = ctx.size
  if (width <= 0 || height <= 0) return

  const count = Math.max(1, Math.round(s.bars))
  const span = Math.max(0.05, s.window)
  const now = at(ctx, s)
  const voice = s.speaker < 0 ? null : Math.round(s.speaker)

  // Centred on the playhead, so sound reads as arriving rather than a strip scrolling past.
  const sampled = forSpeaker(
    sampleEnvelope(s.envelope, now - span / 2, now + span / 2, count),
    voice
  )

  const shaped = s.style === "line" ? taper(sampled) : sampled
  const boxes = layOutBars(shaped, {
    width,
    height,
    gap: s.style === "blocks" ? 0.12 : s.gap,
    align: s.align,
    gain: s.gain,
    floor: s.floor,
  })
  if (boxes.length === 0) return

  const groups = groupByPaint(boxes, (i) =>
    livePaintKey(shaped[i].speaker, s.byVoice, voice)
  )

  for (const [key, run] of groups) {
    const graphics = paintBars(run, paintFor(s, key), s.radius)
    if (graphics) ctx.draw(graphics)
  }
}

function paintFor(s: LiveState, key: string): Fill {
  if (key === "all") return s.fill
  return voiceFill(key, s.voiceColors, s.fill)
}

/** Fades the outer fifth of the window to silence, the `line` style: a hard edge makes a loud bar appear from nothing, which reads as a glitch. */
function taper(bars: readonly EnvelopeBar[]): EnvelopeBar[] {
  const count = bars.length
  if (count < 3) return [...bars]
  const edge = Math.max(1, Math.floor(count / 5))

  return bars.map((bar, i) => {
    const fromEnd = Math.min(i, count - 1 - i)
    const weight = clamp(fromEnd / edge, 0, 1)
    return { magnitude: bar.magnitude * weight, speaker: bar.speaker }
  })
}
