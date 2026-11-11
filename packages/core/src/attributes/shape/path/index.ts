/** Path geometry: one value, {@link pathOps}, carries every operation (parsing, contour normal form, bounds, length, sampling, dashing, trimming, morphing, the editable anchor model with its unit box) over a single shared SVG pen walk. */
export { pathOps } from "./ops";
export { EMPTY_PATH_DATA, PATH_UNIT_EXTENT, PATH_UNIT_HALF, UNIT_PATH_BOX } from "./anchors";
export type * from "./types";
