/**
 * The host decodes audio into an {@link AudioEnvelope} once per file, before the
 * build, and hands it to the node; nothing here decodes or listens. It is baked
 * because an export has no audio device or analyser, and the picture must be a
 * pure function of time.
 *
 * In a document an envelope is plain JSON, which `ArrayLike<number>` accepts.
 * A `Float32Array` is not JSON-serialisable (`JSON.stringify` writes an object
 * of indices), so convert with `Array.from` before storing it.
 */

/**
 * A recording reduced to a uniform grid of loudness, plus who is talking in each
 * bucket when the host knows. The speaker track comes from a diarized transcript,
 * not the decoder; it lives here because every reader of it also reads the
 * magnitudes at the same index.
 */
export interface AudioEnvelope {
  /** Peak magnitude per bucket, 0 to 1; buckets span {@link duration} evenly. */
  magnitude: ArrayLike<number>
  /** Seconds. */
  duration: number
  /** Voice index per bucket (`-1` for nobody), parallel to {@link magnitude}, or `null` when never diarized. */
  speaker: ArrayLike<number> | null
  /** Zero when the diarizer did not run. */
  speakers: number
}

/** The envelope of a track that has not loaded or is not there. */
export const EMPTY_ENVELOPE: AudioEnvelope = {
  magnitude: new Float32Array(0),
  duration: 0,
  speaker: null,
  speakers: 0,
}

export interface EnvelopeBar {
  /** 0 to 1. */
  magnitude: number
  /** Voice index, or -1. */
  speaker: number
}

/**
 * Resamples `[from, to)` seconds down to `bars` columns, keeping peaks rather
 * than averaging: averaging flattens the transients that make a drawing read as
 * speech. A column's speaker is that of its loudest bucket. A window past either
 * end yields silent, unattributed columns rather than clamping onto the nearest
 * real one, which would smear the first bucket across a live window's run-up.
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

    // At least one bucket per column, so a zoomed-in window draws the sample it stands on.
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
 * The same window with everything but `voice` silenced, not dropped, so a
 * filtered visualiser goes quiet while the other host talks instead of cutting
 * their turn out. `null` returns the bars untouched.
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
