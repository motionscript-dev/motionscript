/** Subdivision counts as one name. three spells this ten ways (`widthSegments`, `radialSegments`, `tubularSegments`, `detail`, ...); every geometry here takes one {@link Segments3D} and documents the per-axis meaning on the shape. A scalar applies to every axis (just raising resolution); a tuple is per-axis in the shape's documented order. */
export type Segments3D =
    | number
    | readonly [number]
    | readonly [number, number]
    | readonly [number, number, number];

/** Resolves a {@link Segments3D} against a shape's per-axis defaults: a scalar broadcasts, a tuple fills what it names, `undefined` is all defaults (an unset `segments` never pins a resolution invented at a call site). Floored and clamped to at least 1, since a fractional or zero count reaches three as a degenerate geometry, not an error. */
export function segmentsOf(
    value: Segments3D | undefined,
    defaults: readonly number[],
): number[] {
    if (value === undefined) return defaults.map(clampSegment);
    if (typeof value === "number") return defaults.map(() => clampSegment(value));
    return defaults.map((fallback, index) => clampSegment(value[index] ?? fallback));
}

function clampSegment(value: number): number {
    return Math.max(1, Math.floor(value));
}
