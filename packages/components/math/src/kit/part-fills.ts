import { fillOps, lerpNumber, type Fill, type FillResolved } from "@motionscript/sdk";

/** A paint for one part of a node, named the way the node names its parts: a formula's term, a graph's vertex or edge. */
export interface PartFill {
    part: string;
    fill: Fill;
    /** Which of the places the part is written, counted from 1; 0 is all of them. */
    occurrence?: number;
    /** How far from the node's own paint to `fill`, 0 to 1. A tween's state: an author leaves it out. */
    mix?: number;
}

export interface PartFillResolved {
    part: string;
    fill: FillResolved[];
    occurrence: number;
    mix: number;
}

// Every entry is kept as written, one with no part yet included, so an editor
// showing the list shows the row it just added; the drawing skips it.
export function readPartFills(value: readonly PartFill[] | null | undefined): PartFillResolved[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => ({
        part: String(entry?.part ?? ""),
        fill: fillOps.resolve(entry?.fill ?? "#ffffff"),
        occurrence: Math.max(0, Math.round(entry?.occurrence ?? 0)),
        mix: Math.min(1, Math.max(0, entry?.mix ?? 1)),
    }));
}

const keyOf = (entry: PartFillResolved) => `${entry.occurrence}|${entry.part}`;

// A paint that arrives grows from the node's own, and one that leaves fades back to it.
export function lerpPartFills(from: PartFillResolved[], to: PartFillResolved[], t: number): PartFillResolved[] {
    if (t <= 0) return from;
    if (t >= 1) return to;
    const before = new Map(from.map((entry) => [keyOf(entry), entry]));
    const out = to.map((entry) => {
        const was = before.get(keyOf(entry));
        before.delete(keyOf(entry));
        return was
            ? { ...entry, fill: fillOps.lerp(was.fill, entry.fill, t), mix: lerpNumber(was.mix, entry.mix, t) }
            : { ...entry, mix: entry.mix * t };
    });
    for (const gone of before.values()) out.push({ ...gone, mix: gone.mix * (1 - t) });
    return out;
}

/** Each part fill with its own key, the one in place of an earlier one for the same part and occurrence. */
export function withPartFill(fills: readonly PartFillResolved[], entry: PartFill): PartFill[] {
    const occurrence = Math.max(0, Math.round(entry.occurrence ?? 0));
    return [...fills.filter((was) => was.part !== entry.part || was.occurrence !== occurrence), { ...entry, occurrence }];
}

/** `base` with a part's fill laid over it while it arrives, in place of it once it has. */
export function partPaint(base: FillResolved[], entry: PartFillResolved | undefined): FillResolved[] {
    if (!entry || entry.mix <= 0) return base;
    if (entry.mix >= 1) return entry.fill;
    return [...base, ...entry.fill.map((layer) => ({ ...layer, opacity: (layer.opacity ?? 1) * entry.mix }))];
}
