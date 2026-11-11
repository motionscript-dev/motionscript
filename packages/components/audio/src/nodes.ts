import { FullWaveform } from "./waveform/full-waveform";
import { LiveWaveform } from "./waveform/live-waveform";

// Typed by name, so the declaration names each component rather than spelling out its type through core.
export const NODES: (typeof FullWaveform | typeof LiveWaveform)[] = [FullWaveform, LiveWaveform];
