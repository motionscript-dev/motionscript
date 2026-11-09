import { Ellipse, Path } from '@motionscript/sdk';
import { createRef, easeInOut, el, scene } from '../doc';
import { holdTail } from './_lib';

/**
 * `startCap`/`endCap` shape an open stroke's two ends apart from `cap`, which
 * keeps shaping every dash: a zig-zag starting round and ending square, a
 * dashed line whose round dashes meet a flush start and a square end, and an
 * arc whose ends differ while it sweeps round.
 */
const zigzag = createRef<Path>();
const dashed = createRef<Path>();
const arc = createRef<Ellipse>();
export default scene((stage) => {
    stage.set({ fill: 'bg' });
    stage.add(
        el(Path, {
            ref: zigzag,
            y: 150,
            data: 'M -260 40 L -90 -40 L 90 40 L 260 -40',
            fill: 'transparent',
            stroke: { weight: 28, fill: 'primary', cap: 'butt', startCap: 'round', endCap: 'square' },
        }),
    );
    stage.add(
        el(Path, {
            ref: dashed,
            y: 10,
            data: 'M -260 0 L 260 0',
            stroke: { weight: 20, fill: 'accent', dash: [34, 22], cap: 'round', startCap: 'butt', endCap: 'square' },
        }),
    );
    stage.add(
        el(Ellipse, {
            ref: arc,
            y: -160,
            width: 220,
            height: 140,
            startAngle: 200,
            sweep: 140,
            ratio: 1,
            fill: 'transparent',
            stroke: { weight: 22, fill: 'primary', align: 'center', startCap: 'round', endCap: 'butt' },
        }),
    );
}, [
    () => zigzag().strokeTo({ data: { weight: 44, fill: 'primary', cap: 'butt', startCap: 'round', endCap: 'square' }, duration: 1.2, easing: easeInOut('quad') }),
    () => arc().to({ data: { sweep: 260 }, duration: 1.2, easing: easeInOut('quad') }),
    holdTail(1.2),
]);
