// A registry item copies `envelope.ts` and `shared.ts` beside its node (no class or registered state, so a copy splits no identity); this is the same surface for a host or a fork that keeps only its node file.
export { EMPTY_ENVELOPE, forSpeaker, sampleEnvelope } from "./waveform/envelope"
export type { AudioEnvelope, EnvelopeBar } from "./waveform/envelope"
export {
  VOICE_PALETTE,
  WAVEFORM_ALIGNMENTS,
  WAVEFORM_STYLES,
  groupByPaint,
  layOutBars,
  livePaintKey,
  paintBars,
  voiceColor,
} from "./waveform/shared"
export type { BarBox, WaveformAlignment, WaveformStyle } from "./waveform/shared"
