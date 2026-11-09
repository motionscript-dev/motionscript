import { Color, NormalizedColor, parseColor } from '../color/parser';
import type { BlendMode } from '../blend';
import type { FillData } from '../registry';
import { lerpColorRamp } from '../gradient-stops';
import { lerpVector2, Vector2 } from '@/attributes/layout/vector2';

export interface LinearGradientFillProp {
    type: 'linear-gradient';
    colors: Color[];
    stops?: number[];
    start?: Vector2;
    end?: Vector2;
    opacity?: number;
    blend?: BlendMode;
}

export interface LinearGradientFillResolved {
    type: 'linear-gradient';
    colors: NormalizedColor[];
    stops: number[];
    start: Vector2;
    end: Vector2;
    opacity?: number;
    blend?: BlendMode;
}

function toNormalized(c: Color): NormalizedColor {
    return Array.isArray(c) ? (c as NormalizedColor) : parseColor(c as string);
}

export const linearGradientFill: FillData<LinearGradientFillResolved> = {
    resolve: (prop: LinearGradientFillProp) => ({
        type: 'linear-gradient',
        colors: prop.colors.map(toNormalized),
        stops: prop.stops ?? prop.colors.map((_, i) => i / Math.max(1, prop.colors.length - 1)),
        start: prop.start ?? { x: -1, y: 1 },
        end: prop.end ?? { x: 1, y: -1 },
        opacity: prop.opacity,
        blend: prop.blend,
    }),
    lerp: (a, b, t) => ({
        ...lerpColorRamp(a, b, t),
        start: lerpVector2(a.start, b.start, t),
        end: lerpVector2(a.end, b.end, t),
        opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t,
    }),
    equals: (a, b) =>
        a.start.x === b.start.x && a.start.y === b.start.y &&
        a.end.x === b.end.x && a.end.y === b.end.y &&
        a.colors.length === b.colors.length &&
        a.colors.every((c, i) => c === b.colors[i]),
};
