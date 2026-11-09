import { niceStep } from "@motionscript/sdk/component";
import type { AxisScaling, Interval } from "./coords";

/** Where an axis is marked, and the spacing its labels are rounded to. */
export interface Ticks {
    values: number[];
    step: number;
}

/** Past this an axis is not marked at all, rather than drawn as a solid bar of ticks. */
const MAX_TICKS = 200;

/** How far apart, in pixels, marks sit when the axis picks its own step. */
const AUTO_SPACING = 64;

/**
 * The marks along `range`, drawn over `length` pixels. A `step` of zero lets the
 * axis choose a tidy one (1, 2 or 5 times a power of ten) for its size; a log
 * axis is marked at the powers of ten whatever the step.
 */
export function ticksFor(range: Interval, step: number, length: number, scaling: AxisScaling = "linear"): Ticks {
    const [min, max] = range;
    if (scaling === "log") return decades(min, max);
    const span = max - min;
    if (!(span > 0)) return { values: [], step: 1 };
    const chosen = step > 0 ? step : niceStep((AUTO_SPACING / Math.max(1, length)) * span);
    return { values: multiplesWithin(min, max, chosen), step: chosen };
}

function decades(min: number, max: number): Ticks {
    const values: number[] = [];
    for (let k = Math.ceil(Math.log10(min) - 1e-9); k <= Math.floor(Math.log10(max) + 1e-9) && values.length < MAX_TICKS; k++) {
        values.push(10 ** k);
    }
    return { values, step: 0 };
}

function multiplesWithin(min: number, max: number, step: number): number[] {
    const first = Math.ceil(min / step - 1e-9);
    const last = Math.floor(max / step + 1e-9);
    const count = last - first + 1;
    if (!Number.isFinite(count) || count <= 0 || count > MAX_TICKS) return [];
    const out = new Array<number>(count);
    // Multiplied rather than accumulated, so the tenth tick of 0.1 is 1 and not 0.9999999999999999.
    for (let i = 0; i < count; i++) out[i] = (first + i) * step;
    return out;
}

function decadeOf(value: number): number {
    return Math.floor(Math.log10(value) + 1e-12);
}

/**
 * `value` as a tick label, with as many decimals as `step` needs and no more:
 * 0.30000000000000004 on a 0.1 ladder is `0.3`. A `step` of zero (a log axis)
 * prints the value as it is.
 */
export function formatTick(value: number, step: number): string {
    if (value === 0) return "0";
    if (!Number.isFinite(value)) return "";
    if (!(step > 0)) {
        const decade = decadeOf(Math.abs(value));
        return decade >= 6 || decade <= -5 ? trimExponent(value.toExponential(0)) : String(Number(value.toPrecision(12)));
    }
    const decade = decadeOf(Math.abs(value));
    const digits = Math.max(1, decade - decadeOf(step) + 1);
    if ((decade >= 6 || decade <= -5) && digits <= 6) return trimExponent(value.toExponential(digits - 1));
    const decimals = decimalsOf(step);
    const text = value.toFixed(decimals);
    return decimals > 0 ? text.replace(/\.?0+$/, "") : text;
}

/** The decimal places it takes to write `step` out: 1 for 0.5, 2 for 0.25. */
function decimalsOf(step: number): number {
    for (let d = 0; d < 12; d++) {
        const scaled = step * 10 ** d;
        if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
    }
    return 12;
}

function trimExponent(text: string): string {
    const [mantissa, exponent] = text.split("e");
    return `${mantissa.replace(/\.?0+$/, "")}e${Number(exponent)}`;
}
