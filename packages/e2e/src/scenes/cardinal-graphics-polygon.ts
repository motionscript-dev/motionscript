import { Rect, type AlignmentKey } from '@motionscript/sdk';
import { easeInOut, el, scene, variableTo } from '../doc';
import { PivotPolygon } from '@/components/cardinal-pivots';
import { holdTail } from './_lib';

/** All nine named alignments, laid out to mirror their on-screen meaning. */
const ALIGNMENTS: AlignmentKey[] = [
    'topLeft', 'topCenter', 'topRight',
    'centerLeft', 'center', 'centerRight',
    'bottomLeft', 'bottomCenter', 'bottomRight',
];

/**
 * `Graphics2D().polygon({ pivot, x: 0, y: 0 })` for all nine named alignments,
 * animating the descriptor's own `rotation`/`scale` (not the node-level
 * transform): with no cardinal-alignment shorthand, a plain `pivot` combined with
 * `x`/`y` should still land that named corner/edge of the polygon's bounding
 * box on `(x, y)` and keep it pinned there under motion. One cell per alignment in
 * a 3x3 grid, every cell following the same two variables.
 */
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.variable('rotation', 0);
    stage.variable('scale', 1);

    const cells = ALIGNMENTS.map((alignment) => el(Rect, {
        width: 'fill',
        height: 'fill',
        flow: 'freeform',
        align: { x: 0, y: 0 },
        fill: 'card',
        cornerRadius: 12,
        children: [
            el(PivotPolygon, { alignment, shapeRotation: '=[rotation]', shapeScale: '=[scale]' }),
        ],
    }));

    const rows = [0, 1, 2].map((r) => el(Rect, { width: 'fill', height: 'fill', flow: 'horizontal', gap: 20, children: [
        cells.slice(r * 3, r * 3 + 3),
    ] }));

    stage.add(
        el(Rect, { width: 'fill', height: 'fill', flow: 'vertical', padding: 24, gap: 20, children: [
            rows,
        ] }),
    );
}, [
    [
        () => variableTo('rotation', 360, 1.6, easeInOut('quad')),
        () => variableTo('scale', 1.3, 1.6, easeInOut('quad')),
    ],
    holdTail(1.6),
]);
