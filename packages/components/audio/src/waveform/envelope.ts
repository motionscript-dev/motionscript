/**
 * The shape of a recording, as the waveform nodes draw it.
 *
 * ## How an envelope reaches a node: the host supplies it
 *
 * Nothing in the engine, and nothing in this kit, decodes audio. A waveform node
 * does not read a `sound` node's `src`, declares no audio asset and is not tied
 * to a clip: it draws the {@link AudioEnvelope} it is handed in its `envelope`
 * prop. Decoding a file into an envelope is the host's job, done once per file
 * before the document is built. Where the recording sits on the audio lane is
 * the author's timing too, which is why `FullWaveform.follow` is opt-in.
 *
 * ### The JSON form
 *
 * A document holds the envelope as plain JSON, because a prop value in a
 * document is JSON. The typed arrays in {@link AudioEnvelope} are one spelling of
 * it; `ArrayLike<number>` also accepts the plain arrays a document stores:
 *
 * ```json
 * {
 *   "magnitude": [0, 0.25, 0.5, 1, 0.5, 0],
 *   "duration": 6,
 *   "speaker": [0, 0, 0, 1, 1, -1],
 *   "speakers": 2
 * }
 * ```
 *
 * `magnitude` is the peak loudness, `0`…`1`, of buckets that divide `duration`
 * seconds evenly. `speaker` is `null` when nobody was identified; otherwise it is parallel to `magnitude`, one voice
 * index per bucket, `-1` for "nobody". `speakers` is the voice count, `0` when
 * `speaker` is `null`. A `Float32Array` or `Int16Array` is not JSON-serialisable
 * (`JSON.stringify` writes an object of indices), so a host that holds the typed
 * form converts with `Array.from` before storing it in a document.
 *
 * ## Why the data is baked rather than listened to
 *
 * A scene has to render identically in the preview and in a headless export,
 * and an export has no audio device, no `AudioContext` and no playback to
 * analyse. So a "live" visualiser cannot read a Web Audio analyser: what it
 * reads is a *pre-computed envelope*, indexed by the scene clock. The picture is
 * then a pure function of time, which is what makes scrubbing backwards, jumping
 * to frame 900, and rendering out of order all produce the same frame.
 *
 * The decode happens in the host, once per file, and arrives here through the
 * build — the same arrangement a chart's rows and a protein's atoms already use,
 * and for the same reason: the build is synchronous and cannot await a fetch.
 *
 * ## Why magnitude rather than min/max
 *
 * An editor's waveform is drawn from per-bucket minima *and* maxima, because an
 * editor is a measuring instrument. These nodes are neither — they are a bar
 * chart of loudness that happens to be shaped like a recording — and audio is
 * near enough symmetric that a mirrored magnitude is indistinguishable at the
 * size a node draws. Half the numbers, and one array to reason about.
 */

/**
 * A decoded recording, reduced to a uniform grid of loudness — plus, when the
 * host knows it, who is talking in each bucket.
 *
 * The speaker track is **not** something a decoder can produce; it comes from a
 * diarized transcript and is folded in by the host before the build. It lives
 * here rather than in a parallel structure because every reader of it is also a
 * reader of the magnitudes at the same index, and two arrays that must stay the
 * same length are better as one object than as two arguments.
 */
export interface AudioEnvelope {
  /**
   * Peak magnitude per bucket, 0…1. Buckets span {@link duration} evenly. A
   * `Float32Array`, or the plain `number[]` a document stores.
   */
  magnitude: ArrayLike<number>
  /** The decoded length in seconds. */
  duration: number
  /**
   * Which voice is speaking in each bucket, as an index into the recording's
   * own numbering, or `-1` for "nobody identified". Parallel to
   * {@link magnitude}, or `null` when the track was never diarized.
   */
  speaker: ArrayLike<number> | null
  /** How many distinct voices the diarizer found. Zero when it did not run. */
  speakers: number
}

/** The envelope of a track that hasn't loaded — or isn't there. */
export const EMPTY_ENVELOPE: AudioEnvelope = {
  magnitude: new Float32Array(0),
  duration: 0,
  speaker: null,
  speakers: 0,
}

/** One drawn bar: how loud, and whose. */
export interface EnvelopeBar {
  /** 0…1. */
  magnitude: number
  /** The voice index, or -1. */
  speaker: number
}

/**
 * Resamples `[from, to)` seconds of an envelope down to `bars` columns.
 *
 * Peak-preserving rather than averaging, which is the whole difference between
 * a waveform and a blur: averaging a hundred buckets into one column flattens
 * every transient, and transients are what makes a drawn recording read as
 * speech rather than as noise. The speaker of a column is the speaker of its
 * *loudest* bucket, on the same reasoning — a column straddling a turn belongs
 * to whoever is actually audible in it.
 *
 * A window past either end of the recording yields silent, unattributed
 * columns rather than clamping onto the nearest real one. That matters for the
 * live visualiser, which is handed a window centred on the playhead and would
 * otherwise smear the first bucket across the whole run-up to a track's start.
 */
export function sampleEnvelope(
  envelope: AudioEnvelope,
  from: number,
  to: number,
  bars: number
): EnvelopeBar[] {
  const count = Math.max(0, Math.floor(bars))
  const out: EnvelopeBar[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = { magnitude: 0, speaker: -1 }

  const buckets = envelope.magnitude.length
  if (count === 0 || buckets === 0 || envelope.duration <= 0) return out

  const perSecond = buckets / envelope.duration
  const span = (to - from) / count

  for (let i = 0; i < count; i++) {
    const start = (from + span * i) * perSecond
    const end = (from + span * (i + 1)) * perSecond

    // At least one bucket per column, so a window zoomed in past the grid draws
    // the sample it is standing on rather than an empty band.
    const first = Math.floor(start)
    const last = Math.max(first, Math.ceil(end) - 1)

    let loudest = 0
    let speaker = -1
    for (let b = first; b <= last; b++) {
      if (b < 0 || b >= buckets) continue
      const value = envelope.magnitude[b]
      if (value < loudest) continue
      loudest = value
      speaker = envelope.speaker ? envelope.speaker[b] : -1
    }

    out[i] = { magnitude: loudest, speaker }
  }

  return out
}

/**
 * The same window, with everything that isn't `voice` silenced.
 *
 * The point of the speaker filter, and the reason it silences rather than
 * *drops*: a podcast visualiser filtered to one host should go quiet while the
 * other one talks, not compress their turn out of existence. Keeping the bars
 * and zeroing them is what makes the picture read as "this person is not
 * speaking right now" instead of as a jump cut.
 *
 * `voice` of `null` returns the bars untouched, which is the unfiltered node.
 */
export function forSpeaker(
  bars: EnvelopeBar[],
  voice: number | null
): EnvelopeBar[] {
  if (voice === null) return bars
  return bars.map((bar) =>
    bar.speaker === voice ? bar : { magnitude: 0, speaker: bar.speaker }
  )
}
