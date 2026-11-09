import type { InsetsResolved } from "@/attributes/layout/insets";
import type { Fill } from "@/attributes/shape/fill/chain";
import type { FillResolved } from "@/attributes/shape/fill/union";
import type { ShadowResolved } from "@/attributes/shape/shadow/shadow";
import type { StrokeResolved } from "@/attributes/shape/stroke/stroke";
import type { GraphicsOp, Graphics2D } from "@/render/graphics2d";
import type { RenderContext2D, Values } from "@/components/factory/api";
import { clipOf } from "@/components/factory/clip-of";
import { commandsFor } from "@/components/factory/commands-for";
import { Types } from "@/components/factory/types";
import { internalsOf } from "@/components/factory/views";

const FRACTION = { min: 0, max: 1, step: 0.01, scale: 100, unit: "%" } as const;

/** Fill, stroke and shadow for anything with a shape, and the commands that move them. */
export const state = {
    fill: Types.fill,
    stroke: Types.stroke,
    shadow: Types.shadow,
    overlay: Types.fill,
    start: Types.number(0, FRACTION),
    end: Types.number(1, FRACTION),
};

export const commands = commandsFor(state, {
    fillTo: { args: ["fill"] },
    strokeTo: { args: ["stroke"] },
    shadowTo: { args: ["shadow"] },
    overlayTo: { args: ["overlay"] },
    progressTo: { args: ["start", "end"] },
    /** A stretch of the outline travels along it, and leaves it as it was. */
    flash: {
        args: { portion: Types.number(0.25, { ...FRACTION, min: 0.01 }) },
        run: (timeline, s) => {
            const rest = { start: s.start, end: s.end };
            const portion = Math.min(1, Math.max(0.01, timeline.args.portion));
            return timeline.animate((t) => {
                if (t <= 0 || t >= 1) return rest;
                const head = t * (1 + portion);
                return { start: Math.max(0, head - portion), end: Math.min(1, head) };
            });
        },
    },
});

/** What `draw` reads; a component that spreads `Paint.state` without `overlay` passes as it is. */
export type PaintState = Omit<Values<typeof state>, "overlay"> & { readonly overlay?: readonly FillResolved[]; readonly clip: boolean };

export interface DrawOptions {
    /** Paint with this instead of `state.fill` (a video frame under it, a 3D scene over it). */
    readonly fill?: Fill;
    /** Draw the children some other way (through a camera, in a space). Default: `ctx.children()`. */
    readonly children?: () => void;
    /**
     * What `clip` confines the children to and picking tests, when it isn't the
     * shape drawn: a path's box, or `null` for none (then picking takes the box).
     */
    readonly clipShape?: Graphics2D | null;
    /** Draw the overlay some other way (masked by a picture), from the trimmed shape. Default: the shape filled with `overlay`. */
    readonly overlay?: (base: Graphics2D) => Graphics2D | null;
}

const TRIMMED = new Set<GraphicsOp["kind"]>(["rect", "ellipse", "path", "line", "polygon", "polygram"]);

function trimmed(shape: Graphics2D, start: number, end: number): Graphics2D {
    return shape._withOps(shape.ops().map((op) => (TRIMMED.has(op.kind)
        ? { ...op, state: { ...(op as { state: object }).state, start, end } } as GraphicsOp
        : op)));
}

/** A fresh copy to paint: a `Graphics2D` records into itself, and each paint needs the bare shape. */
function copy(shape: Graphics2D): Graphics2D {
    return shape._withOps([...shape.ops()]);
}

/** A shadow is cast by the stroke when nothing visible fills the shape. */
function castsShadowFromStroke(state: PaintState): boolean {
    if ((state.shadow as ShadowResolved[]).length === 0) return false;
    return !(state.fill as FillResolved[]).some((layer) => (layer.opacity ?? 1) > 0);
}

/**
 * Shadow and fill, then the children (clipped to the shape when `clip` is set),
 * then overlay and stroke, all trimmed by `start`/`end`: the paint order every
 * shape has, in one function.
 */
export function draw(ctx: RenderContext2D, s: PaintState, shape: Graphics2D | null, options: DrawOptions = {}): void {
    const c = internalsOf(ctx);
    const out = c.target();
    const confining = options.clipShape === undefined ? shape : options.clipShape;
    c.host._lastShape = confining;
    if (c.probing) {
        // Children drawn some other way may declare a camera or a space: the probe needs to see that.
        options.children?.();
        return;
    }
    const base = shape ? trimmed(shape, s.start, s.end) : null;

    c.inFront(() => {
        if (base) out.draw(copy(base).shadow(s.shadow).fill(options.fill ?? s.fill));
    });

    const outline = s.clip && confining ? clipOf(confining) : null;
    const clipped = outline !== null && !outline.isEmpty();
    if (clipped) out.beginClip(outline);
    if (options.children) options.children();
    else ctx.children();
    if (clipped) out.endClip();

    c.inFront(() => {
        if (!base) return;
        if (s.overlay && s.overlay.length > 0) {
            const overlay = options.overlay ? options.overlay(copy(base)) : copy(base).fill(s.overlay as FillResolved[]);
            if (overlay) out.draw(overlay);
        }
        const stroke = s.stroke as StrokeResolved[];
        if (stroke.length === 0) return;
        out.draw(castsShadowFromStroke(s) ? copy(base).shadow(s.shadow).stroke(stroke) : copy(base).stroke(stroke));
    });
}

/** How far the stroke reaches inside the shape, so children clear it. The widest stroke wins, not the sum. */
export function inset(s: Values<typeof state>): InsetsResolved {
    let extra = 0;
    for (const stroke of s.stroke as StrokeResolved[]) {
        const intrusion = stroke.weight * (1 - stroke.align) / 2;
        if (intrusion > extra) extra = intrusion;
    }
    return { left: extra, right: extra, top: extra, bottom: extra };
}
