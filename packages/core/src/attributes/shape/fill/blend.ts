// Mirrors CSS `mix-blend-mode`; the renderer maps each string to an integer hash for fast uniform uploads.

/** Every supported blend mode, in hash-index order. */
export const BlendModes = [
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
    "normal"
] as const;

export type BlendMode = typeof BlendModes[number];

/** Blend modes a node/layer can carry: the fill {@link BlendMode} set plus Figma's `pass-through` (the node default), where the layer is *not* isolated: its opacity scales each child/fill's contribution while they blend directly against the backdrop. Any other value isolates the node, flattening its children into a group that blends with the chosen mode. Fills never accept `pass-through`. */
export const NodeBlendModes = [...BlendModes, "pass-through"] as const;

export type NodeBlendMode = typeof NodeBlendModes[number];

// Pre-built reverse lookup so getBlendModeHash is O(1).
const BLEND_MODE_HASH: Record<BlendMode, number> =
    Object.fromEntries(
        BlendModes.map((mode, i) => [mode, i])
    ) as Record<BlendMode, number>;

export function getBlendModeHash(blend: BlendMode): number {
    return BLEND_MODE_HASH[blend];
}
