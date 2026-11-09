/**
 * What a **component package** built on this engine needs, and cannot supply
 * itself: number formatting, the text a host falls back to, the named shape
 * outlines and the orbit-camera lerps.
 *
 * A subpath rather than the main barrel because none of this is engine API: a
 * scene author never reaches for it.
 *
 * This file is a **re-export barrel only** — everything it names lives beside
 * whatever actually owns it (the number formatter beside the Number node, the
 * orbit-camera lerps under `attributes/`) rather than duplicated here.
 */
export * from "@/components/builtins/text/text-defaults"
export * from "@/util/metrics"
export * from "@/components/builtins/text/number-format"
export * from "@/components/builtins/text/number-pattern"
export * from "@/attributes/render3d/orbit"
export * from "@/components/builtins/geometry/shape-outline"
