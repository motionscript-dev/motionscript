import {
    Flow,
    Graphics2D,
    Paint,
    Types,
    component2d,
    lerpVector2,
    type NodeOf,
    type PathBounds,
    type PathCommand,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Alignment as _Alignment,
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";

import { centered, defaultSubStroke, gridLinePaths, maxWeight } from "../kit";

/**
 * A rectangular grid of lines filling the node's layout rect.
 *
 * `stroke` paints the major lines and `subStroke` the minor ones, each as a
 * single union path. `fill` and `shadow` cover the whole rect, behind the lines.
 */
export const LineGridPattern = component2d({
    key: "lineGridPattern",
    state: {
        ...Paint.state,
        ...Flow.state,
        /** Cells along each axis: `divisions` of 4 draws 5 major lines per axis. */
        divisions: 4,
        /** Finer cells each division is split into. 1 draws no minor lines; 2 adds one per division. */
        subdivisions: 1,
        /** Stroke for the minor lines. Unset, the major `stroke` at half opacity when `subdivisions > 1`. */
        subStroke: Types.stroke,
        /** Pans the grid. Lines wrap and tile, so the rect stays full while `offset` scrolls it. */
        offset: Types.custom<Vector2>({ x: 0, y: 0 }, { lerp: lerpVector2 }),
    },
    defaults: { subStroke: (_state, given) => defaultSubStroke(given) },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => {
        const { width, height } = ctx.size;
        const box = new Graphics2D().rect({ width, height });
        ctx.inFront(() => {
            ctx.draw(new Graphics2D()
                .rect({ width, height, start: state.start, end: state.end })
                .shadow(state.shadow)
                .fill(state.fill));

            const divisions = Math.max(1, Math.floor(state.divisions));
            const subdivisions = Math.max(1, Math.floor(state.subdivisions));

            // Lines overscan the rect by half the thickest stroke and are clipped to it, so a
            // thick line slides out under the clip instead of popping at the boundary.
            const major = centered(state.stroke);
            const minorStroke = centered(state.subStroke);
            const overscan = Math.max(maxWeight(major), maxWeight(minorStroke)) / 2;
            const lines = gridPaths(width, height, divisions, subdivisions, overscan, state.offset);
            const centerBounds: PathBounds = [-width / 2, -height / 2, width / 2, height / 2];

            ctx.clip(box, () => {
                // Minor lines first so the major lines sit on top.
                if (subdivisions > 1 && minorStroke.length > 0 && lines.minor.length > 0) {
                    ctx.draw(new Graphics2D().path({ data: lines.minor, centerBounds }).stroke(minorStroke));
                }
                if (lines.major.length > 0) {
                    ctx.draw(new Graphics2D().path({ data: lines.major, centerBounds }).stroke(major));
                }
            });
        });
        // The rect is what `clip` confines the children to and what picking tests; it paints nothing more.
        Paint.draw(ctx, state, null, { clipShape: box });
    },
});

export type LineGridPattern = NodeOf<typeof LineGridPattern>;
/** What a call or a document row may set. */
export type LineGridPatternProps = NonNullable<Parameters<typeof LineGridPattern>[0]>;

// One multi-subpath path per group, so each stroke paints its lines as a union with no
// destructive boolean op (which would erase open lines).
function gridPaths(
    width: number,
    height: number,
    divisions: number,
    subdivisions: number,
    overscan: number,
    offset: Vector2,
): { major: PathCommand[]; minor: PathCommand[] } {
    // Inset by `overscan` so the outermost lines sit fully inside the rect and are not
    // trimmed to half weight by the clip.
    const cols = divisions * subdivisions;
    const innerW = Math.max(0, width - 2 * overscan);
    const innerH = Math.max(0, height - 2 * overscan);
    const insetX = width / 2 - overscan;
    const insetY = height / 2 - overscan;

    // Anchored at the near edge, so a line sits on each edge of the box for any count of cells.
    return gridLinePaths(
        { min: -insetX, max: insetX, step: innerW / cols, offset: offset.x, anchor: -insetX },
        { min: -insetY, max: insetY, step: innerH / cols, offset: offset.y, anchor: -insetY },
        subdivisions,
        overscan,
    );
}
