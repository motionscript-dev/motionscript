// Public API for @motionscript/react.
//
// Keep this surface intentional: only re-export what consumers should use.
// No CSS or other side-effecting imports belong here — the package is marked
// "sideEffects": false so bundlers can drop anything a consumer doesn't import.
//
// Nothing here imports a platform. An engine is built by a factory the host
// passes to `useEngine` and handed to `useMotionPlayer`, so this package works
// with `@motionscript/browser`'s engine, a headless one, or a test double — and
// pulls none of them in.
export { useEngine } from './ui/use-engine';
export type { UseEngineOptions } from './ui/use-engine';
export { useMotionPlayer } from './ui/use-motion-player';
export type { MotionPlayerOptions, Player, PrecompProgress } from './ui/use-motion-player';
export { MotionStage } from './ui/stage';
export type { MotionStageProps } from './ui/stage';
export { usePlayhead } from './ui/playhead';
export type { PlayheadStore } from './ui/playhead';
export type { BuildError, Engine, Session } from '@motionscript/core';
