import {
  Types,
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
  clamp01,
  groupByPaint,
  layOutBars,
  paintBars,
  voiceColor,
  type WaveformAlignment,
} from "./shared"

/** A paint entry as the waveforms declare theirs: resolved and tweened like a fill, its kind read off the default. */
const paint = (initial: string) =>
  Types.custom<Fill, FillResolved[]>(initial, { resolve: fillOps.resolve, lerp: fillOps.lerp })

/**
 * A **waveform overview**: the whole recording's shape, drawn at once.
 *
 * The picture every audio editor opens with, and the one a podcast clip puts
 * under its caption — a static silhouette of the file, with a played portion
 * that advances. It answers "how long is this and where are the loud parts",
 * which is a question about the *file*, not about the moment; its sibling
 * {@link LiveWaveform} answers the other one.
 *
 * ## Progress is authored, not assumed
 *
 * `follow` is off by default, and that default is the considered one. A
 * scene has no idea where the recording it is drawing sits on the video's audio
 * lane — a clip is placed, trimmed and sped up out there, and none of that is
 * visible from in here. So the honest default is that the fill is *animation*:
 * the author sweeps it with a command, the same as any other tween, and it lands
 * wherever they put it. `follow` is the shortcut for the common arrangement
 * where the node appears exactly as the track starts, and it says so by being a
 * switch someone has to turn on rather than a behaviour that quietly disagrees
 * with the mix.
 *
 * ## Voices instead of progress
 *
 * With `byVoice` on, the played/ahead split is replaced by one colour per
 * speaking voice, at a size you can read. For a two-hander it is a map of the conversation: who has the
 * floor, where the turns are, how long each one ran. It replaces the progress
 * colours rather than combining with them, because a bar cannot mean two things
 * at once and "played, and also Grace" is a legend nobody can hold in their
 * head.
 */
export const FullWaveform = component2d({
  key: "fullWaveform",
  state: {
    /** The baked recording. See {@link AudioEnvelope} for why it is baked. */
    envelope: Types.custom<AudioEnvelope>(EMPTY_ENVELOPE),
    /** How many columns the whole file is drawn as. */
    bars: 120,
    /** Space between bars, as a fraction of the pitch. See {@link layOutBars}. */
    gap: 0.3,
    /** Corner radius of a bar, capped at half its width. */
    radius: 2,
    /** How much of the file reads as played, `0`–`1`. Tweenable. */
    progress: 0,
    /** Drive `progress` from the node's own clock instead of the prop. */
    follow: false,
    /** Multiplies every magnitude — a quiet track pulled up to fill its box. */
    gain: 1,
    /** How much of the box a silent bar still occupies, `0`–`1`. */
    floor: 0.015,
    align: Types.custom<WaveformAlignment>("center"),
    /** Colour each voice's turns rather than splitting on played / not played. */
    byVoice: false,
    /** A colour per voice index. Short or empty falls back to the palette. */
    voiceColors: Types.custom<string[]>([]),
    /** The bars ahead of the playhead. */
    fill: paint("#5b5b7a"),
    /** …and the bars behind it. */
    playedFill: paint("#6366f1"),
  },
  // Nothing declares a component's paints but itself: `fill` and `playedFill` both.
  load: (loader, state) => {
    loader.fill(state.fill)
    loader.fill(state.playedFill)
  },
  commands: {
    /**
     * Fill the waveform in, left to right — the node's one command, since
     * everything else about it is expressible as an ordinary `to`. Eased in-out
     * unless it is given an easing of its own.
     */
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
export type FullWaveformProps = NonNullable<Parameters<typeof FullWaveform>[0]>

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

  // One draw per colour rather than per bar — see {@link paintBars}. The key
  // is a string because it has to be comparable; the paint it stands for is
  // resolved after the grouping.
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

/** Where the fill has reached, from whichever source is in charge. */
function played(ctx: RenderContext, s: FullState): number {
  if (!s.follow) return clamp01(s.progress)
  const length = s.envelope.duration
  if (length <= 0) return 0
  return clamp01(ctx.time.elapsed / length)
}

/**
 * The paint a group takes.
 *
 * A voice's colour is a **colour string**, never one of the node's two fill
 * props, and that is deliberate: a voice is identified by hue, so a gradient
 * or an image there would defeat the only thing the colour is for. It also
 * means these paints declare no assets, which is why `load` only has to account
 * for the two real fill props.
 */
function paintFor(s: FullState, key: string): Fill {
  if (key === "played") return s.playedFill
  if (key === "ahead") return s.fill

  const voice = Number(key.slice("voice:".length))
  if (!Number.isFinite(voice) || voice < 0) return s.fill
  return s.voiceColors[voice] ?? voiceColor(voice)
}
