/**
 * What the two waveform nodes share, importable without copying it.
 *
 * A registry item copies `envelope.ts` and `shared.ts` beside its node: they
 * hold no class and no registered state, so a fork owning its own copy splits
 * no identity. This is the same surface for a host that samples envelopes or
 * lays bars out itself, and for a fork that keeps only its node file.
 */
export { EMPTY_ENVELOPE, forSpeaker, sampleEnvelope } from "./waveform/envelope"
export type { AudioEnvelope, EnvelopeBar } from "./waveform/envelope"
export {
  VOICE_PALETTE,
  WAVEFORM_ALIGNMENTS,
  WAVEFORM_STYLES,
  clamp01,
  groupByPaint,
  layOutBars,
  livePaintKey,
  paintBars,
  voiceColor,
} from "./waveform/shared"
export type { BarBox, WaveformAlignment, WaveformStyle } from "./waveform/shared"
