/**
 * The waveform family: one subject, two questions.
 *
 * - {@link FullWaveform} draws the **file** — the whole recording's silhouette,
 *   with a played portion that advances. "How long is this, and where are the
 *   loud parts."
 * - {@link LiveWaveform} draws the **moment** — bars moving with playback, the
 *   visualiser a podcast clip puts beside the artwork. "Is anything happening
 *   right now, and whose voice is it."
 *
 * Both read the same baked {@link AudioEnvelope}, which is why they cannot
 * disagree about a recording, and why neither listens to anything — see that
 * module for why a scene that has to export cannot use a live analyser.
 */
export { FullWaveform } from "./full-waveform"
export type { FullWaveformProps } from "./full-waveform"
export { LiveWaveform } from "./live-waveform"
export type { LiveWaveformProps } from "./live-waveform"
export { EMPTY_ENVELOPE, forSpeaker, sampleEnvelope } from "./envelope"
export type { AudioEnvelope, EnvelopeBar } from "./envelope"
export {
  VOICE_PALETTE,
  WAVEFORM_ALIGNMENTS,
  WAVEFORM_STYLES,
  groupByPaint,
  layOutBars,
  paintBars,
  voiceColor,
} from "./shared"
export type { BarBox, WaveformAlignment, WaveformStyle } from "./shared"
