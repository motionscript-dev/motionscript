export type { GainEffect } from './implementations/gain';
export type { HighPassEffect } from './implementations/highpass';
export type { LowPassEffect } from './implementations/lowpass';
export type { TremoloEffect } from './implementations/tremolo';
export type { EchoEffect } from './implementations/echo';

export { AudioEffects, AudioEffectChain, resolveAudioEffects } from './chain';
export type {
    AudioEffectsInput,
    GainEffectOptions,
    HighPassEffectOptions,
    LowPassEffectOptions,
    TremoloEffectOptions,
    EchoEffectOptions,
} from './chain';

export type { AudioEffect } from './union';
export { effectsKey } from './union';

export { AudioEffectRegistry, audioEffectsOps } from './registry';
export type { AudioEffectData } from './registry';
