import { Fills, Graphics2D, lerpNumber, toPathString, Types, type AssetScope, type Color, type Loader, type StrokeResolved, type Vector2 } from "@motionscript/sdk";
import { buildLatexPath, LatexNotLoaded, loadMathJax, MATHJAX_LOADER } from "../tex/geometry";
import type { Interval } from "./coords";

/** What a system draws its axes and numbers in, and a plot its curve, until told otherwise. */
export const AXIS_COLOR = "#9ca3af";
export const PLOT_COLOR = "#58a6ff";

/** A stroke without end markers: an axis wears a tip, its ticks do not. */
export function withoutTips(stroke: StrokeResolved[]): StrokeResolved[] {
    return stroke.map((layer) => ({ ...layer, startCap: undefined, endCap: undefined }));
}

export interface LabelStyle {
    fontSize: number;
    fontFamily: string;
    color: Color;
}

export interface Label {
    text: string;
    /** Where the label's box is anchored, in pixels. */
    at: Vector2;
    align: "left" | "center" | "right";
}

/** How wide a label's box is, in ems: room for a long number, so alignment is by the box's edge. */
const LABEL_BOX_EM = 8;

/** A label written between dollar signs is a formula: `$\\frac{\\pi}{2}$`. */
const FORMULA = /^\$([\s\S]+)\$$/;

/** Ask the host for MathJax when any of `texts` is a formula, so it is there before the node is laid out. */
export function declareFormulas(assets: AssetScope, texts: readonly string[]): void {
    if (texts.some((text) => FORMULA.test(text.trim()))) assets.loader(MATHJAX_LOADER, loadMathJax, { gate: "layout" });
}

/** {@link declareFormulas}, for a component's `load`. */
export function loadFormulas(loader: Loader, texts: readonly string[]): void {
    if (texts.some((text) => FORMULA.test(text.trim()))) loader.task(MATHJAX_LOADER, loadMathJax, { before: "layout" });
}

/** What draws `labels`: text in the scene's face, and a typeset formula for each one written as such. */
export function drawLabels(labels: readonly Label[], style: LabelStyle): Graphics2D[] {
    const out: Graphics2D[] = [];
    const fill = Fills.color(style.color);
    const text = new Graphics2D();
    const width = style.fontSize * LABEL_BOX_EM;
    let written = false;
    for (const label of labels) {
        const formula = FORMULA.exec(label.text.trim());
        const glyphs = formula ? typeset(formula[1], label, style.fontSize) : null;
        if (glyphs) {
            for (const glyph of glyphs) out.push(glyph.fill(fill));
            continue;
        }
        const { at, align } = label;
        written = true;
        text.text({
            text: label.text,
            fontSize: style.fontSize,
            // An empty family is left out, so the label takes the scene's own face.
            ...(style.fontFamily === "" ? {} : { fontFamily: style.fontFamily }),
            wrap: false,
            width,
            textAlign: align,
            x: align === "center" ? at.x : align === "right" ? at.x - width / 2 : at.x + width / 2,
            y: at.y,
        });
    }
    if (written) out.push(text.fill(fill));
    return out;
}

// A formula's glyphs with its box anchored at the label's point; `null` for one that will not typeset, which is then
// drawn as written, and nothing at all while MathJax is still on its way: its source is not a stand-in for it.
function typeset(source: string, { at, align }: Label, fontSize: number): Graphics2D[] | null {
    let formula: ReturnType<typeof buildLatexPath>;
    try {
        formula = buildLatexPath(source, fontSize);
    } catch (error) {
        return error instanceof LatexNotLoaded ? [] : null;
    }
    const [minX, minY, maxX, maxY] = formula.bounds;
    const dx = at.x + (align === "left" ? formula.width / 2 : align === "right" ? -formula.width / 2 : 0);
    // Glyph paths are y-down; the frame whose centre lands on the node's is shifted the other way.
    const frame: [number, number, number, number] = [minX - dx, minY + at.y, maxX - dx, maxY + at.y];
    return formula.tokens.map((token) => new Graphics2D().path({ data: toPathString(token.path), centerBounds: frame }));
}

/** Whether a mark `u` of the way along an axis is inside the part of it drawn so far. */
export function drawn(u: number, start: number, end: number): boolean {
    return u >= start - 1e-9 && u <= end + 1e-9;
}

/** How far along `range` a value is, 0 to 1, by pixel distance. */
export function along(at: Vector2, from: Vector2, to: Vector2): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    return length === 0 ? 0 : ((at.x - from.x) * dx + (at.y - from.y) * dy) / length;
}

export function lerpInterval(from: Interval, to: Interval, t: number): Interval {
    return [lerpNumber(from[0], to[0], t), lerpNumber(from[1], to[1], t)];
}

/** An entry holding a `[min, max]` range, read forgivingly and lerped end by end. */
export function intervalEntry(initial: Interval) {
    return Types.custom<Interval>(initial, { resolve: readInterval, lerp: lerpInterval });
}

export function readInterval(value: Interval | undefined, previous?: Interval): Interval {
    const [min, max] = Array.isArray(value) ? value : (previous ?? [0, 1]);
    return [Number(min), Number(max)];
}
