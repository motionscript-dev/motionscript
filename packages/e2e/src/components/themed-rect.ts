import { ThemeToken } from '@motionscript/core';
import { Flow, Paint, Shapes, Types, component2d, type EntryOptions, type NodeOf } from '@motionscript/sdk';

/** The color the nearest theme holds under the node's `token`; nothing, for a token that names none. */
const themed: EntryOptions['inherit'] = (use, given) => {
    const color = use(ThemeToken)[typeof given.token === 'string' ? given.token : 'brand'];
    return typeof color === 'string' ? color : undefined;
};

/**
 * A rect painted with a named token of the nearest `ThemeProvider`.
 *
 * A color string is never looked up in a provider's `theme`: that map is
 * context a node reads for itself (`useContext(ThemeToken)`), so a scene that
 * wants a themed paint needs a node that does the reading.
 */
export const ThemedRect = component2d({
    key: 'themedRect',
    state: {
        ...Paint.state, ...Flow.state, ...Shapes.corners,
        fill: Types.fill(undefined, { inherit: themed }),
        token: 'brand',
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
});

export type ThemedRect = NodeOf<typeof ThemedRect>;
