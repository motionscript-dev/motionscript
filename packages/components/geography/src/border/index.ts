/**
 * GeoBorder: country and subdivision outlines by ISO 3166 code.
 *
 * `ms add geo-border` copies only `geo-border.ts`. Everything it imports from
 * here — the source registry, the file cache, the geometry — stays behind the
 * package, so a forked node shares the host's registered sources instead of
 * owning an empty registry of its own.
 */
export * from "./format"
export * from "./geo-border"
export * from "./geometry"
export * from "./loader"
export * from "./registry"
export * from "./selection"
