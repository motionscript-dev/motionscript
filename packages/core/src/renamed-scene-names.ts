import { integrateSpeedToClipTime, sourceTimeAtClipElapsed } from './attributes/audio/ramp';
import type { NodeEffect } from './attributes/shape/effects/union';
import { ClipTimeline } from './document/timeline';
import type { VisualDocument } from './document/types';

// The names the document API had before "scene" became "clip", kept until 1.0.

/** @deprecated Renamed to {@link VisualDocument}. */
export type SceneDocument = VisualDocument;
/** @deprecated Renamed to {@link ClipTimeline}. */
export const SceneTimeline = ClipTimeline;
/** @deprecated Renamed to {@link ClipTimeline}. */
export type SceneTimeline = ClipTimeline;
/** @deprecated Renamed to {@link NodeEffect}. */
export type SceneEffect = NodeEffect;
/** @deprecated Renamed to {@link integrateSpeedToClipTime}. */
export const integrateSpeedToSceneTime = integrateSpeedToClipTime;
/** @deprecated Renamed to {@link sourceTimeAtClipElapsed}. */
export const sourceTimeAtSceneElapsed = sourceTimeAtClipElapsed;
