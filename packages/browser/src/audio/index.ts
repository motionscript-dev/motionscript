// @motionscript/browser/audio — stacked-audio playback and mixdown, with no
// renderer attached.
//
// A separate entry point from the package barrel on purpose: nothing here draws,
// so a host building an audio timeline should not load the renderer.

export { mixAudio, encodeWav, WebAudioMixer, DEFAULT_SAMPLE_RATE } from "./mixer";
export type { MixAudioOptions } from "./mixer";

export { WebAudioSink, WebAudioSink as WebAudioPlayer } from "./player";

// The bus layer both of those share. Exported so a host writing its own device
// or mixer builds the same chains, rather than a second set that drifts.
export { AudioBusGraph } from "./bus-graph";
