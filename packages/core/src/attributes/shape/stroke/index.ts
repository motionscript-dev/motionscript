/** Stroke prop and resolved types, resolver, and array lerp. */
export type { Stroke, StrokeProp, StrokeAlign, StrokeCap, StrokeMarker, StrokeEnd, StrokeJoin } from './stroke';
/** @internal */ export type { StrokeResolved } from './stroke';
/** @internal */ export {
    resolveStroke, resolveStrokeAlign, resolveStrokeCap, resolveStrokeEnd, resolveStrokeJoin,
    isStrokeMarker, DEFAULT_CAP_SCALE,
    strokeOps,
} from './stroke';
