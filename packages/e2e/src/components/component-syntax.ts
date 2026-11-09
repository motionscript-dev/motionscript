import { Graphics2D } from '@motionscript/sdk';
import { Corners, Flow, Paint, Types, component2d } from '@motionscript/core/experimental';

/**
 * Components written with `component2d`, registered beside the built-in nodes
 * they mirror so a scene pair can be pixel-diffed.
 */

/** Today's Rect, as a component: the class's paint pipeline and layout, from modules. */
export const Rect = component2d({
    key: 'rect',
    state: { ...Paint.state, ...Flow.state, ...Corners.state },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Corners.rect(ctx.size, state)),
});

export const Gauge = component2d({
    key: 'gauge',
    state: { ...Paint.state, value: Types.number(0, { min: 0, max: 1, unit: '%' }) },
    commands: { ...Paint.commands, fillUp: { args: ['value'] } },
    render: (ctx, state) => Paint.draw(ctx, state, new Graphics2D().ellipse({
        width: ctx.size.width, height: ctx.size.height, ratio: 0.75, startAngle: -90, sweep: 360 * state.value,
    })),
});

/** A custom layout: children fanned out on a circle, each turned to face outward. `open` spreads them. */
export const RadialMenu = component2d({
    key: 'radialMenu',
    state: {
        radius: Types.number(200, { min: 0 }),
        spread: Types.number(1, { min: 0, max: 1 }),
    },
    defaults: { width: 'hug', height: 'hug' },
    commands: { open: { args: ['spread'] } },
    measure: (measurer, state, children) => {
        const side = Math.max(0, ...children.map((c) => {
            const size = c.measure(measurer.max);
            return Math.max(size.width, size.height);
        }));
        const extent = 2 * state.radius + side;
        return { width: extent, height: extent };
    },
    layout: (box, state, children) => children.map((c, i) => {
        const angle = (i / Math.max(1, children.length)) * 360 * state.spread;
        const r = state.radius * state.spread;
        return {
            x: r * Math.cos((angle * Math.PI) / 180),
            y: r * Math.sin((angle * Math.PI) / 180),
            width: c.size.width,
            height: c.size.height,
            // Angles count counter-clockwise (y up); rotation turns clockwise on screen.
            rotation: -angle,
            opacity: state.spread,
        };
    }),
});

// The generated node classes, typed by each component's state: `el` names these as it names a component.
export const RectV2 = Rect.node;
export const GaugeV2 = Gauge.node;
export const RadialMenuV2 = RadialMenu.node;
