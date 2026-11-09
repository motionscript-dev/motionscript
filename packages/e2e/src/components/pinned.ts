import { Flow, Paint, Shapes, Types, component2d, type AlignmentKey, type NodeOf, type NodeView, type Vector2 } from '@motionscript/sdk';

/**
 * Markers whose `center` follows a named cardinal point of another node — the
 * card they sit beside — while that card animates.
 *
 * The document names the card (`on`, a node reference) and which point (`pin`);
 * the binding that lands the marker's centre on that point lives here, in code.
 */

const pinning = {
    /** The node to follow: a sibling, so its cardinal points are in the frame this node's `x`/`y` are in. */
    on: Types.nodeRef(),
    pin: Types.custom<AlignmentKey>('center'),
};

/** `pin` on the node `on` names, or the origin while there is none. */
function pinned(state: { readonly on: NodeView | null; readonly pin: AlignmentKey }): Vector2 {
    const points = state.on?.state as Partial<Record<AlignmentKey, Vector2>> | undefined;
    return points?.[state.pin] ?? { x: 0, y: 0 };
}

// A centre landing on the point is `x`/`y` at it, about the default centre pivot.
const following = {
    x: (state: Parameters<typeof pinned>[0]) => pinned(state).x,
    y: (state: Parameters<typeof pinned>[0]) => pinned(state).y,
};

export const PinnedRect = component2d({
    key: 'pinnedRect',
    state: { ...Paint.state, ...Flow.state, ...Shapes.corners, ...pinning },
    defaults: following,
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
});

export const PinnedEllipse = component2d({
    key: 'pinnedEllipse',
    state: {
        ...Paint.state, ...Flow.state,
        startAngle: Types.number(0),
        sweep: Types.number(360),
        ratio: Types.number(0),
        ...pinning,
    },
    defaults: following,
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.ellipse(ctx.size, state)),
});

export type PinnedRect = NodeOf<typeof PinnedRect>;
export type PinnedEllipse = NodeOf<typeof PinnedEllipse>;
