import {
    Material,
    Types,
    type EntryOptions,
    type Geometry3D,
    type Type,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Blend3D as _Blend3D,
    type Color as _Color,
    type Faces3D as _Faces3D,
    type Fill3D as _Fill3D,
    type Material3D as _Material3D,
    type NormalizedColor as _NormalizedColor,
    type Shading3D as _Shading3D,
    type Texture3D as _Texture3D,
} from "@motionscript/sdk";
import type { Interval } from "../kit/coords";
import { lerpDomain } from "../kit/source";

type MeshState = { readonly geometry: Type<Geometry3D | undefined> } & typeof Material.state;
// Restated key by key, so a mark spreading these names each entry's type through the sdk: spread
// as inferred, a mark's declaration copied `emission`'s colour types from core's own.
type Restated<T> = { [K in Extract<keyof T, string>]: T[K] };

/**
 * A mesh's entries, as a 3D mark draws with them: its surface, and the
 * `geometry` a mesh takes, which a mark builds itself and never reads.
 */
export const meshEntries: Restated<MeshState> = {
    geometry: Types.custom<Geometry3D | undefined>(undefined),
    ...Material.state,
};

interface RangeHints extends EntryOptions {
    readonly defaultMin: number;
    readonly defaultMax: number;
}

/** A span of a variable, unset until given: what a host offers as a range from `defaultMin` to `defaultMax`. */
export function domainEntry(defaultMin: number, defaultMax: number): Type<Interval | null> {
    return Types.custom<Interval | null, Interval | null, RangeHints>(null, { lerp: lerpDomain, kind: "range", defaultMin, defaultMax });
}
