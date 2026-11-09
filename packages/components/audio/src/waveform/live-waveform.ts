import {
  Types,
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
  clamp01,
  groupByPaint,
  layOutBars,
  livePaintKey,
  paintBars,
  voiceColor,
  type WaveformAlignment,
  type WaveformStyle,
} from "./shared"

/**
 * A **live audio visualiser**: bars that move with the recording as it plays.
 *
 * The thing every podcast-to-video tool puts beside the artwork. It is not a
 * picture of the file — that is {@link FullWaveform} — it is a picture of *this
 * moment*, and what it is for is making a static frame of a talking head feel
 * like it is playing.
 *
 * ## "Live" without listening
 *
 * Nothing here reads an audio device. The bars are sampled out of a baked
 * envelope at the node's own elapsed time, which is what makes the visualiser
 * survive the thing it exists for: an **export**, where there is no playback to
 * analyse and frames may be rendered out of order or in parallel. A frame is a
 * pure function of its time, so scrubbing back and forth over the visualiser
 * redraws exactly what it drew the first time — which an analyser node, by
 * construction, cannot promise. See {@link AudioEnvelope}.
 *
 * ## The speaker filter
 *
 * `speaker` narrows the node to one voice of a diarized recording, and it
 * is the reason this node knows about transcripts at all. Two visualisers beside
 * two headshots, each filtered to its own host, is a podcast edit that would
 * otherwise be done by hand for every turn — and because the filter *silences*
 * rather than skips (see {@link forSpeaker}), the quiet host visibly stops
 * talking instead of vanishing. Nothing about that requires the words: only who
 * is talking when, which is what the diarizer produces.
 *
 * A filter naming a voice the recording doesn't have draws a resting row rather
 * than everything — a picture of "this person never speaks here", which is
 * true, where falling back to the unfiltered mix would be a silent lie about
 * whose voice you were watching.
 */
export const LiveWaveform = component2d({
  key: "liveWaveform",
  state: {
    /** The baked recording. See {@link AudioEnvelope} for why it is baked. */
    envelope: Types.custom<AudioEnvelope>(EMPTY_ENVELOPE),
    /** How many bars the visualiser is made of. */
    bars: 48,
    /** Space between bars, as a fraction of the pitch. */
    gap: 0.35,
    radius: 4,
    /** How many seconds of audio are on screen at once. */
    window: 3,
    /** Seconds into the file the node's first frame shows. */
    offset: 0,
    /** Advance with the scene clock. Off freezes the picture at `offset`. */
    playing: true,
    /** Multiplies every magnitude before it is clamped. */
    gain: 1.4,
    /** How much of the box a silent bar still occupies, `0`–`1`. */
    floor: 0.04,
    align: Types.custom<WaveformAlignment>("center"),
    style: Types.custom<WaveformStyle>("bars"),
    /**
     * Show only this voice's activity, by index into the recording's own
     * numbering. `-1` — the default — is every voice.
     */
    speaker: -1,
    /** Colour each bar by whoever is speaking in it. */
    byVoice: false,
    /** A colour per voice index. Short or empty falls back to the palette. */
    voiceColors: Types.custom<string[]>([]),
    fill: Types.custom<Fill, FillResolved[]>("#6366f1", { resolve: fillOps.resolve, lerp: fillOps.lerp }),
  },
  // Nothing declares a component's paints but itself.
  load: (loader, state) => loader.fill(state.fill),
  render: (ctx, state) => {
    drawBars(ctx, state)
    ctx.children()
  },
})

export type LiveWaveform = NodeOf<typeof LiveWaveform>
export type LiveWaveformProps = NonNullable<Parameters<typeof LiveWaveform>[0]>

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

/**
 * The second of the recording the visualiser is showing.
 *
 * Off the node's own clock rather than the scene's, which is what "from the
 * moment this node appeared" means — the same clock the engine's own
 * `Video` times its picture from, and the same one that makes a node dropped
 * halfway through a clip start its recording at its entrance rather than
 * partway in.
 */
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

  // The window is centred on the playhead, so the bars run *toward* the
  // middle and away again — the arrangement every mixer's meter uses, and the
  // one that reads as sound arriving rather than as a strip scrolling past.
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

/** See `FullWaveform`'s paints — a voice is a hue, never a gradient. */
function paintFor(s: LiveState, key: string): Fill {
  if (key === "all") return s.fill
  const voice = Number(key.slice("voice:".length))
  if (!Number.isFinite(voice) || voice < 0) return s.fill
  return s.voiceColors[voice] ?? voiceColor(voice)
}

/**
 * Rolls the ends of a window off toward silence.
 *
 * What separates the `line` style from `bars`: a hard-edged window makes the
 * loud bar entering at the right edge appear from nothing, which reads as a
 * glitch rather than as sound arriving. Fading the outer fifth turns the same
 * data into a shape that grows out of the baseline — the profile a spectrum
 * display has, and the reason it looks like one object rather than a row of
 * separate meters.
 */
function taper(bars: readonly EnvelopeBar[]): EnvelopeBar[] {
  const count = bars.length
  if (count < 3) return [...bars]
  const edge = Math.max(1, Math.floor(count / 5))

  return bars.map((bar, i) => {
    const fromEnd = Math.min(i, count - 1 - i)
    const weight = clamp01(fromEnd / edge)
    return { magnitude: bar.magnitude * weight, speaker: bar.speaker }
  })
}
