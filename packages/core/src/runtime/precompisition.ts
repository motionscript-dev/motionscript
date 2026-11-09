import {
    AssetTimeline,
    createAssetTimelineProfile,
    type AssetTimelineOptions,
    type AssetTimelinePhase,
    type AssetTimelineProfile,
    type AssetTimelineResult,
    type AssetTimelineTimings,
    type TrackAssets,
    type TrackAssetsProfile,
    type TrackAssetsTiming,
} from "./asset-timeline";

// The names this module had before it became `asset-timeline`, kept for one alpha.

/** @deprecated Renamed to {@link AssetTimeline}. */
export const Precomp = AssetTimeline;
/** @deprecated Renamed to {@link AssetTimeline}. */
export type Precomp = AssetTimeline;
/** @deprecated Renamed to {@link AssetTimelineResult}. */
export type PrecompResult = AssetTimelineResult;
/** @deprecated Renamed to {@link TrackAssets}. */
export type TrackPrecomp = TrackAssets;
/** @deprecated Renamed to {@link AssetTimelineOptions}. */
export type PrecompOptions = AssetTimelineOptions;
/** @deprecated Renamed to {@link AssetTimelineProfile}. */
export type PrecompProfile = AssetTimelineProfile;
/** @deprecated Renamed to {@link createAssetTimelineProfile}. */
export const createPrecompProfile = createAssetTimelineProfile;
/** @deprecated Renamed to {@link AssetTimelinePhase}. */
export type PrecompPhase = AssetTimelinePhase;
/** @deprecated Renamed to {@link AssetTimelineTimings}. */
export type PrecompTimings = AssetTimelineTimings;
/** @deprecated Renamed to {@link TrackAssetsTiming}. */
export type TrackPrecompTiming = TrackAssetsTiming;
/** @deprecated Renamed to {@link TrackAssetsProfile}. */
export type TrackPrecompProfile = TrackAssetsProfile;
