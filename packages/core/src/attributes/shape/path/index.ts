/**
 * Path geometry.
 *
 * One value — {@link pathOps} — carries every operation: parsing, the contour
 * normal form, bounds, length, sampling, dashing, trimming, morphing, and the
 * editable anchor model with its unit box. The free functions this used to
 * export (`calculatePathLength`, `applyDashPattern`, `extractSubpath`,
 * `createPathSampler`, `measurePathData`, `parsePathString`, `toPathCommands`,
 * `lerpPath`, `buildMorph`, `sampleMorph`, `toCubicSubpaths`) are those methods
 * now; each carried its own copy of the SVG pen walk, and the copies disagreed.
 */
export { pathOps } from "./ops";
export { EMPTY_PATH_DATA, PATH_UNIT_EXTENT, PATH_UNIT_HALF, UNIT_PATH_BOX } from "./anchors";
export type * from "./types";
