// Per-channel colour interpolation on {@link NormalizedColor} tuples, for fill implementations that need it without the full fill-registry machinery.

import { Color, NormalizedColor, parseColor } from "./color/parser";
import type { AttributeOps } from "@/attributes/shared/operators";

/** Linearly interpolates two normalized RGBA colors channel-by-channel. */
export function lerpColor(from: NormalizedColor, to: NormalizedColor, t: number): NormalizedColor {
    return [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
        from[3] + (to[3] - from[3]) * t,
    ];
}

/** Helpers the colour attribute carries beyond its mapper and lerp. */
export interface ColorOps {
    /** `#rrggbb`, or `#rrggbbaa` when not opaque, for a consumer that takes a colour as a string. */
    hex(value: Color): string;
}

/** The colour attribute's op set: parses a CSS string (or passes a normalized tuple through) and interpolates in normalized space. */
export const colorOps: AttributeOps<Color, NormalizedColor> & ColorOps = {
    resolve,
    lerp: lerpColor,
    hex(value) {
        const [r, g, b, a] = resolve(value);
        const alpha = byte(a);
        return `#${byte(r)}${byte(g)}${byte(b)}${alpha === "ff" ? "" : alpha}`;
    },
};

function resolve(value: Color): NormalizedColor {
    return Array.isArray(value) ? value : parseColor(value);
}

function byte(channel: number): string {
    return Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0");
}

