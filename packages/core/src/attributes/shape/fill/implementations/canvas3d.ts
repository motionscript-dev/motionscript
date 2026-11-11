import type { BlendMode } from '../blend';
import type { FillData } from '../registry';
import type { Scene3D } from '@/render3d/scene3d';
import { declare3DResources } from '@/render3d/tracking';

/** A 3D scene painted as a fill: the renderer draws it to a texture and shades the shape's own path with it, so it clips to whatever painted it, stacks with other fills and inherits the layer's `opacity`/`blend`/`space`. The payload is a **built** {@link Scene3D}, never a builder callback: freshness comes from where the value is produced (a `renderSelf`, or a `() => …` binding), as for every other fill. */
export interface Canvas3DFillProp {
    type: 'canvas3D';
    scene: Scene3D;
    /** Ceiling on the 3D buffer's device-pixel ratio (default 2), so a high-scale export doesn't allocate a quadratically larger buffer (a 4× export of a 1080p shape would ask for 16×). */
    maxPixelRatio?: number;
    /** Multisample the 3D pass. Default true. */
    antialias?: boolean;
    opacity?: number;
    blend?: BlendMode;
}

export interface Canvas3DFillResolved {
    type: 'canvas3D';
    scene: Scene3D;
    maxPixelRatio?: number;
    antialias?: boolean;
    opacity?: number;
    blend?: BlendMode;
}

export const canvas3DFill: FillData<Canvas3DFillResolved> = {
    // Nothing to normalise — the defaults for maxPixelRatio/antialias are applied
    // at render time so the resolved shape stays minimal and comparable.
    resolve: (prop: Canvas3DFillProp) => ({ ...prop }),

    // A scene is a command list with no value halfway between two, so it snaps like an image fill's `src`; only `opacity` interpolates. Returns neither `type` nor `blend`: `FillResult` omits both and `lerpFill` reassembles via `{ ...a, ...lerp(...) }`, which also makes the ragged-array self-pair work.
    lerp: (a, b, t) => ({
        scene: t < 0.5 ? a.scene : b.scene,
        maxPixelRatio: a.maxPixelRatio ?? b.maxPixelRatio,
        antialias: a.antialias ?? b.antialias,
        opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t,
    }),

    // Reference identity is the only comparison a Scene3D supports (no structural hash; `ops()` returns its live array).
    equals: (a, b) => a.scene === b.scene,

    // Runs off the same descriptors the renderer consumes, so what gets loaded
    // cannot drift from what gets drawn.
    declare: (fill, assets) => {
        declare3DResources(fill.scene, assets);
    },
};
