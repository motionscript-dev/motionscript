import { Adjustments, Fills, Flow, Paint, Shapes, component2d, type NodeOf } from '@motionscript/sdk';

/**
 * A 3D colour lookup table, unrolled into a `size × size × size` cube.
 *
 * Built rather than loaded so the scene has no fixture to keep in step: this is
 * a strong teal-and-orange grade — blues pushed cyan and cool, reds pushed warm,
 * with a mild S-curve on luma — which is obvious at a glance and impossible to
 * mistake for the source. Red-fastest, matching `LutEffect.table`.
 */
const SIZE = 17;

function buildCube(): Float32Array {
    const table = new Float32Array(SIZE * SIZE * SIZE * 3);
    const last = SIZE - 1;
    let i = 0;
    for (let b = 0; b < SIZE; b++) {
        for (let g = 0; g < SIZE; g++) {
            for (let r = 0; r < SIZE; r++) {
                const rn = r / last;
                const gn = g / last;
                const bn = b / last;
                // Contrast S-curve, then split-tone the ends apart.
                const s = (v: number) => v * v * (3 - 2 * v);
                table[i++] = Math.min(1, s(rn) * 1.1 + bn * 0.06);
                table[i++] = Math.min(1, s(gn) * 0.98);
                table[i++] = Math.min(1, s(bn) * 1.15 + gn * 0.05);
            }
        }
    }
    return table;
}

// One table for every read: `LutEffect` compares it by reference, so a cube
// rebuilt per frame would re-upload the texture every frame.
const CUBE = buildCube();

const graded = (amount: number) =>
    Fills.image('kingfisher.jpg', {
        fit: 'fill',
        preset: { adjustments: Adjustments.lut({ table: CUBE, size: SIZE, amount }) } });

/** A rect painting `kingfisher.jpg` through the cube, dialled in by `amount` — a Float32Array no JSON can carry. */
export const LutRect = component2d({
    key: 'lutRect',
    state: { ...Paint.state, ...Flow.state, ...Shapes.corners, amount: 0 },
    defaults: { fill: (state) => graded(state.amount) },
    commands: { ...Paint.commands },
    measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
    layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
    render: (ctx, state) => Paint.draw(ctx, state, Shapes.rect(ctx.size, state)),
});

export type LutRect = NodeOf<typeof LutRect>;
