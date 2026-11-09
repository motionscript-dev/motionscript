import { Ellipse, Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `startCap`/`endCap` as markers: one row per kind, tail on the left and head
 * on the right; a dashed line whose pattern leaves its end bare; a curved arc
 * whose head turns with it; and a line drawn on, its head riding the trimmed end.
 */
const KINDS = ['arrow', 'triangle', 'stealth', 'dot', 'box', 'diamond', 'bar'] as const;
const drawn = createRef<Path>();
const arc = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    KINDS.forEach((kind, i) => {
        stage.add(
            el(Path, {
                x: -250,
                y: 210 - i * 62,
                data: 'M -170 0 L 170 0',
                stroke: { weight: 8, fill: 'primary', startCap: i % 2 ? 'bar' : 'dot', endCap: kind },
            }),
        );
    });
    stage.add(
        el(Path, {
            x: 230,
            y: 200,
            data: 'M -170 0 L 170 0',
            stroke: { weight: 6, fill: 'accent', dash: [22, 16], dashOffset: 22, startCap: 'stealth', endCap: 'stealth', capScale: 6 },
        }),
    );
    stage.add(
        el(Ellipse, {
            ref: arc,
            x: 230,
            y: 40,
            width: 280,
            height: 180,
            startAngle: 200,
            sweep: 140,
            ratio: 1,
            fill: 'transparent',
            stroke: { weight: 8, fill: 'primary', align: 'center', startCap: 'dot', endCap: 'triangle' },
        }),
    );
    stage.add(
        el(Path, {
            ref: drawn,
            x: 230,
            y: -170,
            end: 0.05,
            data: 'M -170 -30 C -60 60, 60 -90, 170 30',
            stroke: { weight: 10, fill: 'accent', endCap: 'arrow' },
        }),
    );
}, [
    () => drawn().progressTo({ data: { end: 1 }, duration: 1.2, easing: easeInOut('quad') }),
    () => arc().to({ data: { sweep: 300 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
