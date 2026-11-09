import {
    Flow, Graphics2D, Graphics3D, Material, Paint, Scene3D, Shapes, Tex, Types, component2d, component3d, type NodeOf,
} from '@motionscript/sdk';

/**
 * 3D values no JSON can name — a `Tex.surface` over a `Graphics2D`, a hand-built
 * `Scene3D` — held by node types, so a document names only their inputs.
 */

// Hoisted on purpose: a surface's texture identity is its source object, so a
// panel rebuilt per build would re-rasterize, defeat the texture cache and leak.
const PANEL = new Graphics2D()
    .rect({ width: 512, height: 512 })
    .fill('#101826')
    .rect({ x: 64, y: 64, width: 384, height: 160 })
    .fill('#4f8ef7')
    .rect({ x: 64, y: 288, width: 384, height: 160 })
    .fill('#e0533d');

/** A plane showing {@link PANEL} through `Tex.surface`: 2D rasterized and bound to a material map. */
export const PanelPlane3D = component3d({
    key: 'panelPlane3d',
    state: { ...Material.state, width: Types.custom<number | undefined>(undefined), height: Types.custom<number | undefined>(undefined) },
    defaults: { fill: Tex.surface(PANEL, { width: 512, height: 512 }) },
    render: (ctx, state) => ctx.draw(Material.mesh(state, { type: 'plane', width: state.width, height: state.height })),
});

/**
 * An ellipse whose fill is a recorded `Scene3D` — a box turned by `spin` — so 3D
 * paints through a non-rectangular path. The camera sits close enough that the
 * box overflows the ellipse on every side, or the frame would look the same
 * whether the path clipped or not.
 */
export const SpinBoxEllipse = component2d({
    key: 'spinBoxEllipse',
    state: {
        ...Paint.state, ...Flow.state,
        startAngle: Types.number(0),
        sweep: Types.number(360),
        ratio: Types.number(0),
        spin: 0,
    },
    defaults: { fill: (state) => boxScene(state.spin) },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.ellipse(ctx.size, state)),
});

export type SpinBoxEllipse = NodeOf<typeof SpinBoxEllipse>;

function boxScene(spin: number): Scene3D {
    return new Scene3D()
        .perspective({ position: [0, 0, 2.6], target: 0, fov: 55 })
        .light({ type: 'ambient', intensity: 0.4 })
        .light({ type: 'directional', intensity: 2.4 }, { position: [2, 4, 3] })
        .draw(new Graphics3D().box({
            width: 2.4, height: 2.4, depth: 2.4,
            fill: '#4f8ef7',
            rotation: [spin * 0.5, spin, 0] }));
}

/**
 * A rect whose **stroke** and **shadow** are both filled with the same recorded
 * `Scene3D`. A 3D fill is the one kind that needs `preflight` — it renders to an
 * offscreen buffer before the paint is configured — so it is what proves the
 * stroke and shadow passes run the full fill lifecycle rather than only the
 * paint-configuring half of it.
 */
export const SpinBoxStrokeRect = component2d({
    key: 'spinBoxStrokeRect',
    state: { ...Paint.state, ...Flow.state, ...Shapes.corners, spin: 0 },
    defaults: {
        stroke: (state) => ({ weight: 34, fill: bandScene(state.spin) }),
        shadow: (state) => ({ blur: 12, offset: { x: 0, y: -50 }, fill: bandScene(state.spin) }),
    },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
});

export type SpinBoxStrokeRect = NodeOf<typeof SpinBoxStrokeRect>;

/**
 * A ring of boxes, framed to fill the buffer edge to edge.
 *
 * A 3D fill renders at the *shape's* bounds and shades the painted geometry with
 * the result, so a stroke band sees only the outer rim of that buffer. A scene
 * centred on one object would leave the band a flat colour — and a flat band
 * cannot show whether the scene rendered at all, which is the whole point here.
 */
function bandScene(spin: number): Scene3D {
    const g3 = new Graphics3D();
    const COLORS = ['#4f8ef7', '#e0533d', '#f2c94c', '#41c7a0'];
    for (let i = 0; i < 8; i++) {
        const a = ((i / 8) * 360 + spin) * (Math.PI / 180);
        g3.box({
            width: 1.1, height: 1.1, depth: 1.1,
            position: [Math.cos(a) * 2.1, Math.sin(a) * 2.1, 0],
            fill: COLORS[i % COLORS.length],
            rotation: [spin, spin * 0.5, 0],
            roughness: 0.45,
        });
    }
    return new Scene3D()
        .perspective({ position: [0, 0, 4.4], target: 0, fov: 55 })
        .light({ type: 'ambient', intensity: 0.45 })
        .light({ type: 'directional', intensity: 2.2 }, { position: [2, 4, 3] })
        .draw(g3);
}
