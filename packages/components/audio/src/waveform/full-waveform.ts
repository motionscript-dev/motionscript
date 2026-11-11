import {
  Types,
  clamp,
  component2d,
  easeInOut,
  fillOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  type RenderContext,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import { EMPTY_ENVELOPE, sampleEnvelope, type AudioEnvelope } from "./envelope"
import {
  groupByPaint,
  layOutBars,
  paintBars,
  voiceFill,
  type WaveformAlignment,
} from "./shared"

/** A fill entry whose kind is read off the default. */
const paint = (initial: string) =>
  Types.custom<Fill, FillResolved[]>(initial, { resolve: fillOps.resolve, lerp: fillOps.lerp })

/**
 * The whole recording's shape drawn at once, with a played portion that
 * advances: a picture of the file where {@link LiveWaveform} is of the moment.
 *
 * `follow` is off by default because a scene cannot see where the recording sits
 * on the video's audio lane (placed, trimmed, sped up); the author sweeps
 * `progress` with a command, and `follow` is the opt-in for a node that appears
 * exactly as the track starts. `byVoice` replaces the played/ahead split with
 * one colour per voice rather than combining with it: a bar cannot mean two
 * things at once.
 */
export const FullWaveform = component2d({
  key: "fullWaveform",
  state: {
    /** The baked recording; see {@link AudioEnvelope}. */
    envelope: Types.custom<AudioEnvelope>(EMPTY_ENVELOPE),
    bars: 120,
    /** Space between bars as a fraction of the pitch; see {@link layOutBars}. */
    gap: 0.3,
    /** Capped at half the bar's width. */
    radius: 2,
    /** The share of the file that reads as played, `0`-`1`. */
    progress: 0,
    /** Drive `progress` from the node's own clock instead. */
    follow: false,
    /** Multiplies every magnitude, pulling a quiet track up to fill its box. */
    gain: 1,
    /** The share of the box a silent bar still occupies, `0`-`1`. */
    floor: 0.015,
    align: Types.custom<WaveformAlignment>("center"),
    byVoice: false,
    /** A colour per voice index; short or empty falls back to the palette. */
    voiceColors: Types.custom<string[]>([]),
    /** The bars ahead of the playhead. */
    fill: paint("#5b5b7a"),
    playedFill: paint("#6366f1"),
  },
  // Nothing declares a component's paints but itself.
  load: (loader, state) => {
    loader.fill(state.fill)
    loader.fill(state.playedFill)
  },
  commands: {
    /** Fill the waveform in, left to right; eased in-out unless given an easing. */
    sweep: (timeline, state) => {
      const ease = timeline.easing ? null : easeInOut()
      const from = state.progress
      return timeline.animate((t) => ({ progress: from + (1 - from) * (ease ? ease(t) : t) }))
    },
  },
  render: (ctx, state) => {
    drawBars(ctx, state)
    ctx.children()
  },
})

export type FullWaveform = NodeOf<typeof FullWaveform>

interface FullState {
  readonly envelope: AudioEnvelope
  readonly bars: number
  readonly gap: number
  readonly radius: number
  readonly progress: number
  readonly follow: boolean
  readonly gain: number
  readonly floor: number
  readonly align: WaveformAlignment
  readonly byVoice: boolean
  readonly voiceColors: string[]
  readonly fill: FillResolved[]
  readonly playedFill: FillResolved[]
}

function drawBars(ctx: RenderContext, s: FullState): void {
  const { width, height } = ctx.size
  if (width <= 0 || height <= 0) return

  const count = Math.max(1, Math.round(s.bars))
  const sampled = sampleEnvelope(s.envelope, 0, s.envelope.duration, count)
  const boxes = layOutBars(sampled, {
    width,
    height,
    gap: s.gap,
    align: s.align,
    gain: s.gain,
    floor: s.floor,
  })
  if (boxes.length === 0) return

  // One draw per colour, not per bar (see {@link paintBars}); the key is a string so it is comparable.
  const edge = played(ctx, s) * boxes.length
  const groups = groupByPaint(boxes, (i) =>
    s.byVoice
      ? `voice:${sampled[i].speaker}`
      : i < edge
        ? "played"
        : "ahead"
  )

  for (const [key, run] of groups) {
    const graphics = paintBars(run, paintFor(s, key), s.radius)
    if (graphics) ctx.draw(graphics)
  }
}

function played(ctx: RenderContext, s: FullState): number {
  if (!s.follow) return clamp(s.progress, 0, 1)
  const length = s.envelope.duration
  if (length <= 0) return 0
  return clamp(ctx.time.elapsed / length, 0, 1)
}

function paintFor(s: FullState, key: string): Fill {
  if (key === "played") return s.playedFill
  if (key === "ahead") return s.fill
  return voiceFill(key, s.voiceColors, s.fill)
}
